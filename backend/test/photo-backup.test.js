const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { TarReader, tarStream } = require('../src/utils/tar');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '照片孩子' } })).json();
  const addPhoto = (name, content) => {
    fs.writeFileSync(path.join(ctx.tempUploadDir, name), content);
    ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: name, photo_path: `/uploads/${name}` });
  };
  return { ctx, child, addPhoto };
}
const multipart = (field, filename, file, extra = '') => ({ headers: { 'content-type': 'multipart/form-data; boundary=photo-test' }, payload: Buffer.concat([
  Buffer.from(`${extra}--photo-test\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from('\r\n--photo-test--\r\n')
]) });
const restoreBody = archive => multipart('file', 'backup.taskie.gz', archive, '--photo-test\r\nContent-Disposition: form-data; name="pin"\r\n\r\n1234\r\n');
async function exportPackage(ctx, scope = 'all') {
  const ticket = await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: { scope } });
  assert.equal(ticket.statusCode, 200, ticket.body);
  // The download itself carries no session header, only the ticket.
  const download = await ctx.rawInject({ method: 'GET', url: ticket.json().url });
  assert.equal(download.statusCode, 200, download.body);
  assert.match(download.headers['content-disposition'], /taskie-photos-.*\.tar/);
  return download.rawPayload;
}
const tarNames = buffer => { const names = []; const reader = new TarReader(name => names.push(name), { maxFileSize: 1e9 }); reader.push(buffer); reader.end(); return names; };

test('on a new server the data restores first; missing photos are listed and filled from a photo package', async t => {
  const home = await fixture(t);
  home.addPhoto('a.jpg', 'photo a');
  home.addPhoto('b.webp', 'photo b');
  const archive = fs.readFileSync(home.ctx.app.backupService.getPath((await home.ctx.app.backupService.create()).name));
  const photos = await exportPackage(home.ctx);
  assert.deepEqual(tarNames(photos).sort(), ['a.jpg', 'b.webp']);
  // Standard tar reads the package too.
  const listed = spawnSync('tar', ['-tf', '-'], { input: photos, encoding: 'utf8' });
  if (listed.status === 0) assert.deepEqual(listed.stdout.trim().split('\n').sort(), ['a.jpg', 'b.webp']);

  const away = await fixture(t);
  const restored = await away.ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(archive) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json().missing_photos.sort(), ['a.jpg', 'b.webp']);
  const missing = (await away.ctx.app.inject({ method: 'GET', url: '/api/backups' })).json().missing_photos;
  assert.deepEqual([missing.count, missing.absent, missing.mismatch], [2, 2, 0]);
  assert.deepEqual(missing.sample.map(p => [p.name, p.subject, p.description, p.reason]), [['a.jpg', '数学', 'a.jpg', 'absent'], ['b.webp', '数学', 'b.webp', 'absent']]);

  const imported = await away.ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'photos.tar', photos) });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.deepEqual(imported.json(), { imported: 2, present: 0, unused: 0, skipped: 0, mismatch: 0, unverified: 0, missing: 0 });
  assert.equal(fs.readFileSync(path.join(away.ctx.tempUploadDir, 'a.jpg'), 'utf8'), 'photo a');
  assert.equal((await away.ctx.app.inject({ method: 'GET', url: '/api/backups' })).json().missing_photos.count, 0);
  // Importing again, or a package of unrelated photos, changes nothing.
  assert.deepEqual((await away.ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'photos.tar', photos) })).json(),
    { imported: 0, present: 2, unused: 0, skipped: 0, mismatch: 0, unverified: 0, missing: 0 });
  fs.writeFileSync(path.join(away.ctx.tempUploadDir, 'a.jpg'), 'kept local version');
  await away.ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'photos.tar', photos) });
  assert.equal(fs.readFileSync(path.join(away.ctx.tempUploadDir, 'a.jpg'), 'utf8'), 'photo a', 'a correct package repairs a mismatched photo');
});

test('photo packages: only new photos on request, tickets expire with the session, bad packages are refused', async t => {
  const { ctx, child, addPhoto } = await fixture(t);
  addPhoto('old.jpg', 'old');
  const old = Date.now() - 86400000;
  fs.utimesSync(path.join(ctx.tempUploadDir, 'old.jpg'), old / 1000, old / 1000);
  await exportPackage(ctx);
  addPhoto('new.jpg', 'new');
  assert.deepEqual(tarNames(await exportPackage(ctx, 'new')), ['new.jpg']);
  // Photos of deleted mistakes are not exported.
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'stray.jpg'), 'stray');
  assert.deepEqual(tarNames(await exportPackage(ctx)).sort(), ['new.jpg', 'old.jpg']);

  const { url } = (await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: {} })).json();
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/backups/photos/export?ticket=forged' })).statusCode, 401);
  const sessionToken = ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() });
  assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/backups/photos/export?ticket=${sessionToken}` })).statusCode, 401, 'a session token is not a ticket');
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: { since: 'yesterday' } })).statusCode, 400);
  ctx.db.prepare("UPDATE settings SET value = 'rotated' WHERE key = 'auth_epoch'").run();
  assert.equal((await ctx.rawInject({ method: 'GET', url })).statusCode, 401, 'a restore or PIN change voids tickets');

  // Children cannot export or import.
  const childToken = ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() });
  assert.equal((await ctx.rawInject({ method: 'POST', url: '/api/backups/photos/export-ticket', headers: { authorization: `Bearer ${childToken}` }, payload: {} })).statusCode, 403);
  const parent = ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() });
  const importAs = (file, token = parent) => ctx.rawInject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'p.tar', file), headers: { ...multipart('file', 'p.tar', file).headers, authorization: `Bearer ${token}` } });
  assert.equal((await importAs(Buffer.from('not a tar file at all'.repeat(40)), childToken)).statusCode, 403);
  assert.equal((await importAs(Buffer.from('not a tar file at all'.repeat(40)))).statusCode, 400);
  const full = await exportPackage(ctx);
  assert.equal((await importAs(full.subarray(0, 700))).statusCode, 400, 'a truncated package is reported');
});

