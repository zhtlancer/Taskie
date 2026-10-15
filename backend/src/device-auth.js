// Device authorization: a gate in front of the whole app, for exposing it beyond the home network.
//
// Every browser gets a random device token in an HttpOnly cookie. Until the token is authorized,
// the browser only sees a page with a short pairing code; a parent enters that code in the parent
// console (or runs `node src/cli.js approve-device <code>` on the server) to authorize it. The
// authorized_tokens file lists authorized devices by token hash, one per line, and can be edited by
// hand: deleting a line revokes that device. Tokens never appear in the file, logs or the UI.
// Source IPs are never trusted: behind frp every request seems to come from the same host.
//
// Pairing requests, approvals, wrong codes and revocations, including those made by the server
// command or by editing the file, are kept in device_events for the parent console and written to
// the container log. Source IPs and browsers are recorded for reference only.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

const COOKIE = 'taskie_device';
const COOKIE_MAX_AGE = 400 * 24 * 3600; // browsers cap cookie lifetimes at 400 days
const PAIRING_MINUTES = 10;
const MAX_ACTIVE_PAIRINGS = 30;
const MAX_EVENTS = 500;
const MAX_PAIR_EVENTS = 300; // kept apart so a flood of pairing requests cannot push out the rest
const QUIET_TYPES = new Set(['pair_rejected', 'approve_blocked']); // recorded at most once a minute
const WARNING_TYPES = new Set(['pair_rejected', 'approve_failed', 'approve_blocked']);
const EVENT_MESSAGES = {
  pair_requested: event => `新设备请求配对，配对码 ${event.code}`,
  pair_rejected: () => '配对请求过多，拒绝了新的配对请求',
  approved: event => `授权了设备「${event.label}」`,
  approve_failed: event => `配对码 ${event.code} 无效或已过期`,
  approve_blocked: () => '配对码错误次数过多，暂停授权 10 分钟',
  revoked: event => `撤销了设备「${event.label}」`,
  file_added: event => `授权文件中新增了设备「${event.label}」`,
  file_removed: event => `授权文件中删除了设备「${event.label}」`
};
const FILE_HEADER = [
  '# Taskie 已授权设备：每行为 <令牌 SHA-256> <授权时间> <备注>。',
  '# 删除某一行即可撤销该设备；令牌本身不会保存在这里。',
  ''
].join('\n');

const hashToken = token => createHash('sha256').update(token).digest('hex');
const isHash = value => /^[0-9a-f]{64}$/.test(value);
const deviceId = hash => hash.slice(0, 16);
const cleanLabel = label => String(label ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 30) || '未命名设备';

class DeviceRegistry {
  constructor(db, file, { logger = null } = {}) {
    this.db = db;
    this.file = file;
    this.logger = logger;
    this.cache = { mtimeMs: -1, size: -1, entries: [] };
    this.seen = new Map();
    this.quietUntil = new Map();
    this.known = null;
    this.load(true);
  }

  // Authorized devices from the file, re-read whenever it changes on disk.
  entries() {
    return this.load(false);
  }

