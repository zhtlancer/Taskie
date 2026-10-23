const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { DELETE_WAIT_MS } = require('../src/utils/queued-deletion');

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

for (const kind of ['mistake', 'child']) test(`a ${kind} deletion returns 503 after its queue deadline and never executes later`, async t => {
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); ctx.db.close(); });
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: 'timeout' });
  const photo = path.join(ctx.tempUploadDir, 'timeout.jpg');
  fs.writeFileSync(photo, 'keep');
  const mistake = ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: 'queued', photo_path: '/uploads/timeout.jpg' });
  const service = ctx.app.backupService;
  let release, reached;
  const held = new Promise(resolve => { release = resolve; });
  const blocked = service.exclusive(() => held);
  const queued = new Promise(resolve => { reached = resolve; });
  const exclusive = service.exclusive.bind(service);
  t.mock.method(service, 'exclusive', operation => { const result = exclusive(operation); reached(); return result; });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const deleting = ctx.app.inject({ method: 'DELETE', url: kind === 'mistake' ? `/api/mistakes/${mistake.id}` : `/api/children/${child.id}` });
    await queued;
    t.mock.timers.tick(DELETE_WAIT_MS);
    const response = await deleting;
    assert.equal(response.statusCode, 503, response.body);
    assert.match(response.json().error, /本次删除未执行/);
  } finally { t.mock.timers.reset(); release(); }
  await blocked;
  await service.operation;
  assert.ok(ctx.app.services.childrenService.getChild(child.id));
  assert.ok(ctx.app.services.mistakesService.getMistake(mistake.id));
  assert.equal(fs.readFileSync(photo, 'utf8'), 'keep');
  const retried = await ctx.app.inject({ method: 'DELETE', url: kind === 'mistake' ? `/api/mistakes/${mistake.id}` : `/api/children/${child.id}` });
  assert.equal(retried.statusCode, 200, 'a new request can delete once the queue is free');
});

for (const kind of ['mistake', 'child']) test(`disconnecting a queued ${kind} deletion cancels it before its deadline`, async t => {
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); ctx.db.close(); });
  let arrived, closed, release;
  const requestArrived = new Promise(resolve => { arrived = resolve; });
  const connectionClosed = new Promise(resolve => { closed = resolve; });
  ctx.app.addHook('preHandler', async (request, reply) => {
    if (request.method === 'DELETE') { reply.raw.once('close', closed); arrived(); }
  });
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: 'disconnected' });
  const mistake = ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: 'keep' });
  const held = new Promise(resolve => { release = resolve; });
  const blocked = ctx.app.backupService.exclusive(() => held);
  const base = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  const token = ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() });
  const controller = new AbortController();
  const url = kind === 'mistake' ? `/api/mistakes/${mistake.id}` : `/api/children/${child.id}`;
  const deleting = fetch(base + url, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  const rejected = assert.rejects(deleting, { name: 'AbortError' });
  try {
    await requestArrived;
    controller.abort();
    await rejected;
    await connectionClosed;
  } finally { controller.abort(); release(); }
  await blocked;
  await ctx.app.backupService.operation;
  assert.ok(ctx.app.services.childrenService.getChild(child.id));
  assert.ok(ctx.app.services.mistakesService.getMistake(mistake.id));
});