test('the tar reader skips directories, extended headers, resource forks and oversized files', async () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'taskie-tar-'));
  try {
    for (const [name, content] of [['ok.jpg', 'fine'], ['._ok.jpg', 'resource fork'], ['big.jpg', 'x'.repeat(2000)]]) fs.writeFileSync(path.join(dir, name), content);
    const chunks = [];
    for await (const chunk of tarStream(['ok.jpg', '._ok.jpg', 'big.jpg'].map(name => ({ name: `photos/${name}`, file: path.join(dir, name) })))) chunks.push(chunk);
    const seen = [];
    const reader = new TarReader((name, content) => seen.push([name, content.toString()]), { maxFileSize: 1000 });
    // Feed in uneven pieces, as a network stream would.
    const all = Buffer.concat(chunks);
    for (let i = 0; i < all.length; i += 37) reader.push(all.subarray(i, i + 37));
    reader.end();
    assert.deepEqual(seen, [['ok.jpg', 'fine'], ['._ok.jpg', 'resource fork']]);
    assert.equal(reader.skipped, 1);
    const tar = spawnSync('tar', ['-cf', '-', '-C', dir, '.'], { maxBuffer: 1e7 });
    if (tar.status === 0) {
      const names = [];
      const system = new TarReader(name => names.push(name), { maxFileSize: 1e6 });
      system.push(tar.stdout);
      system.end();
      assert.deepEqual(names.sort(), ['._ok.jpg', 'big.jpg', 'ok.jpg'], 'a package made with the system tar imports');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('stored photos stay while a retained backup needs them; v1 archives with embedded photos still restore', async t => {
  const { ctx, addPhoto } = await fixture(t);
  const service = ctx.app.backupService;
  addPhoto('kept.jpg', 'kept');
  const firstArchive = fs.readFileSync(service.getPath((await service.create()).name));
  // The mistake is deleted (and its file with it); older backups still hold the photo in the store.
  ctx.db.prepare('DELETE FROM mistake_records').run();
  fs.rmSync(path.join(ctx.tempUploadDir, 'kept.jpg'));
  await service.create();
  assert.ok(fs.existsSync(service.photos.path('kept.jpg')));
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(firstArchive) });
  assert.deepEqual(restored.json().missing_photos, []);
  assert.equal(fs.readFileSync(path.join(ctx.tempUploadDir, 'kept.jpg'), 'utf8'), 'kept');
  // Once no retained backup refers to it, it goes.
  ctx.db.prepare('DELETE FROM mistake_records').run();
  for (let i = 0; i < service.retention; i++) await service.create();
  assert.equal(fs.existsSync(service.photos.path('kept.jpg')), false);

  const v1 = { ...JSON.parse(gunzipSync(firstArchive)), version: 1, photo_manifest: undefined, photos: { 'kept.jpg': Buffer.from('from v1').toString('base64') } };
  const old = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(gzipSync(JSON.stringify(v1))) });
  assert.equal(old.statusCode, 200, old.body);
  assert.equal(fs.readFileSync(path.join(ctx.tempUploadDir, 'kept.jpg'), 'utf8'), 'from v1');
  // A store photo that no longer matches the manifest is not used.
  await service.create();
  fs.writeFileSync(service.photos.path('kept.jpg'), 'tampered');
  fs.rmSync(path.join(ctx.tempUploadDir, 'kept.jpg'));
  const v2 = fs.readFileSync(service.getPath(service.list()[0].name));
  assert.deepEqual((await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(v2) })).json().missing_photos, ['kept.jpg']);
});