  load(quiet) {
    let stat = null;
    try {
      stat = fs.statSync(this.file);
    } catch {}
    const mtimeMs = stat ? stat.mtimeMs : 0, size = stat ? stat.size : -1;
    if (this.known && mtimeMs === this.cache.mtimeMs && size === this.cache.size) return this.cache.entries;
    let text = '';
    try {
      if (stat) text = fs.readFileSync(this.file, 'utf8');
    } catch {}
    const entries = text.split('\n').map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const [hash, createdAt, ...label] = line.split(/\s+/);
        return { hash: hash.toLowerCase(), created_at: createdAt || null, label: label.join(' ') || '未命名设备' };
      })
      .filter(entry => isHash(entry.hash));
    this.cache = { mtimeMs, size, entries };
    if (quiet || !this.known) this.remember(entries);
    else this.noticeOutsideChanges(entries);
    return entries;
  }

  remember(entries) {
    this.known = new Map(entries.map(entry => [entry.hash, entry.label]));
    this.eventMark = this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM device_events').get().id;
  }

  // The file changed outside this process. The server command records its own events, which only
  // need to reach this process's log; anything else was a hand edit and is recorded here.
  noticeOutsideChanges(entries) {
    const before = this.known, mark = this.eventMark;
    this.remember(entries);
    const fromCommand = this.db.prepare("SELECT * FROM device_events WHERE id > ? AND source = 'cli' ORDER BY id").all(mark);
    fromCommand.forEach(event => this.log(event));
    const explained = new Set(fromCommand.filter(event => ['approved', 'revoked'].includes(event.type)).map(event => event.device_id));
    for (const [hash, label] of this.known) {
      if (!before.has(hash) && !explained.has(deviceId(hash))) this.record('file_added', { source: 'file', device_id: deviceId(hash), label });
    }
    for (const [hash, label] of before) {
      if (!this.known.has(hash) && !explained.has(deviceId(hash))) this.record('file_removed', { source: 'file', device_id: deviceId(hash), label });
    }
  }

  labelFor(token) {
    const hash = typeof token === 'string' && token ? hashToken(token) : null;
    return this.entries().find(entry => entry.hash === hash)?.label ?? null;
  }

  // --- History ---

  record(type, { source = 'web', device_id = null, label = null, actor = null, code = null, ip = null, user_agent = null } = {}) {
    if (QUIET_TYPES.has(type)) {
      if (Date.now() < (this.quietUntil.get(type) || 0)) return;
      this.quietUntil.set(type, Date.now() + 60000);
    }
    const event = { at: new Date().toISOString(), type, source, device_id, label, actor, code, ip, user_agent };
    event.id = Number(this.db.prepare(`INSERT INTO device_events (at, type, source, device_id, label, actor, code, ip, user_agent)
      VALUES (@at, @type, @source, @device_id, @label, @actor, @code, @ip, @user_agent)`).run(event).lastInsertRowid);
    const pairing = type === 'pair_requested' ? 1 : 0;
    this.db.prepare(`DELETE FROM device_events WHERE (type = 'pair_requested') = ? AND id NOT IN
      (SELECT id FROM device_events WHERE (type = 'pair_requested') = ? ORDER BY id DESC LIMIT ?)`)
      .run(pairing, pairing, pairing ? MAX_PAIR_EVENTS : MAX_EVENTS);
    this.log(event);
  }

  log(event) {
    if (!this.logger) return;
    const fields = Object.fromEntries(Object.entries(event).filter(([key, value]) => value !== null && key !== 'id'));
    const by = event.source === 'cli' ? '（服务器命令）' : event.actor ? `（在「${event.actor}」上操作）` : '';
    this.logger[WARNING_TYPES.has(event.type) ? 'warn' : 'info']({ deviceEvent: fields }, `设备授权：${EVENT_MESSAGES[event.type](event)}${by}`);
  }

  events(limit = 50) {
    return this.db.prepare('SELECT * FROM device_events ORDER BY id DESC LIMIT ?').all(limit);
  }

  isAuthorized(token) {
    if (typeof token !== 'string' || !token) return false;
    const hash = Buffer.from(hashToken(token), 'hex');
    return this.entries().some(entry => timingSafeEqual(Buffer.from(entry.hash, 'hex'), hash));
  }

  // Rewrites the file atomically so a crash never leaves it half written.
  writeLines(lines) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 0o644 });
    fs.renameSync(tmp, this.file);
    this.load(true);
  }

  readLines() {
    try {
      return fs.readFileSync(this.file, 'utf8').replace(/\n+$/, '').split('\n');
    } catch {
      return FILE_HEADER.replace(/\n$/, '').split('\n');
    }
  }

  add(hash, label) {
    if (this.entries().some(entry => entry.hash === hash)) return;
    this.writeLines([...this.readLines(), `${hash} ${new Date().toISOString()} ${cleanLabel(label)}`]);
  }

  // Revokes by id, the first 16 hex digits of the hash shown in the parent console.
  remove(id, client = {}) {
    if (!/^[0-9a-f]{16}$/.test(id ?? '')) throw { status: 400, message: '设备编号无效' };
    const label = this.entries().find(entry => deviceId(entry.hash) === id)?.label ?? null;
    const lines = this.readLines();
    const kept = lines.filter(line => !line.trim().toLowerCase().startsWith(id));
    if (kept.length === lines.length) throw { status: 404, message: '设备不存在' };
    this.writeLines(kept);
    this.record('revoked', { ...client, device_id: id, label });
    return { success: true, id };
  }

  list(currentToken) {
    const current = currentToken ? hashToken(currentToken) : null;
    const lastSeen = this.db.prepare('SELECT token_hash, last_seen_at FROM device_seen').all();
    const seen = new Map(lastSeen.map(row => [row.token_hash, row.last_seen_at]));
    return this.entries().map(entry => ({
      id: deviceId(entry.hash),
      label: entry.label,
      created_at: entry.created_at,
      last_seen_at: seen.get(entry.hash) || null,
      current: entry.hash === current
    }));
  }

  // Records when an authorized device was last used, at most every 10 minutes per device.
  touch(token) {
    const hash = hashToken(token);
    const now = Date.now();
    if (now - (this.seen.get(hash) || 0) < 10 * 60000) return;
    this.seen.set(hash, now);
    this.db.prepare(`INSERT INTO device_seen (token_hash, last_seen_at) VALUES (?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at`).run(hash, new Date(now).toISOString());
  }

  // --- Pairing ---

  purgeExpired() {
    this.db.prepare('DELETE FROM device_pairings WHERE expires_at <= ?').run(new Date().toISOString());
  }

  pendingFor(token) {
    this.purgeExpired();
    return this.db.prepare('SELECT code, expires_at FROM device_pairings WHERE token_hash = ?').get(hashToken(token)) || null;
  }

  // A 6-digit code for an unauthorized device, unique among active codes and valid for 10 minutes.
  startPairing(token, client = {}) {
    const existing = this.pendingFor(token);
    if (existing) return existing;
    if (this.db.prepare('SELECT COUNT(*) AS n FROM device_pairings').get().n >= MAX_ACTIVE_PAIRINGS) {
      this.record('pair_rejected', client);
      throw { status: 429, message: '配对请求过多，请稍后再试' };
    }
    const taken = new Set(this.db.prepare('SELECT code FROM device_pairings').all().map(row => row.code));
    let code;
    do code = String(randomInt(0, 1000000)).padStart(6, '0'); while (taken.has(code));
    const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60000).toISOString();
    this.db.prepare('INSERT INTO device_pairings (code, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(code, hashToken(token), new Date().toISOString(), expiresAt);
    this.record('pair_requested', { ...client, device_id: deviceId(hashToken(token)), code });
    return { code, expires_at: expiresAt };
  }

  approve(code, label, client = {}) {
    const normalized = String(code ?? '').replace(/\D/g, '');
    if (normalized.length !== 6) throw { status: 400, message: '请输入新设备上显示的 6 位配对码' };
    this.purgeExpired();
    const pairing = this.db.prepare('SELECT token_hash FROM device_pairings WHERE code = ?').get(normalized);
    if (!pairing) {
      this.record('approve_failed', { ...client, code: normalized });
      throw { status: 404, message: '配对码无效或已过期，请在新设备上刷新获取新的配对码' };
    }
    this.add(pairing.token_hash, label);
    this.db.prepare('DELETE FROM device_pairings WHERE code = ?').run(normalized);
    const device = this.list().find(device => device.id === deviceId(pairing.token_hash));
    this.record('approved', { ...client, device_id: device.id, label: device.label, code: normalized });
    return device;
  }
}

