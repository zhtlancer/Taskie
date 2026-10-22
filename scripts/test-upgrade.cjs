// Upgrade regression against real old code: the backend of UPGRADE_FROM (default 0b4128c, the last
// release with the v1 backup format) is taken from git history with `git archive`, seeds data, adds
// mistake photos and makes a v1 backup; the current backend then upgrades that data directory,
// restores the v1 backup on a blank instance, and restores its own v2 backup on another blank
// instance whose missing photos are filled from photo packages. Tables (old columns, all rows) and
// photos (SHA-256) must match at every step.
//   npm ci --prefix backend && npm run test:upgrade
// Needs the old commit in the local clone (CI checks out with fetch-depth: 0) and system `tar`.
// Uses UPGRADE_PORT..UPGRADE_PORT+3 (default 4191-4194); UPGRADE_KEEP=1 keeps the work directory.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const NEW = path.join(ROOT, 'backend');
const FROM = process.env.UPGRADE_FROM || '0b4128c43fba7afb89d2096cded4bd2ebff29ab0';
const PORT = Number(process.env.UPGRADE_PORT || 4191);
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-upgrade-'));
const OLD = path.join(WORK, 'old/backend');
const EMPTY_DIST = path.join(WORK, 'no-frontend');

if (!fs.existsSync(path.join(NEW, 'node_modules/better-sqlite3'))) {
  console.error('Install the backend first: npm ci --prefix backend');
  process.exit(1);
}
const Database = require(path.join(NEW, 'node_modules/better-sqlite3'));
const { SCHEMA_VERSION } = require(path.join(NEW, 'src/db'));

const results = [];
const check = (id, ok, detail = '') => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` — ${detail}` : ''}`);
};
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const servers = [];

// Distinct small PNGs (the server re-encodes uploads, so the stored bytes are what is compared).
function png(r, g, b, w = 64, h = 48) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (r + x) & 255; raw[o + 1] = (g + y) & 255; raw[o + 2] = b;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// The old backend from git history. Its dependencies are reused when the lockfile is unchanged.
function extractOld() {
  try { execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${FROM}^{commit}`], { stdio: 'ignore' }); } catch {
    throw new Error(`commit ${FROM} is not in this clone: fetch full history (actions/checkout fetch-depth: 0, or git fetch --unshallow)`);
  }
  fs.mkdirSync(path.dirname(OLD), { recursive: true });
  const archive = path.join(WORK, 'old.tar');
  execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', archive, FROM, 'backend']);
  execFileSync('tar', ['-xf', archive, '-C', path.dirname(OLD)]);
  const oldLock = fs.readFileSync(path.join(OLD, 'package-lock.json'), 'utf8');
  if (oldLock === fs.readFileSync(path.join(NEW, 'package-lock.json'), 'utf8')) {
    fs.symlinkSync(path.join(NEW, 'node_modules'), path.join(OLD, 'node_modules'), 'dir');
  } else {
    execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: OLD, stdio: 'inherit' });
  }
}

async function startServer(name, backend, port, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(WORK, `${name}.log`);
  const log = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, ['src/server.js'], { cwd: backend, stdio: ['ignore', log, log], env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1',
    DATABASE_PATH: path.join(dataDir, 'data.sqlite'), UPLOAD_DIR: path.join(dataDir, 'uploads'),
    BACKUP_DIR: path.join(dataDir, 'backups'), DEVICE_AUTH: 'off', BACKUP_INTERVAL_HOURS: '0', CLIENT_DIST_DIR: EMPTY_DIST,
  } });
  fs.closeSync(log);
  const server = { name, child, base: `http://127.0.0.1:${port}`, logFile };
  servers.push(server);
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${server.base}/api/health`)).ok) return server; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${name} server did not become healthy on port ${port}; log:\n${fs.readFileSync(logFile, 'utf8').slice(-4000)}`);
}
async function stop(server) {
  if (server.child.exitCode === null) {
    const exited = new Promise(resolve => server.child.once('exit', resolve));
    server.child.kill('SIGTERM');
    await exited;
  }
}