async function packageOf(ctx, name, content) {
  const file = path.join(ctx.tempUploadDir, `.package-${name}`);
  fs.writeFileSync(file, content);
  try {
    const chunks = [];
    for await (const chunk of tarStream([{ name, file }])) chunks.push(chunk);
    return Buffer.concat(chunks);
  } finally { fs.rmSync(file, { force: true }); }
}

test('restored expectations persist across restarts and repeated backups; wrong bytes cannot fill or poison a photo', async t => {
  const home = await fixture(t), away = await fixture(t);
  home.addPhoto('verified.jpg', 'correct bytes');
  const original = fs.readFileSync(home.ctx.app.backupService.getPath((await home.ctx.app.backupService.create()).name));
  await away.ctx.app.backupService.restore(original);
  const BackupService = require('../src/services/backup.service');
  const service = new BackupService(away.ctx.db, away.ctx.tempUploadDir, away.ctx.app.backupService.backupDir);
  const wrong = await packageOf(home.ctx, 'verified.jpg', 'WRONG!! bytes');
  const good = await packageOf(home.ctx, 'verified.jpg', 'correct bytes');
  const { Readable } = require('node:stream');
  assert.equal((await service.importPhotos(Readable.from([wrong]))).mismatch, 1);
  assert.equal((await service.missingPhotos())[0].reason, 'absent');
  fs.writeFileSync(path.join(away.ctx.tempUploadDir, 'verified.jpg'), 'WRONG!! bytes');
  assert.equal((await service.missingPhotos())[0].reason, 'mismatch');
  const again = fs.readFileSync(service.getPath((await service.create()).name));
  assert.equal(JSON.parse(gunzipSync(again)).photo_manifest[0].sha256, JSON.parse(gunzipSync(original)).photo_manifest[0].sha256);
  await service.restore(again);
  assert.equal((await service.importPhotos(Readable.from([good]))).imported, 1);
  assert.equal((await service.missingPhotos()).length, 0);
  assert.equal(fs.readFileSync(path.join(away.ctx.tempUploadDir, 'verified.jpg'), 'utf8'), 'correct bytes');
  // A correct upload also repairs a same-size damaged store copy.
  fs.writeFileSync(service.photos.path('verified.jpg'), 'WRONG!! bytes');
  assert.equal((await service.importPhotos(Readable.from([good]))).present, 1);
  assert.equal(fs.readFileSync(service.photos.path('verified.jpg'), 'utf8'), 'correct bytes');
  fs.writeFileSync(service.photos.path('verified.jpg'), 'WRONG!! bytes');
  fs.writeFileSync(path.join(away.ctx.tempUploadDir, 'verified.jpg'), 'WRONG!! bytes');
  assert.equal((await service.importPhotos(Readable.from([good]))).imported, 1);
  assert.equal(fs.readFileSync(service.photos.path('verified.jpg'), 'utf8'), 'correct bytes');
});