function readDeviceCookie(request) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(value.join('='));
  }
  return null;
}

// Secure only over HTTPS (browsers drop Secure cookies set over plain HTTP); a TLS-terminating proxy
// in front should send X-Forwarded-Proto: https.
function deviceCookie(request, token) {
  const https = request.protocol === 'https' || String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`;
}

// Who made a request, for the history. X-Forwarded-For can be forged, so it is only shown alongside
// the connecting address and never used for decisions.
function clientInfo(request, registry) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').trim();
  const ip = (forwarded ? `${forwarded} → ${request.ip}` : request.ip || '').slice(0, 120) || null;
  const userAgent = String(request.headers['user-agent'] || '').slice(0, 200) || null;
  return { source: 'web', ip, user_agent: userAgent, actor: request.deviceToken ? registry.labelFor(request.deviceToken) : null };
}

// Browsers fetch the manifest without cookies, and installers fetch icons on their own, so the app's
// name and icons stay public; they carry no family data.
const PUBLIC_ASSETS = new Set(['/manifest.webmanifest', '/favicon.svg', '/favicon.png', '/icon-192.png', '/icon-512.png',
  '/apple-touch-icon.png']);
const isExempt = url => url === '/health' || url === '/api/health' || url.startsWith('/api/device/') || PUBLIC_ASSETS.has(url);
const wantsPage = request => request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/uploads/') &&
  String(request.headers.accept || '').includes('text/html');

function installDeviceGate(app, registry) {
  app.addHook('onRequest', async (request, reply) => {
    const url = request.raw.url.split('?')[0];
    if (isExempt(url)) return;
    const token = readDeviceCookie(request);
    if (registry.isAuthorized(token)) {
      registry.touch(token);
      request.deviceToken = token;
      // Opening the app keeps the cookie from expiring on devices in regular use.
      if (wantsPage(request)) reply.header('set-cookie', deviceCookie(request, token));
      return;
    }
    if (wantsPage(request)) return reply.code(401).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(GATE_PAGE);
    return reply.code(401).send({ error: '这台设备还没有授权，请刷新页面获取配对码', code: 'DEVICE_NOT_AUTHORIZED' });
  });
}

async function deviceRoutes(fastify, { registry }) {
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };

  // --- Public, for the pairing page ---
  fastify.get('/device/page', async (request, reply) => reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(GATE_PAGE));

  fastify.post('/device/pair', handle(async (request, reply) => {
    let token = readDeviceCookie(request);
    if (registry.isAuthorized(token)) return { authorized: true };
    if (!token || token.length < 32) {
      token = randomBytes(32).toString('base64url');
      reply.header('set-cookie', deviceCookie(request, token));
    }
    const pairing = registry.startPairing(token, clientInfo(request, registry));
    return { authorized: false, ...pairing };
  }));

  fastify.get('/device/status', handle(async request => {
    const token = readDeviceCookie(request);
    if (registry.isAuthorized(token)) return { authorized: true };
    const pending = token ? registry.pendingFor(token) : null;
    return { authorized: false, code: pending?.code ?? null, expires_at: pending?.expires_at ?? null };
  }));

  // --- Parent console (parent-only in auth.js) ---
  let failures = [];
  fastify.get('/devices', handle(async request => registry.list(request.deviceToken)));
  fastify.get('/devices/events', handle(async request => registry.events(Math.min(200, Math.max(1, Number(request.query.limit) || 50)))));
  fastify.post('/devices/approve', handle(async request => {
    failures = failures.filter(time => Date.now() - time < 10 * 60000);
    if (failures.length >= 10) {
      registry.record('approve_blocked', clientInfo(request, registry));
      throw { status: 429, message: '配对码错误次数过多，请 10 分钟后再试' };
    }
    try {
      return registry.approve(request.body?.code, request.body?.label, clientInfo(request, registry));
    } catch (err) {
      if (err.status === 404) failures.push(Date.now());
      throw err;
    }
  }));
  fastify.delete('/devices/:id', handle(async request => registry.remove(request.params.id, clientInfo(request, registry))));
}

// The only page an unauthorized device can load: it requests a pairing code and waits for approval.
const GATE_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>设备授权 · 小学霸作业任务管理站</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
    background: #F4F6FB; color: #1e293b; }
  main { width: 100%; max-width: 420px; background: #fff; border: 1px solid #e2e8f0; border-radius: 24px; padding: 28px 24px;
    text-align: center; box-shadow: 0 10px 30px rgba(108, 99, 255, .08); }
  .icon { font-size: 44px; }
  h1 { font-size: 22px; margin: 8px 0 4px; }
  p { color: #64748b; font-size: 14px; line-height: 1.7; margin: 6px 0; }
  .code { margin: 18px 0 8px; font-size: 44px; font-weight: 800; letter-spacing: 6px; color: #6C63FF; font-variant-numeric: tabular-nums; }
  .hint { font-size: 13px; color: #94a3b8; }
  .box { margin-top: 18px; padding: 12px 14px; border-radius: 16px; background: #f8fafc; text-align: left; font-size: 13px; color: #475569; line-height: 1.8; }
  .error { color: #e11d48; }
  button { margin-top: 14px; border: 0; border-radius: 14px; padding: 12px 20px; font-size: 15px; font-weight: 700; background: #6C63FF; color: #fff; }
</style>
</head>
<body>
<main>
  <div class="icon">🔐</div>
  <h1>这台设备还没有授权</h1>
  <p>请家长在已授权的设备上打开<br><b>家长后台 → 备份与设置 → 设备授权</b>，输入下面的配对码。</p>
  <div class="code" id="code">······</div>
  <div class="hint" id="hint">正在获取配对码…</div>
  <div class="box">授权完成后，本页会自动进入应用，这台设备以后就不用再配对了。<br>还没有任何已授权设备时，在服务器上运行：<br><code>docker exec taskie-app node src/cli.js approve-device 配对码 备注</code></div>
  <button id="retry" hidden>重新获取配对码</button>
</main>
<script>
  const codeEl = document.getElementById('code'), hintEl = document.getElementById('hint'), retry = document.getElementById('retry');
  const next = location.pathname.startsWith('/api/') ? '/' : location.pathname + location.search;
  let expiresAt = 0, timer = null;
  const done = () => location.replace(next);
  async function pair() {
    retry.hidden = true;
    hintEl.className = 'hint';
    try {
      const res = await fetch('/api/device/pair', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json();
      if (data.authorized) return done();
      if (!res.ok) throw new Error(data.error || '获取配对码失败');
      codeEl.textContent = data.code.slice(0, 3) + ' ' + data.code.slice(3);
      expiresAt = Date.parse(data.expires_at);
      tick();
    } catch (err) {
      hintEl.textContent = err.message || '无法连接服务器';
      hintEl.className = 'hint error';
      retry.hidden = false;
    }
  }
  async function tick() {
    clearTimeout(timer);
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    if (left === 0) { codeEl.textContent = '······'; hintEl.textContent = '配对码已过期'; retry.hidden = false; return; }
    hintEl.textContent = '配对码 ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + ' 后过期，授权后自动进入';
    try {
      const status = await (await fetch('/api/device/status', { credentials: 'same-origin' })).json();
      if (status.authorized) return done();
    } catch {}
    timer = setTimeout(tick, 3000);
  }
  retry.onclick = pair;
  pair();
</script>
</body>
</html>
`;

module.exports = { DeviceRegistry, installDeviceGate, deviceRoutes, hashToken, readDeviceCookie, COOKIE };
