// Device authorization: a gate in front of the whole app, for exposing it beyond the home network.
//
// Every browser gets a random device token in an HttpOnly cookie. Until the token is authorized,
// the browser only sees a page with a short pairing code; a parent enters that code in the parent
// console (or runs `node src/cli.js approve-device <code>` on the server) to authorize it. The
// authorized_tokens file lists authorized devices by token hash, one per line, and can be edited by
// hand: deleting a line revokes that device. Tokens never appear in the file, logs or the UI.
// Source IPs are never trusted: behind frp every request seems to come from the same host.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

const COOKIE = 'taskie_device';
const COOKIE_MAX_AGE = 400 * 24 * 3600; // browsers cap cookie lifetimes at 400 days
const PAIRING_MINUTES = 10;
const MAX_ACTIVE_PAIRINGS = 30;
const FILE_HEADER = [
  '# Taskie 已授权设备：每行为 <令牌 SHA-256> <授权时间> <备注>。',
  '# 删除某一行即可撤销该设备；令牌本身不会保存在这里。',
  ''
].join('\n');

const hashToken = token => createHash('sha256').update(token).digest('hex');
const isHash = value => /^[0-9a-f]{64}$/.test(value);
const cleanLabel = label => String(label ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 30) || '未命名设备';

class DeviceRegistry {
  constructor(db, file) {
    this.db = db;
    this.file = file;
    this.cache = { mtimeMs: -1, size: -1, entries: [] };
    this.seen = new Map();
  }

  // Authorized devices from the file, re-read whenever it changes on disk.
  entries() {
    let stat;
    try {
      stat = fs.statSync(this.file);
    } catch {
      return [];
    }
    if (stat.mtimeMs !== this.cache.mtimeMs || stat.size !== this.cache.size) {
      const entries = fs.readFileSync(this.file, 'utf8').split('\n').map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
          const [hash, createdAt, ...label] = line.split(/\s+/);
          return { hash: hash.toLowerCase(), created_at: createdAt || null, label: label.join(' ') || '未命名设备' };
        })
        .filter(entry => isHash(entry.hash));
      this.cache = { mtimeMs: stat.mtimeMs, size: stat.size, entries };
    }
    return this.cache.entries;
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
  remove(id) {
    if (!/^[0-9a-f]{16}$/.test(id ?? '')) throw { status: 400, message: '设备编号无效' };
    const lines = this.readLines();
    const kept = lines.filter(line => !line.trim().toLowerCase().startsWith(id));
    if (kept.length === lines.length) throw { status: 404, message: '设备不存在' };
    this.writeLines(kept);
    return { success: true, id };
  }

  list(currentToken) {
    const current = currentToken ? hashToken(currentToken) : null;
    const lastSeen = this.db.prepare('SELECT token_hash, last_seen_at FROM device_seen').all();
    const seen = new Map(lastSeen.map(row => [row.token_hash, row.last_seen_at]));
    return this.entries().map(entry => ({
      id: entry.hash.slice(0, 16),
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
  startPairing(token) {
    const existing = this.pendingFor(token);
    if (existing) return existing;
    if (this.db.prepare('SELECT COUNT(*) AS n FROM device_pairings').get().n >= MAX_ACTIVE_PAIRINGS) {
      throw { status: 429, message: '配对请求过多，请稍后再试' };
    }
    const taken = new Set(this.db.prepare('SELECT code FROM device_pairings').all().map(row => row.code));
    let code;
    do code = String(randomInt(0, 1000000)).padStart(6, '0'); while (taken.has(code));
    const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60000).toISOString();
    this.db.prepare('INSERT INTO device_pairings (code, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(code, hashToken(token), new Date().toISOString(), expiresAt);
    return { code, expires_at: expiresAt };
  }

  approve(code, label) {
    const normalized = String(code ?? '').replace(/\D/g, '');
    if (normalized.length !== 6) throw { status: 400, message: '请输入新设备上显示的 6 位配对码' };
    this.purgeExpired();
    const pairing = this.db.prepare('SELECT token_hash FROM device_pairings WHERE code = ?').get(normalized);
    if (!pairing) throw { status: 404, message: '配对码无效或已过期，请在新设备上刷新获取新的配对码' };
    this.add(pairing.token_hash, label);
    this.db.prepare('DELETE FROM device_pairings WHERE code = ?').run(normalized);
    return this.list().find(device => device.id === pairing.token_hash.slice(0, 16));
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

const isExempt = url => url === '/health' || url === '/api/health' || url.startsWith('/api/device/');
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
    const pairing = registry.startPairing(token);
    fastify.log.info({ code: pairing.code }, '新设备请求配对');
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
  fastify.post('/devices/approve', handle(async request => {
    failures = failures.filter(time => Date.now() - time < 10 * 60000);
    if (failures.length >= 10) throw { status: 429, message: '配对码错误次数过多，请 10 分钟后再试' };
    try {
      const device = registry.approve(request.body?.code, request.body?.label);
      fastify.log.info({ device: device.id, label: device.label }, '已授权新设备');
      return device;
    } catch (err) {
      if (err.status === 404) failures.push(Date.now());
      throw err;
    }
  }));
  fastify.delete('/devices/:id', handle(async request => registry.remove(request.params.id)));
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