test('v2 refuses mixed formats, duplicate manifest names and overlap; v1 missing digests are never guessed', async t => {
  const { ctx, addPhoto } = await fixture(t), away = await fixture(t);
  const service = ctx.app.backupService;
  addPhoto('one.jpg', 'one');
  const data = JSON.parse(gunzipSync(fs.readFileSync(service.getPath((await service.create()).name))));
  for (const invalid of [
    { ...data, photos: {} }, { ...data, photos: null },
    { ...data, photo_manifest: [...data.photo_manifest, ...data.photo_manifest] },
    { ...data, missing_photos: ['one.jpg'] },
    { ...data, missing_photos: ['other.jpg', 'other.jpg'] }
  ]) await assert.rejects(() => away.ctx.app.backupService.restore(gzipSync(JSON.stringify(invalid))), { statusCode: 400 });
  const legacy = { ...data, version: 1, photos: {}, missing_photos: ['one.jpg'] };
  delete legacy.photo_manifest;
  await away.ctx.app.backupService.restore(gzipSync(JSON.stringify(legacy)));
  const photo = await packageOf(ctx, 'one.jpg', 'one');
  const imported = await away.ctx.app.backupService.importPhotos(require('node:stream').Readable.from([photo]));
  assert.deepEqual([imported.unverified, imported.imported, imported.missing], [1, 0, 1]);
});

test('tar requires both zero blocks, complete trailing blocks and strict numeric fields', async t => {
  const { ctx } = await fixture(t);
  const full = await packageOf(ctx, 'one.jpg', 'one');
  const check = buffer => { const reader = new TarReader(() => {}, { maxFileSize: 1000 }); reader.push(buffer); reader.end(); };
  for (const size of [0, 9, 512, 700, 1024, 1500, 1536, 2047]) assert.throws(() => check(full.subarray(0, size)), { statusCode: 400 }, `truncation at ${size}`);
  assert.throws(() => check(Buffer.from('not a tar')), { statusCode: 400 });
  assert.throws(() => check(Buffer.concat([full, Buffer.from('x')])), { statusCode: 400 });
  for (const value of ['0000000001x\0', '-000000001\0 ', '77777777777\0']) {
    const broken = Buffer.from(full);
    broken.write(value, 124, 12, 'ascii');
    broken.fill(32, 148, 156);
    const checksum = broken.subarray(0, 512).reduce((sum, n) => sum + n, 0);
    broken.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    // The enormous but syntactically valid size must fail at EOF too.
    assert.throws(() => check(broken), { statusCode: 400 });
  }
  check(full);
  check(Buffer.concat([full, Buffer.alloc(512)]));
  const response = await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'bad.tar', full.subarray(0, 1500)) });
  assert.equal(response.statusCode, 400);
});

