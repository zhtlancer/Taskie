const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { TarReader } = require('../src/utils/tar');

async function setup(t) {
  const c = createTestApp(); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const child = (await c.app.inject({ method: 'POST', url: '/api/children', payload: { name: 'Regression' } })).json();
  const add = (name, bytes) => {
    fs.writeFileSync(path.join(c.tempUploadDir, name), bytes);
    c.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: name, photo_path: `/uploads/${name}` });
  };
  return { ...c, add, service: c.app.backupService };
}
const ticket = c => c.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: { scope: 'new' } });
const unpack = bytes => { const out = {}; const r = new TarReader((name, data) => { out[name] = data.toString(); }, { maxFileSize: 1e7 }); r.push(bytes); r.end(); return out; };

test('N5: warm backup queries and creation never read photo bytes, even after restart', async t => {
  const c = await setup(t), photo = Buffer.alloc(2 * 1024 * 1024, 97);
  for (let i = 0; i < 80; i++) c.add(`p-${i}.jpg`, photo);
  await c.service.create();
  const BackupService = require('../src/services/backup.service');
  const restarted = new BackupService(c.db, c.tempUploadDir, c.service.backupDir);
  c.service.photos = restarted.photos;
  c.service.uploadIndex = restarted.uploadIndex;
  let photoReads = 0;
  const isPhoto = file => typeof file === 'string' && /p-\d+\.jpg$/.test(file);
  for (const method of ['readFileSync', 'createReadStream']) {
    const original = fs[method];
    t.mock.method(fs, method, function(file, ...args) {
      if (isPhoto(file)) photoReads++;
      return original.call(this, file, ...args);
    });
  }
  const original = fs.promises.open;
  t.mock.method(fs.promises, 'open', function(file, ...args) {
    if (isPhoto(file)) photoReads++;
    return original.call(this, file, ...args);
  });
  const start = performance.now();
  assert.equal((await c.app.inject({ url: '/api/backups' })).statusCode, 200);
  assert.ok(performance.now() - start < 500, '160 MiB of photos must list within 500 ms');
  await c.service.create();
  assert.equal(photoReads, 0, 'warm queries and backups must only read cached digests');
});

test('N5: first legacy manifest scan yields to the event loop', async t => {
  const c = await setup(t);
  const file = path.join(c.service.backupDir, 'backup-2020-01-01T00-00-00-000-legacy.taskie.gz');
  fs.writeFileSync(file, gzipSync(JSON.stringify({ format: 'taskie-backup', version: 1, database: '', photos: { 'legacy.jpg': 'A'.repeat(16 * 1024 * 1024) } })));
  let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try { assert.equal((await c.app.inject({ url: '/api/backups' })).statusCode, 200); }
  finally { clearInterval(timer); }
  assert.ok(ticks >= 2, `legacy scan must let other requests run (ticks=${ticks})`);
});

test('R1: ticket reports mixed bad photos and export skips them without recording them', async t => {
  const c = await setup(t);
  for (const name of ['good.jpg', 'bad.jpg', 'gone.jpg', 'fallback.jpg']) c.add(name, name);
  await c.service.create();
  for (const name of ['bad.jpg', 'gone.jpg']) {
    fs.rmSync(c.service.photos.path(name)); fs.rmSync(path.join(c.tempUploadDir, name));
  }
  fs.writeFileSync(c.service.photos.path('bad.jpg'), 'wrong');
  fs.writeFileSync(c.service.photos.path('fallback.jpg'), 'wrong');
  const response = await ticket(c); assert.equal(response.statusCode, 200, response.body);
  const data = response.json(); assert.equal(data.included_count, 2);
  assert.deepEqual(data.skipped.map(p => [p.name, p.reason]), [['bad.jpg', 'mismatch'], ['gone.jpg', 'absent']]);
  assert.equal(data.skipped[0].subject, '数学'); assert.equal(data.skipped[0].description, 'bad.jpg'); assert.ok(data.skipped[0].created_at);
  const out = await c.rawInject({ url: data.url }); assert.equal(out.statusCode, 200);
  assert.deepEqual(unpack(out.rawPayload), { 'fallback.jpg': 'fallback.jpg', 'good.jpg': 'good.jpg' });
  assert.deepEqual(c.service.exportState().names.sort(), ['fallback.jpg', 'good.jpg']);
});

test('R1: corruption after ticket and immediately before tar emission still skips only that photo', async t => {
  const c = await setup(t);
  for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) c.add(name, name);
  await c.service.create();
  const data = (await ticket(c)).json();
  for (const file of [c.service.photos.path('a.jpg'), path.join(c.tempUploadDir, 'a.jpg')]) fs.writeFileSync(file, 'WRONG');
  const original = c.service.exportEntries.bind(c.service);
  t.mock.method(c.service, 'exportEntries', async (...args) => {
    const entries = await original(...args);
    for (const file of [c.service.photos.path('b.jpg'), path.join(c.tempUploadDir, 'b.jpg')]) fs.writeFileSync(file, 'WRONG');
    return entries;
  });
  const out = await c.rawInject({ url: data.url }); assert.equal(out.statusCode, 200);
  assert.deepEqual(unpack(out.rawPayload), { 'c.jpg': 'c.jpg' });
  assert.deepEqual(c.service.exportState().names, ['c.jpg']);
});