async function api(base, method, url, { token, json, form, raw } = {}) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  let body;
  if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(base + url, { method, headers, body });
  const buf = Buffer.from(await res.arrayBuffer());
  if (raw) return { status: res.status, buf, headers: res.headers };
  let data; try { data = JSON.parse(buf.toString()); } catch { data = buf.toString(); }
  return { status: res.status, data };
}
async function parentToken(base, pin) {
  const login = await api(base, 'POST', '/api/auth/parent-login', { json: { pin } });
  assert.equal(login.status, 200, `parent login with ${pin}: ${JSON.stringify(login.data)}`);
  if (!login.data.must_change_pin) return login.data.token;
  const change = await api(base, 'PUT', '/api/auth/parent-pin', { token: login.data.token, json: { old_pin: pin, new_pin: '2580' } });
  assert.equal(change.status, 200, JSON.stringify(change.data));
  return parentToken(base, '2580');
}
async function addMistake(base, token, childId, description, image) {
  const form = new FormData();
  form.append('child_id', childId); form.append('subject', '数学'); form.append('description', description);
  form.append('photo', new Blob([image], { type: 'image/png' }), 'p.png');
  const res = await api(base, 'POST', '/api/mistakes', { token, form });
  assert.ok(res.status < 300, `add mistake: ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}
// Everyday use through the old code's own API, so the upgrade carries more than seed data: points,
// rewards, holiday periods, outside classes with attendance and fees, homework, characters,
// timetables and make-up days.
async function useOldApp(base, token, kids) {
  const must = async (label, method, url, json) => {
    const res = await api(base, method, url, { token, json });
    assert.ok(res.status < 300, `old code: ${label}: ${res.status} ${JSON.stringify(res.data)}`);
    return res.data;
  };
  const [a, b] = kids;
  const shift = days => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: process.env.TIME_ZONE || 'Asia/Shanghai' });
  for (const kid of kids) {
    const tasks = await must('list daily tasks', 'GET', `/api/daily-tasks?child_id=${kid.id}`);
    if (tasks.length) await must('complete a daily task', 'POST', `/api/daily-tasks/${tasks[0].id}/complete`);
  }
  await must('add an ad hoc task', 'POST', `/api/children/${a.id}/adhoc-tasks`, { title: '订正练习', subject: '语文' });
  const reward = await must('add a reward', 'POST', '/api/reward-items', { title: '看动画', icon_emoji: '📺', cost: 1 });
  await must('redeem a reward', 'POST', `/api/children/${a.id}/redemptions`, { reward_id: reward.id });
  const period = await must('add a holiday period', 'POST', `/api/children/${a.id}/periods`, { name: '寒假', start_date: shift(-3), end_date: shift(30) });
  const book = await must('add a period task', 'POST', `/api/periods/${period.id}/tasks`, { subject: '语文', title: '寒假作业', mode: 'progress', total_amount: 40, unit: '页', points: 2 });
  await must('log period progress', 'POST', `/api/period-tasks/${book.id}/logs`, { amount: 3 });
  const lesson = await must('add an outside class', 'POST', '/api/outside-classes', { title: '钢琴', child_ids: [a.id, b.id], start_date: shift(-5), days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00', total_lessons: 12 });
  await must('record attendance', 'PUT', `/api/outside-classes/${lesson.id}/attendance`, { child_id: a.id, lesson_date: shift(-1), status: 'attended' });
  await must('record a fee', 'PUT', `/api/outside-classes/${lesson.id}/fee`, { child_id: a.id, total_fee_cents: 20000 });
  await must('record homework', 'POST', `/api/children/${b.id}/homework`, { course_kind: 'school', subject: '科学', content: '完成实验报告' });
  await must('add a character', 'POST', '/api/characters', { child_id: a.id, char: '森', pinyin: 'sēn', strokes: 12, radical: '木' });
  await must('add a timetable', 'POST', `/api/children/${b.id}/timetables`, {
    name: '四年级上学期', start_date: shift(-30), end_date: shift(90), lessons: [{ slot_id: 's1', weekday: 1, subject: '数学' }],
    slots: [{ id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' }],
  });
  await must('add a make-up day', 'POST', `/api/children/${a.id}/makeup-days`, { date: shift(10), acts_as: 1 });
}
const upload = (name, buf, fields = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([buf]), name);
  return form;
};

// Every table's rows as JSON, limited to the given columns per table (the old schema), so columns a
// later version adds do not count as changes.
function schemaOf(file) {
  const db = new Database(file, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const schema = Object.fromEntries(tables.map(({ name }) => [name, db.pragma(`table_info("${name}")`).map(c => c.name)]));
  db.close();
  return schema;
}
function dumpTables(file, schema = schemaOf(file)) {
  const db = new Database(file, { readonly: true });
  const present = schemaOf(file);
  const out = { __version: db.pragma('user_version', { simple: true }), __missing: [] };
  for (const [name, columns] of Object.entries(schema)) {
    const missing = columns.filter(c => !(present[name] || []).includes(c));
    if (!present[name] || missing.length) { out.__missing.push(present[name] ? `${name}(${missing.join(',')})` : name); continue; }
    const list = columns.map(c => `"${c}"`).join(',');
    out[name] = db.prepare(`SELECT ${list} FROM "${name}" ORDER BY ${list}`).all().map(row => JSON.stringify(row));
  }
  db.close();
  return out;
}
// The parent PIN is changed during the run, so settings are compared separately where it matters.
function differences(before, after, ignore = ['settings']) {
  const diffs = [...after.__missing.map(t => `${t}: missing`)];
  for (const table of Object.keys(before)) {
    if (table.startsWith('__') || ignore.includes(table) || !after[table]) continue;
    const kept = new Set(after[table]);
    const lost = before[table].filter(row => !kept.has(row));
    if (lost.length || before[table].length !== after[table].length) diffs.push(`${table}: ${before[table].length} rows before, ${after[table].length} after, ${lost.length} changed or lost`);
  }
  return diffs;
}
const photosIn = dir => Object.fromEntries(fs.readdirSync(dir).filter(n => !n.startsWith('.'))
  .filter(n => fs.statSync(path.join(dir, n)).isFile()).map(n => [n, sha(fs.readFileSync(path.join(dir, n)))]));
const sameMap = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);
function tarList(buf) {
  const file = path.join(WORK, `list-${crypto.randomUUID()}.tar`);
  fs.writeFileSync(file, buf);
  return execFileSync('tar', ['-tf', file], { encoding: 'utf8' }).split('\n').map(n => n.replace(/^\.\//, '')).filter(n => n && !n.endsWith('/')).sort();
}

async function main() {
  fs.mkdirSync(EMPTY_DIST);
  extractOld();
  const images = [png(10, 20, 30), png(200, 10, 90), png(5, 250, 5), png(90, 90, 250)];

  // 1. Old code: seeded family, mistakes with photos, a v1 backup.
  const oldDir = path.join(WORK, 'old-data');
  fs.mkdirSync(oldDir);
  execFileSync(process.execPath, ['src/db/seed.js'], { cwd: OLD, env: { ...process.env, DATABASE_PATH: path.join(oldDir, 'data.sqlite') }, stdio: 'ignore' });
  const old = await startServer('old', OLD, PORT, oldDir);
  let token = await parentToken(old.base, '1234');
  const kids = (await api(old.base, 'GET', '/api/children', { token })).data;
  assert.ok(kids.length >= 2, `seed creates two children: ${JSON.stringify(kids)}`);
  for (let i = 0; i < 3; i++) await addMistake(old.base, token, kids[i < 2 ? 0 : 1].id, `旧版错题${i}`, images[i]);
  await useOldApp(old.base, token, kids);
  const oldBackup = await api(old.base, 'POST', '/api/backups', { token });
  check('OLD-1 old code creates a backup', oldBackup.status === 200, `${oldBackup.status} ${oldBackup.data.name}`);
  const v1 = await api(old.base, 'GET', `/api/backups/${oldBackup.data.name}/download`, { token, raw: true });
  const v1json = JSON.parse(zlib.gunzipSync(v1.buf));
  check('OLD-2 old backup is format v1 with the 3 photos embedded', v1json.version === 1 && Object.keys(v1json.photos || {}).length === 3,
    `version=${v1json.version} photos=${Object.keys(v1json.photos || {}).length}`);
  await stop(old);
  const oldSchema = schemaOf(path.join(oldDir, 'data.sqlite'));
  const oldDump = dumpTables(path.join(oldDir, 'data.sqlite'));
  check('OLD-3 old database is older than the current schema', oldDump.__version < SCHEMA_VERSION, `old v${oldDump.__version}, current v${SCHEMA_VERSION}`);
  const filled = ['point_logs', 'reward_items', 'reward_redemptions', 'periods', 'period_tasks', 'period_task_logs', 'outside_classes',
    'outside_class_attendance', 'outside_class_fees', 'homework_records', 'characters', 'timetables', 'makeup_days', 'mistake_records'];
  const empty = filled.filter(t => !(oldDump[t] || []).length);
  check('OLD-4 the old data covers everyday use (points, rewards, periods, classes, homework, timetables)', empty.length === 0, empty.length ? `empty: ${empty.join(', ')}` : `${Object.keys(oldDump).filter(t => !t.startsWith('__') && oldDump[t].length).length} tables with rows`);
  const oldPhotos = photosIn(path.join(oldDir, 'uploads'));

  // 2. Current code on a copy of the old data directory: upgrade in place.
  const upDir = path.join(WORK, 'upgraded');
  fs.cpSync(oldDir, upDir, { recursive: true });
  const up = await startServer('upgraded', NEW, PORT + 1, upDir);
  token = await parentToken(up.base, '2580');
  const upDump = dumpTables(path.join(upDir, 'data.sqlite'), oldSchema);
  check('UPG-1 the data directory is upgraded to the current schema', upDump.__version === SCHEMA_VERSION, `v${oldDump.__version} -> v${upDump.__version}`);
  check('UPG-2 every old table and column still exists', upDump.__missing.length === 0, upDump.__missing.join(', '));
  const upDiff = differences(oldDump, upDump);
  check('UPG-3 every pre-existing row survives the upgrade unchanged (all tables except settings)', upDiff.length === 0, upDiff.join('; '));
  let served = 0, servedOk = true;
  for (const kid of kids) {
    for (const mistake of (await api(up.base, 'GET', `/api/mistakes?child_id=${kid.id}`, { token })).data) {
      if (!mistake.photo_path) continue;
      const photo = await api(up.base, 'GET', mistake.photo_path, { token, raw: true });
      served++;
      if (photo.status !== 200 || oldPhotos[path.basename(mistake.photo_path)] !== sha(photo.buf)) servedOk = false;
    }
  }
  check('UPG-4 old photos are served byte-identical after the upgrade', servedOk && served === 3, `${served} served`);
  const listed = (await api(up.base, 'GET', '/api/backups', { token })).data;
  check('UPG-5 the v1 backup made by old code is still listed', (listed.backups || []).some(b => b.name === oldBackup.data.name));

  // Backups after the upgrade: records plus a photo manifest; each photo stored once.
  const v2 = await api(up.base, 'POST', '/api/backups', { token });
  const v2json = JSON.parse(zlib.gunzipSync((await api(up.base, 'GET', `/api/backups/${v2.data.name}/download`, { token, raw: true })).buf));
  const manifest = v2json.photo_manifest || [];
  check('FLOW-1 a new backup holds records and a photo manifest (SHA-256), not the photos',
    v2.status === 200 && v2json.version >= 2 && !v2json.photos && manifest.length === 3 && manifest.every(p => oldPhotos[p.name] === p.sha256),
    `version=${v2json.version} manifest=${manifest.length}`);
  const stored = () => fs.readdirSync(path.join(upDir, 'backups/photos')).filter(n => n !== 'index.json').length;
  check('FLOW-2 the photo store holds each photo once', stored() === 3, `${stored()} stored`);
  await api(up.base, 'POST', '/api/backups', { token });
  check('FLOW-3 a second backup does not copy the photos again', stored() === 3, `${stored()} stored`);

  const exportAll = async () => {
    const ticket = await api(up.base, 'POST', '/api/backups/photos/export-ticket', { token, json: {} });
    assert.equal(ticket.status, 200, JSON.stringify(ticket.data));
    return api(up.base, 'GET', ticket.data.url, { raw: true });
  };
  const allTar = await exportAll();
  const allNames = tarList(allTar.buf);
  check('FLOW-4 "all photos" is a .tar that system tar reads, with all 3 photos', allTar.status === 200 && sameMap(Object.fromEntries(allNames.map(n => [n, 1])), Object.fromEntries(Object.keys(oldPhotos).map(n => [n, 1]))), allNames.join(','));
  const forged = await api(up.base, 'GET', '/api/backups/photos/export?ticket=bogus', { raw: true });
  check('FLOW-5 a photo export without a valid ticket is refused', forged.status === 401, String(forged.status));
  const added = await addMistake(up.base, token, kids[1].id, '新版错题', images[3]);
  const allTar2 = await exportAll();
  const allNames2 = tarList(allTar2.buf);
  check('FLOW-6 "all photos" made later also holds the photo added after the upgrade', allNames2.length === 4 && allNames2.includes(path.basename(added.photo_path)), allNames2.join(','));
  const final = await api(up.base, 'POST', '/api/backups', { token });
  const v2file = (await api(up.base, 'GET', `/api/backups/${final.data.name}/download`, { token, raw: true })).buf;
  await stop(up);
  const upFinal = dumpTables(path.join(upDir, 'data.sqlite'));
  const upPhotos = photosIn(path.join(upDir, 'uploads'));

  // 3. A blank current instance restores the v1 backup made by old code (photos embedded).
  const blankV1 = path.join(WORK, 'blank-v1');
  const b1 = await startServer('blank-v1', NEW, PORT + 2, blankV1);
  const t1 = await parentToken(b1.base, '1234');
  const r1 = await api(b1.base, 'POST', '/api/backups/restore', { token: t1, form: upload('v1.taskie.gz', v1.buf, { pin: '2580' }) });
  check('V1-1 the v1 backup from old code restores on a blank instance with no photo missing', r1.status === 200 && (r1.data.missing_photos || []).length === 0, `${r1.status} ${JSON.stringify(r1.data).slice(0, 300)}`);
  await stop(b1);
  const b1Dump = dumpTables(path.join(blankV1, 'data.sqlite'), oldSchema);
  const b1Diff = differences(oldDump, b1Dump);
  check('V1-2 restored records equal the old data, upgraded to the current schema', b1Diff.length === 0 && b1Dump.__version === SCHEMA_VERSION, `v${b1Dump.__version} ${b1Diff.join('; ')}`);
  check('V1-3 embedded photos are restored byte-identical', sameMap(photosIn(path.join(blankV1, 'uploads')), oldPhotos));

  // 4. Another blank instance ("a new server") restores the v2 backup, then fills photos from packages.
  const blankV2 = path.join(WORK, 'blank-v2');
  const b2 = await startServer('blank-v2', NEW, PORT + 3, blankV2);
  let t2 = await parentToken(b2.base, '1234');
  const r2 = await api(b2.base, 'POST', '/api/backups/restore', { token: t2, form: upload('v2.taskie.gz', v2file, { pin: '2580' }) });
  check('NEW-1 the v2 backup restores on a new server and reports the 4 photos it lacks', r2.status === 200 && (r2.data.missing_photos || []).length === 4, `${r2.status} missing=${(r2.data.missing_photos || []).length}`);
  t2 = await parentToken(b2.base, '2580');
  const info = (await api(b2.base, 'GET', '/api/backups', { token: t2 })).data;
  check('NEW-2 the settings API lists the missing photos', info.missing_photos?.count === 4, JSON.stringify(info.missing_photos).slice(0, 300));
  const importTar = (name, buf) => api(b2.base, 'POST', '/api/backups/photos/import', { token: t2, form: upload(name, buf) });
  const imp1 = await importTar('all-1.tar', allTar.buf);
  check('NEW-3 the first photo package fills its 3 photos and leaves 1 missing', imp1.status === 200 && imp1.data.imported === 3 && imp1.data.missing === 1, `${imp1.status} ${JSON.stringify(imp1.data)}`);
  const imp2 = await importTar('all-2.tar', allTar2.buf);
  check('NEW-4 the later package fills the rest without touching the 3 already present', imp2.status === 200 && imp2.data.imported === 1 && imp2.data.missing === 0, `${imp2.status} ${JSON.stringify(imp2.data)}`);
  const imp3 = await importTar('all-2.tar', allTar2.buf);
  check('NEW-5 importing a package again changes nothing', imp3.status === 200 && imp3.data.imported === 0 && imp3.data.missing === 0, `${imp3.status} ${JSON.stringify(imp3.data)}`);
  // A package unpacked and re-packed with system tar (e.g. on a PC) is accepted too.
  const sysDir = path.join(WORK, 'repacked');
  fs.mkdirSync(sysDir);
  fs.writeFileSync(path.join(WORK, 'all-2.tar'), allTar2.buf);
  execFileSync('tar', ['-xf', path.join(WORK, 'all-2.tar'), '-C', sysDir]);
  execFileSync('tar', ['-cf', path.join(WORK, 'repacked.tar'), '-C', sysDir, '.']);
  const imp4 = await importTar('repacked.tar', fs.readFileSync(path.join(WORK, 'repacked.tar')));
  check('NEW-6 a package re-created with system tar is accepted', imp4.status === 200 && imp4.data.missing === 0, `${imp4.status} ${JSON.stringify(imp4.data)}`);
  await stop(b2);
  const b2Diff = differences(upFinal, dumpTables(path.join(blankV2, 'data.sqlite'), schemaOf(path.join(upDir, 'data.sqlite'))));
  check('NEW-7 restored records equal the source server (all tables except settings)', b2Diff.length === 0, b2Diff.join('; '));
  check('NEW-8 every photo on the new server is byte-identical to the source', sameMap(photosIn(path.join(blankV2, 'uploads')), upPhotos), `${Object.keys(photosIn(path.join(blankV2, 'uploads'))).length} photos`);
}

main().catch(error => { console.error(`FAIL aborted — ${error.stack || error}`); results.push({ id: 'aborted', ok: false }); })
  .finally(async () => {
    for (const server of servers) if (server.child.exitCode === null) server.child.kill('SIGKILL');
    const failed = results.filter(r => !r.ok);
    console.log(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed (from ${FROM.slice(0, 7)} to v${SCHEMA_VERSION})`);
    if (failed.length) {
      process.exitCode = 1;
      for (const server of servers) console.log(`--- ${server.name} server log (tail)\n${fs.readFileSync(server.logFile, 'utf8').slice(-2000)}`);
    }
    if (process.env.UPGRADE_KEEP) console.log(`work directory kept: ${WORK}`);
    else fs.rmSync(WORK, { recursive: true, force: true });
  });