test('server export history includes retained-only photos and ignores mtime, client time and failed tickets', async t => {
  const { ctx, addPhoto } = await fixture(t), service = ctx.app.backupService;
  addPhoto('history.jpg', 'history'); await service.create();
  ctx.db.prepare('DELETE FROM mistake_records').run();
  fs.rmSync(path.join(ctx.tempUploadDir, 'history.jpg'));
  addPhoto('current.jpg', 'current'); await service.create();
  const status = async () => (await ctx.app.inject({ url: '/api/backups' })).json().photo_export;
  assert.deepEqual(await status(), { last_complete_at: null, exported_count: 0, pending_count: 2 });
  const ticket = (await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: { scope: 'new' } })).json();
  assert.equal((await status()).exported_count, 0, 'issuing a ticket is not completion');
  for (const payload of [{ since: new Date(Date.now() + 86400000).toISOString() }, { scope: 'invalid' }]) {
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload })).statusCode, 400);
  }
  const downloaded = await ctx.rawInject({ url: ticket.url });
  assert.deepEqual(tarNames(downloaded.rawPayload), ['current.jpg', 'history.jpg']);
  assert.deepEqual([(await status()).exported_count, (await status()).pending_count], [2, 0]);
  assert.ok((await status()).last_complete_at);
  assert.deepEqual(tarNames(await exportPackage(ctx, 'new')), []);
  addPhoto('later.jpg', 'later');
  fs.utimesSync(path.join(ctx.tempUploadDir, 'later.jpg'), 0, 0);
  assert.deepEqual(tarNames(await exportPackage(ctx, 'new')), ['later.jpg']);
  const old = fs.readFileSync(service.getPath(service.list().at(-1).name));
  await service.restore(old);
  assert.equal((await status()).pending_count, 0, 'restoring data does not rewind shared export history');
  const expired = ctx.app.jwt.sign({ purpose: 'photo-export', scope: 'all', epoch: ctx.app.sessionEpoch() }, { expiresIn: '1s', clockTimestamp: 1000 });
  const before = service.exportState();
  assert.equal((await ctx.rawInject({ url: `/api/backups/photos/export?ticket=${expired}` })).statusCode, 401);
  assert.deepEqual(service.exportState(), before);
});

test('a stream error, session invalidation or client disconnect never records a complete export', async t => {
  const { ctx, addPhoto } = await fixture(t), service = ctx.app.backupService;
  addPhoto('large.jpg', require('node:crypto').randomBytes(8 * 1024 * 1024));
  const original = service.exportPhotos.bind(service);
  const { Readable } = require('node:stream');
  const ticket = async () => (await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: { scope: 'all' } })).json().url;
  service.exportPhotos = () => {
    const stream = Readable.from((async function* () { throw new Error('injected stream failure'); })());
    stream.photoNames = ['large.jpg']; return stream;
  };
  assert.equal((await ctx.rawInject({ url: await ticket() })).statusCode, 500);
  assert.equal(service.exportState().last_complete_at, null);
  service.exportPhotos = () => {
    const source = original();
    const stream = Readable.from((async function* () {
      for await (const chunk of source) { yield chunk; ctx.db.prepare("UPDATE settings SET value = 'invalidated' WHERE key = 'auth_epoch'").run(); }
    })());
    stream.photoNames = source.photoNames; return stream;
  };
  assert.equal((await ctx.rawInject({ url: await ticket() })).statusCode, 200);
  assert.equal(service.exportState().last_complete_at, null);
  service.exportPhotos = () => {
    const source = original();
    const stream = Readable.from((async function* () {
      for await (const chunk of source) yield chunk;
      const now = Date.now();
      t.mock.method(Date, 'now', () => now + 10 * 60 * 1000);
    })());
    stream.photoNames = source.photoNames; return stream;
  };
  assert.equal((await ctx.rawInject({ url: await ticket() })).statusCode, 200);
  assert.equal(service.exportState().last_complete_at, null, 'expiry before response finish is not completion');
  t.mock.restoreAll();
  service.exportPhotos = original;
  const url = await ticket();
  const base = await ctx.app.listen({ host: '127.0.0.1', port: 4178 });
  await new Promise((resolve, reject) => {
    const req = require('node:http').get(base + url, res => {
      res.once('data', () => { res.destroy(); });
      res.once('close', resolve);
    });
    req.once('error', reject);
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.exportState().last_complete_at, null);
  const response = await fetch(base + await ticket());
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.deepEqual(service.exportState().names, ['large.jpg'], 'a real completed response records the photo');
});