test('N5: same-size edits, timestamp changes and inode replacement invalidate cached digests', async t => {
  const c = await setup(t);
  c.add('change.jpg', 'correct'); await c.service.create();
  const file = path.join(c.tempUploadDir, 'change.jpg');
  const mtime = fs.statSync(file).mtime;
  fs.writeFileSync(file, 'WRONG!!'); fs.utimesSync(file, mtime, mtime);
  assert.equal((await c.service.missingPhotos())[0].reason, 'mismatch');
  const replacement = path.join(c.tempUploadDir, '.replacement');
  fs.writeFileSync(replacement, 'correct'); fs.utimesSync(replacement, mtime, mtime); fs.renameSync(replacement, file);
  assert.deepEqual(await c.service.missingPhotos(), []);
  fs.utimesSync(file, 1, 1);
  assert.deepEqual(await c.service.missingPhotos(), []);
});

test('K2: restore and import verify bytes even when cached metadata falsely says correct', async t => {
  const c = await setup(t);
  c.add('verify.jpg', 'correct'); const backup = await c.service.create();
  const archive = fs.readFileSync(c.service.getPath(backup.name));
  const photo = c.service.expectations().get('verify.jpg');
  const upload = path.join(c.tempUploadDir, 'verify.jpg');
  const corrupt = file => {
    fs.writeFileSync(file, 'WRONG!!'); const stat = fs.statSync(file);
    return { size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino, dev: stat.dev, sha256: photo.sha256 };
  };
  c.service.photos.index['verify.jpg'] = corrupt(c.service.photos.path('verify.jpg'));
  c.service.uploadIndex[upload] = corrupt(upload);
  assert.deepEqual((await c.service.restore(archive)).missing_photos, ['verify.jpg']);
  assert.equal(fs.existsSync(upload), false);
  c.service.uploadIndex[upload] = corrupt(upload);
  const { tarStream } = require('../src/utils/tar');
  const source = path.join(c.tempUploadDir, '.good'); fs.writeFileSync(source, 'correct');
  const result = await c.service.importPhotos(tarStream([{ name: 'verify.jpg', file: source }]));
  assert.equal(result.imported, 1);
  assert.equal(fs.readFileSync(upload, 'utf8'), 'correct');
  assert.equal(fs.readFileSync(c.service.photos.path('verify.jpg'), 'utf8'), 'correct');
});

test('N5: photo hashing allows health requests and keeps the database snapshot consistent', async t => {
  const c = await setup(t);
  c.add('snapshot.jpg', Buffer.alloc(8 * 1024 * 1024, 97));
  const add = c.service.photos.add.bind(c.service.photos);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  t.mock.method(c.service.photos, 'add', async (...args) => { reached(); await blocked; return add(...args); });
  const creating = c.service.create();
  await entered;
  try {
    assert.equal((await c.app.inject({ url: '/api/health' })).statusCode, 200);
    c.add('later.jpg', 'later');
  } finally { release(); }
  const backup = await creating;
  const data = JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(c.service.getPath(backup.name))));
  assert.deepEqual(data.photo_manifest.map(p => p.name), ['snapshot.jpg']);
  const Database = require('better-sqlite3'); const db = new Database(Buffer.from(data.database, 'base64'));
  try { assert.equal(db.prepare('SELECT COUNT(*) n FROM mistake_records').get().n, 1); }
  finally { db.close(); }
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM mistake_records').get().n, 2);
});

test('R1: all missing photos produce a valid empty tar and remain pending', async t => {
  const c = await setup(t); c.add('gone.jpg', 'gone'); await c.service.create();
  fs.rmSync(path.join(c.tempUploadDir, 'gone.jpg')); fs.rmSync(c.service.photos.path('gone.jpg'));
  const issued = (await ticket(c)).json();
  assert.equal(issued.included_count, 0); assert.equal(issued.skipped[0].reason, 'absent');
  const result = await c.rawInject({ url: issued.url });
  assert.equal(result.statusCode, 200); assert.deepEqual(unpack(result.rawPayload), {});
  assert.deepEqual(c.service.exportState().names, []);
  assert.equal((await c.service.photoExportStatus()).pending_count, 1);
});

test('R1: session changes during asynchronous ticket verification cannot mint a fresh ticket', async t => {
  const c = await setup(t); c.add('one.jpg', 'one');
  const original = c.service.exportEntries.bind(c.service);
  t.mock.method(c.service, 'exportEntries', async scope => {
    const entries = await original(scope);
    c.db.prepare("UPDATE settings SET value = 'changed' WHERE key = 'auth_epoch'").run();
    return entries;
  });
  assert.equal((await ticket(c)).statusCode, 401);
});
