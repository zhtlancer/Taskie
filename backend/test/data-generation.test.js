const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate } = require('../src/utils/date');

const header = 'x-taskie-data-generation';
const restored = { code: 'DATA_RESTORED', error: '数据已恢复，这次操作没有执行，请核对后重新操作' };

async function fixture(t) {
  const c = createTestApp();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  await c.app.ready();
  const s = c.app.services;
  const child = s.childrenService.createChild({ name: '代次回归' });
  const task = s.tasksService.createAdhocTask(child.id, { title: '阅读', subject: '语文', track_time: true, points: 100 });
  s.tasksService.completeDailyTask(task.id);
  s.tasksService.uncompleteDailyTask(task.id);
  // Earn a balance for redemption without changing the timed task under test.
  const earned = s.tasksService.createAdhocTask(child.id, { title: '积分', subject: '数学', points: 100 });
  s.tasksService.completeDailyTask(earned.id);
  const homework = s.homeworkService.create(child.id, { subject: '数学', content: '练习', due_date: getTodayDate(), create_task: true }, 'parent');
  const goal = s.periodsService.createGoal(child.id, { title: '长期阅读', subject: '语文', mode: 'progress', unit: '页', total_amount: 10, points: 5 });
  const reward = s.redemptionsService.createItem({ title: '贴纸', cost: 10 });
  for (const char of ['山', '水', '风', '云']) s.charactersService.createCharacter({ child_id: child.id, char, categories: ['recognize'] });
  s.wordStudyService.savePlan(child.id, 'recognize', { new_target: 1, review_target: 0, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const day = s.wordStudyService.today(child.id).days[0];
  const item = day.batches[0].items[0];
  s.wordStudyService.grade(item.id, { result: 'good', request_id: 'fixture_base_grade' }, 'parent');
  const writes = [
    { url: `/api/daily-tasks/${task.id}/sessions`, payload: { duration_seconds: 60 }, status: 200 },
    { url: `/api/homework/${homework.id}/sessions`, payload: { duration_seconds: 60 }, status: 200 },
    { url: `/api/period-tasks/${goal.id}/logs`, payload: { amount: 1 }, status: 201 },
    { url: `/api/children/${child.id}/redemptions`, payload: { reward_id: reward.id }, status: 201 },
    { url: `/api/word-study/days/${day.id}/extra`, payload: {}, status: 200 },
    { url: `/api/word-study/items/${item.id}/attempts`, payload: { result: 'again' }, status: 200 }
  ];
  const snapshot = () => Object.fromEntries(c.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    .map(({ name }) => [name, c.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  const backup = c.app.backupService;
  const bytes = fs.readFileSync(backup.getPath((await backup.create()).name));
  const restore = () => backup.restore(bytes);
  const send = (write, generation, id = 'generation_request_1', extraHeaders = {}) => c.app.inject({
    method: 'POST', url: write.url, payload: { ...write.payload, request_id: id },
    headers: { ...(generation === undefined ? {} : { [header]: generation }), ...extraHeaders }
  });
  return { ...c, child, writes, snapshot, restore, send };
}

test('login and authenticated calibration expose initial and a fresh generation on every restore', async t => {
  const c = await fixture(t);
  const read = async expected => {
    for (const [url, payload] of [['parent-login', { pin: '1234' }], ['child-login', { child_id: c.child.id }]]) {
      const login = await c.rawInject({ method: 'POST', url: `/api/auth/${url}`, payload });
      assert.equal(login.statusCode, 200, login.body);
      assert.equal(login.json().data_generation, expected);
      const calibrated = await c.rawInject({ url: '/api/auth/data-generation', headers: { authorization: `Bearer ${login.json().token}` } });
      assert.equal(calibrated.statusCode, 200, calibrated.body);
      assert.deepEqual(calibrated.json(), { data_generation: expected });
    }
  };
  await read('initial');
  assert.equal(c.db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get(), undefined);
  assert.equal((await c.rawInject({ url: '/api/auth/data-generation' })).statusCode, 401);
  await c.restore();
  const first = c.db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get().value;
  assert.notEqual(first, 'initial'); await read(first);
  await c.restore();
  const second = c.db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get().value;
  assert.notEqual(second, first); await read(second);
});

test('a valid session can calibrate before changing the default parent PIN', async t => {
  const c = createTestApp({ defaultParentPin: true });
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const response = await c.app.inject({ url: '/api/auth/data-generation' });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { data_generation: 'initial' });
});

for (let i = 0; i < 6; i++) {
  test(`write ${i + 1}: stale generation has no effects, same ID then succeeds and deduplicates`, async t => {
    const c = await fixture(t), write = c.writes[i];
    await c.restore();
    const before = c.snapshot();
    const denied = await c.send(write, 'initial');
    assert.equal(denied.statusCode, 409, `${write.url}: ${denied.body}`);
    assert.deepEqual(denied.json(), restored);
    assert.deepEqual(c.snapshot(), before, 'all rows, points and idempotency records remain unchanged');
    const login = await c.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: c.child.id } });
    const childResponse = await c.send(write, 'initial', 'child_generation', { authorization: `Bearer ${login.json().token}` });
    assert.equal(childResponse.statusCode, 409, childResponse.body);
    assert.deepEqual(childResponse.json(), restored);
    assert.deepEqual(c.snapshot(), before);
    // Generation rejection also precedes business validation and any idempotency lookup.
    assert.equal((await c.send({ ...write, payload: {} }, 'initial', 'bad')).statusCode, 409);
    const current = c.db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get().value;
    const accepted = await c.send(write, current);
    assert.equal(accepted.statusCode, write.status, accepted.body);
    const after = c.snapshot();
    assert.notDeepEqual(after, before, 'the valid request really executes');
    assert.equal((await c.send(write, current)).statusCode, write.status);
    assert.deepEqual(c.snapshot(), after, 'replay does not duplicate records or points');
    assert.deepEqual((await c.send(write, 'initial')).json(), restored, 'stale replay is rejected before deduplication');
    assert.deepEqual(c.snapshot(), after);
  });
  test(`write ${i + 1}: missing header remains compatible`, async t => {
    const c = await fixture(t);
    await c.restore();
    const response = await c.send(c.writes[i]);
    assert.equal(response.statusCode, c.writes[i].status, response.body);
  });
}

test('a queued write checks the generation after restore completes; session checks still take priority', async t => {
  const c = await fixture(t), backup = c.app.backupService;
  // Pause restore after its DB commit but before it releases the exclusive queue. A re-login
  // here has a valid new session, but an old pending operation still carries initial.
  const original = backup.restoreSnapshot.bind(backup);
  let entered, release;
  const committed = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  t.mock.method(backup, 'restoreSnapshot', async (...args) => {
    const result = await original(...args); entered(); await hold; return result;
  });
  const oldToken = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const restoring = c.restore(); await committed;
  const login = await c.rawInject({ method: 'POST', url: '/api/auth/parent-login', payload: { pin: '1234' } });
  const before = c.snapshot();
  const pending = Promise.all(c.writes.map((write, i) => c.send(write, 'initial', `queued_generation_${i}`, { authorization: `Bearer ${login.json().token}` })));
  let finished = false; pending.finally(() => { finished = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false, 'write waits behind the active restore');
  } finally { release(); await restoring; }
  for (const response of await pending) {
    assert.equal(response.statusCode, 409, response.body);
    assert.deepEqual(response.json(), restored);
  }
  assert.deepEqual(c.snapshot(), before);
  for (const write of c.writes) {
    assert.equal((await c.send(write, 'initial', 'expired_generation', { authorization: `Bearer ${oldToken}` })).statusCode, 401);
  }
  assert.deepEqual(c.snapshot(), before);
});

test('a session invalidated while a write waits cannot execute even with a matching generation', async t => {
  const c = await fixture(t), backup = c.app.backupService;
  let entered, release;
  const queued = new Promise(resolve => { entered = resolve; });
  const held = backup.exclusive(() => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  // Hooks are already installed: observe queue admission instead.
  const exclusive = backup.exclusive.bind(backup);
  t.mock.method(backup, 'exclusive', fn => { const result = exclusive(fn); entered(); return result; });
  const pending = c.send(c.writes[2], 'initial');
  // Also resolves on the old implementation so the baseline fails without hanging.
  pending.then(entered);
  await queued;
  c.db.prepare("UPDATE settings SET value = 'changed-pin' WHERE key = 'auth_epoch'").run();
  const before = c.snapshot();
  release(); await held;
  assert.equal((await pending).statusCode, 401);
  assert.deepEqual(c.snapshot(), before);
});