test('retained v1 scans skip large embedded payloads, cache manifests and keep referenced store photos', async t => {
  const { ctx, addPhoto } = await fixture(t), service = ctx.app.backupService;
  addPhoto('legacy.jpg', 'keep');
  const item = (await service.create()), file = service.getPath(item.name);
  const archive = JSON.parse(gunzipSync(fs.readFileSync(file)));
  delete archive.photo_manifest;
  archive.version = 1; archive.photos = { 'legacy.jpg': 'A'.repeat(32 * 1024 * 1024) };
  fs.writeFileSync(file, gzipSync(JSON.stringify(archive)));
  fs.rmSync(`${file}.manifest.json`, { force: true });
  ctx.db.prepare('DELETE FROM mistake_records').run();
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function(target, ...args) {
    assert.notEqual(target, file, 'never read the whole compressed archive');
    return read.call(this, target, ...args);
  });
  await service.prunePhotos();
  assert.ok(fs.existsSync(service.photos.path('legacy.jpg')));
  assert.deepEqual((await service.retainedManifest(item.name)).photos, ['legacy.jpg']);
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', function(target, ...args) {
    assert.notEqual(target, file, 'second prune uses the cached manifest');
    return open.call(this, target, ...args);
  });
  await service.prunePhotos();
  assert.ok(fs.existsSync(service.photos.path('legacy.jpg')));
});

test('v29 upgrades to v30, legacy manifests gain expectations, and incomplete v30 backups are refused', async t => {
  const { ctx, addPhoto } = await fixture(t), service = ctx.app.backupService;
  addPhoto('upgrade.jpg', 'upgrade');
  const data = JSON.parse(gunzipSync(fs.readFileSync(service.getPath((await service.create()).name))));
  const Database = require('better-sqlite3'), { initDb, SCHEMA_VERSION } = require('../src/db');
  const db = new Database(Buffer.from(data.database, 'base64'));
  try {
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()) db.exec(`DROP TRIGGER "${name}"`);
    db.exec('DROP TABLE photo_expectations; DROP TABLE outside_class_revisions; ALTER TABLE period_task_logs DROP COLUMN request_fingerprint');
    db.pragma('user_version = 29');
    const old = { ...data, database: db.serialize().toString('base64') };
    initDb(db);
    assert.equal(SCHEMA_VERSION, 30);
    assert.equal(db.pragma('user_version', { simple: true }), 30);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger'").get().n, 6);
    await service.restore(gzipSync(JSON.stringify(old)));
    assert.equal(service.expectations().get('upgrade.jpg').sha256, data.photo_manifest[0].sha256);
    const current = JSON.parse(gunzipSync(fs.readFileSync(service.getPath((await service.create()).name))));
    for (const table of ['photo_expectations', 'outside_class_revisions']) {
      const broken = new Database(Buffer.from(current.database, 'base64'));
      broken.exec(`DROP TABLE ${table}`);
      const invalid = { ...current, database: broken.serialize().toString('base64') };
      broken.close();
      await assert.rejects(() => service.restore(gzipSync(JSON.stringify(invalid))), { statusCode: 400 });
    }
    db.pragma('user_version = 31');
    assert.throws(() => initDb(db), /v31/);
    await assert.rejects(() => service.restore(gzipSync(JSON.stringify({ ...data, database: db.serialize().toString('base64') }))), { statusCode: 400 });
  } finally { db.close(); }
});

test('photo uploads and tar imports share the 10 MiB per-photo ceiling', async t => {
  const { ctx } = await fixture(t);
  const { MAX_PHOTO_SIZE } = require('../src/utils/photo-limits');
  assert.equal(MAX_PHOTO_SIZE, 10 * 1024 * 1024);
  const content = Buffer.alloc(MAX_PHOTO_SIZE + 1, 65);
  const uploaded = await ctx.app.inject({ method: 'POST', url: '/api/mistakes', ...multipart('file', 'large.jpg', content) });
  assert.equal(uploaded.statusCode, 413);
  const photo = await packageOf(ctx, 'large.jpg', content);
  const imported = await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'large.tar', photo) });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json().skipped, 1);
  assert.equal(imported.json().imported, 0);
});
