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
async function exportPackage(ctx, since) {
  const ticket = await ctx.app.inject({ method: 'POST', url: '/api/backups/photos/export-ticket', payload: since ? { since } : {} });
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
  const archive = fs.readFileSync(home.ctx.app.backupService.getPath(home.ctx.app.backupService.create().name));
  const photos = await exportPackage(home.ctx);
  assert.deepEqual(tarNames(photos).sort(), ['a.jpg', 'b.webp']);
  // Standard tar reads the package too.
  const listed = spawnSync('tar', ['-tf', '-'], { input: photos, encoding: 'utf8' });
  if (listed.status === 0) assert.deepEqual(listed.stdout.trim().split('\n').sort(), ['a.jpg', 'b.webp']);

  const away = await fixture(t);
  const restored = await away.ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(archive) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(restored.json().missing_photos.sort(), ['a.jpg', 'b.webp']);
  assert.deepEqual((await away.ctx.app.inject({ method: 'GET', url: '/api/backups' })).json().missing_photos, { count: 2, sample: ['a.jpg', 'b.webp'] });

  const imported = await away.ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'photos.tar', photos) });
  assert.equal(imported.statusCode, 200, imported.body);
  assert.deepEqual(imported.json(), { imported: 2, present: 0, unused: 0, skipped: 0, missing: 0 });
  assert.equal(fs.readFileSync(path.join(away.ctx.tempUploadDir, 'a.jpg'), 'utf8'), 'photo a');
  assert.equal((await away.ctx.app.inject({ method: 'GET', url: '/api/backups' })).json().missing_photos.count, 0);
  // Importing again, or a package of unrelated photos, changes nothing.
  assert.deepEqual((await away.ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'photos.tar', photos) })).json(),
    { imported: 0, present: 2, unused: 0, skipped: 0, missing: 0 });
  fs.writeFileSync(path.join(away.ctx.tempUploadDir, 'a.jpg'), 'kept local version');
  await away.ctx.app.inject({ method: 'POST', url: '/api/backups/photos/import', ...multipart('file', 'photos.tar', photos) });
  assert.equal(fs.readFileSync(path.join(away.ctx.tempUploadDir, 'a.jpg'), 'utf8'), 'kept local version', 'existing photos are never replaced');
});

test('photo packages: only new photos on request, tickets expire with the session, bad packages are refused', async t => {
  const { ctx, child, addPhoto } = await fixture(t);
  addPhoto('old.jpg', 'old');
  const old = Date.now() - 86400000;
  fs.utimesSync(path.join(ctx.tempUploadDir, 'old.jpg'), old / 1000, old / 1000);
  addPhoto('new.jpg', 'new');
  assert.deepEqual(tarNames(await exportPackage(ctx, new Date(Date.now() - 3600000).toISOString())), ['new.jpg']);
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
  const firstArchive = fs.readFileSync(service.getPath(service.create().name));
  // The mistake is deleted (and its file with it); older backups still hold the photo in the store.
  ctx.db.prepare('DELETE FROM mistake_records').run();
  fs.rmSync(path.join(ctx.tempUploadDir, 'kept.jpg'));
  service.create();
  assert.ok(fs.existsSync(service.photos.path('kept.jpg')));
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(firstArchive) });
  assert.deepEqual(restored.json().missing_photos, []);
  assert.equal(fs.readFileSync(path.join(ctx.tempUploadDir, 'kept.jpg'), 'utf8'), 'kept');
  // Once no retained backup refers to it, it goes.
  ctx.db.prepare('DELETE FROM mistake_records').run();
  for (let i = 0; i < service.retention; i++) service.create();
  assert.equal(fs.existsSync(service.photos.path('kept.jpg')), false);

  const v1 = { ...JSON.parse(gunzipSync(firstArchive)), version: 1, photo_manifest: undefined, photos: { 'kept.jpg': Buffer.from('from v1').toString('base64') } };
  const old = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(gzipSync(JSON.stringify(v1))) });
  assert.equal(old.statusCode, 200, old.body);
  assert.equal(fs.readFileSync(path.join(ctx.tempUploadDir, 'kept.jpg'), 'utf8'), 'from v1');
  // A store photo that no longer matches the manifest is not used.
  service.create();
  fs.writeFileSync(service.photos.path('kept.jpg'), 'tampered');
  fs.rmSync(path.join(ctx.tempUploadDir, 'kept.jpg'));
  const v2 = fs.readFileSync(service.getPath(service.list()[0].name));
  assert.deepEqual((await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...restoreBody(v2) })).json().missing_photos, ['kept.jpg']);
});
