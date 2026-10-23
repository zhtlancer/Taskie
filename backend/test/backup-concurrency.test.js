const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');

for (const kind of ['mistake', 'child']) test(`backup keeps its snapshot photo when a ${kind} deletion arrives during copying`, async t => {
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); ctx.db.close(); });
  let entered;
  const deletionEntered = new Promise(resolve => { entered = resolve; });
  ctx.app.addHook('preHandler', async request => { if (request.method === 'DELETE') entered(); });
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: 'snapshot' });
  const photo = path.join(ctx.tempUploadDir, 'snapshot.jpg');
  fs.writeFileSync(photo, 'snapshot photo');
  const mistake = ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: '阶段 B 验收', photo_path: '/uploads/snapshot.jpg' });
  const service = ctx.app.backupService, add = service.photos.add.bind(service.photos);
  let reached, release;
  const copying = new Promise(resolve => { reached = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  t.mock.method(service.photos, 'add', async (...args) => { reached(); await hold; return add(...args); });
  const creating = service.create();
  await copying;
  const deleting = ctx.app.inject({ method: 'DELETE', url: kind === 'mistake' ? `/api/mistakes/${mistake.id}` : `/api/children/${child.id}` });
  try {
    await deletionEntered;
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(ctx.app.services.mistakesService.getMistake(mistake.id), 'deletion must wait for the backup');
    assert.ok(fs.existsSync(photo));
    assert.equal((await ctx.app.inject({ url: '/api/health' })).statusCode, 200);
  } finally { release(); }
  const backup = await creating;
  assert.equal((await deleting).statusCode, 200);
  const bytes = fs.readFileSync(service.getPath(backup.name));
  const data = JSON.parse(gunzipSync(bytes));
  assert.deepEqual(data.missing_photos, []);
  assert.deepEqual(data.photo_manifest.map(p => p.name), ['snapshot.jpg']);
  const result = await service.restore(bytes);
  assert.deepEqual(result.missing_photos, []);
  assert.equal(fs.readFileSync(photo, 'utf8'), 'snapshot photo');
  assert.ok(ctx.app.services.mistakesService.getMistake(mistake.id));
});

test('a queued photo deletion cannot use an invalidated session after restore or PIN change', async t => {
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); ctx.db.close(); });
  let entered;
  const deletionEntered = new Promise(resolve => { entered = resolve; });
  ctx.app.addHook('preHandler', async request => { if (request.method === 'DELETE') entered(); });
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: 'queued' });
  const mistake = ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: '阶段 B 验收' });
  let release;
  const blocked = ctx.app.backupService.exclusive(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const deleting = ctx.app.inject({ method: 'DELETE', url: `/api/mistakes/${mistake.id}` });
  try {
    await deletionEntered;
    ctx.db.prepare("UPDATE settings SET value = 'new-session' WHERE key = 'auth_epoch'").run();
  } finally { release(); }
  await blocked;
  assert.equal((await deleting).statusCode, 401);
  assert.ok(ctx.app.services.mistakesService.getMistake(mistake.id));
});
