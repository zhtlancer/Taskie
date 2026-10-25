const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

async function fixture(t, kind, overdue = false) {
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); ctx.db.close(); });
  await ctx.app.ready();
  const services = ctx.app.services;
  const child = services.childrenService.createChild({ name: '补填用时' });
  const date = overdue ? shiftDate(getTodayDate(), -1) : getTodayDate();
  const record = kind === 'homework' ? services.homeworkService.create(child.id, {
    subject: '数学', content: '完成时补填用时', assigned_date: getTodayDate(), due_date: getTodayDate(),
    create_task: true, track_time: true, expected_minutes: 20, points: 10
  }, 'parent') : null;
  const task = record?.task || services.tasksService.createAdhocTask(child.id, {
    title: '完成时补填用时', subject: '数学', date, track_time: true, expected_minutes: 20, points: 10
  });
  if (record && overdue) {
    ctx.db.prepare('UPDATE homework_records SET assigned_date = ?, due_date = ? WHERE id = ?').run(date, date, record.id);
    ctx.db.prepare('UPDATE daily_tasks SET date = ?, due_date = ? WHERE id = ?').run(date, date, task.id);
  }
  const token = ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() });
  const root = record ? `/api/homework/${record.id}` : `/api/daily-tasks/${task.id}`;
  const call = (suffix, payload) => ctx.rawInject({ method: 'POST', url: root + suffix, payload, headers: { authorization: `Bearer ${token}` } });
  const complete = body => call(record ? '/complete' : '/study/complete', body);
  const details = () => (record ? services.homeworkStudyService : services.taskStudyService).details(record?.id || task.id);
  return { ...ctx, ...services, child, task, call, complete, details };
}

for (const kind of ['task', 'homework']) {
  for (const seconds of [null, 125]) test(`${kind}: completion without adding time stays idempotent after undo (${seconds})`, async t => {
    const c = await fixture(t, kind);
    await c.call('/sessions', { request_id: `unchanged-original-${kind}`, duration_seconds: 125 });
    const body = { request_id: `unchanged-complete-${kind}`, duration_seconds: seconds, expected_total_seconds: 125, note: '保持用时' };
    assert.equal((await c.complete(body)).statusCode, 200);
    await c.app.inject({ method: 'POST', url: `/api/daily-tasks/${c.task.id}/uncomplete` });
    assert.equal((await c.complete(body)).statusCode, 200);
    assert.equal(c.details().record.task.is_completed, false);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
    assert.equal(c.details().sessions.length, 1);
    assert.equal(c.details().total_seconds, 125);
    assert.equal(c.db.prepare('SELECT COUNT(*) n FROM study_completion_requests WHERE task_id = ?').get(c.task.id).n, 1);
    assert.equal((await c.complete({ ...body, note: '更改了原请求' })).statusCode, 409);
    assert.equal((await c.complete({ ...body, request_id: `new-completion-${kind}` })).statusCode, 200);
    assert.equal(c.details().record.task.is_completed, true, 'a new deliberate completion is still allowed');
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  });

  for (const seconds of [null, 1200]) test(`${kind}: an empty paused session can be completed with optional manual time (${seconds})`, async t => {
    const c = await fixture(t, kind);
    await c.call('/study/start');
    const active = c.details().active;
    c.db.prepare('UPDATE homework_sessions SET timer_started_at = NULL WHERE id = ?').run(active.id);
    const response = await c.complete({ request_id: `empty-paused-${kind}`, duration_seconds: seconds, expected_total_seconds: 0 });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(c.details().active, null);
    assert.equal(c.details().total_seconds, seconds || 0);
    assert.deepEqual(c.details().sessions.map(s => s.duration_source), seconds ? ['manual'] : [], 'the empty session is discarded, not kept as a 0-second record');
    assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM homework_sessions WHERE id = ?').get(active.id).n, 0);
    assert.equal(c.details().record.task.is_completed, true);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  });

  test(`${kind}: increasing total time appends only the difference and is safe to replay after undo`, async t => {
    const c = await fixture(t, kind);
    await c.call('/sessions', { request_id: `original-${kind}`, duration_seconds: 125, note: '原来的学习' });
    const original = c.details().sessions[0];
    const body = { request_id: `additional-${kind}`, duration_seconds: 1800, expected_total_seconds: 125, note: '补充用时' };
    const response = await c.complete(body);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(c.details().total_seconds, 1800);
    assert.deepEqual(c.details().sessions.find(s => s.id === original.id), original);
    assert.equal(c.details().sessions.find(s => s.id === body.request_id).duration_seconds, 1675);
    assert.equal((await c.complete(body)).statusCode, 200);
    assert.equal(c.details().sessions.length, 2);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
    await c.app.inject({ method: 'POST', url: `/api/daily-tasks/${c.task.id}/uncomplete` });
    assert.equal((await c.complete(body)).statusCode, 200);
    assert.equal(c.details().record.task.is_completed, false);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  });

  test(`${kind}: totals cannot decrease or use a stale baseline; unchanged totals add no session`, async t => {
    const c = await fixture(t, kind);
    await c.call('/sessions', { request_id: `baseline-${kind}`, duration_seconds: 125 });
    const body = { request_id: `change-total-${kind}`, duration_seconds: 120, expected_total_seconds: 125 };
    assert.equal((await c.complete(body)).statusCode, 409);
    assert.equal((await c.complete({ ...body, duration_seconds: 1800, expected_total_seconds: 0 })).statusCode, 409);
    assert.equal((await c.complete({ ...body, duration_seconds: null, expected_total_seconds: 0 })).statusCode, 409);
    assert.equal(c.details().record.task.is_completed, false);
    assert.equal(c.details().sessions.length, 1);
    assert.equal(c.details().total_seconds, 125);
    const response = await c.complete({ ...body, duration_seconds: 125 });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(c.details().record.task.is_completed, true);
    assert.equal((await c.complete({ ...body, duration_seconds: 125 })).statusCode, 200, 'a lost response for an unchanged total can be replayed');
    assert.equal(c.details().sessions.length, 1);
    assert.equal(c.details().total_seconds, 125);
  });

  test(`${kind}: total time can exceed 12 hours while each addition remains bounded`, async t => {
    const c = await fixture(t, kind);
    await c.call('/sessions', { request_id: `large-first-${kind}`, duration_seconds: 43200 });
    await c.call('/sessions', { request_id: `large-second-${kind}`, duration_seconds: 600 });
    const body = { request_id: `large-total-${kind}`, expected_total_seconds: 43800, duration_seconds: 87600 };
    assert.equal((await c.complete(body)).statusCode, 400);
    const response = await c.complete({ ...body, duration_seconds: 44400 });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(c.details().total_seconds, 44400);
    assert.equal(c.details().sessions.length, 3);
  });

  test(`${kind}: completing without timing atomically saves manual time; replays never duplicate or redo after undo`, async t => {
    const c = await fixture(t, kind);
    assert.equal(Boolean(c.details().record.task.track_time), true);
    assert.equal(c.details().record.task.expected_minutes, 20);
    const payload = { request_id: `completion-${kind}`, duration_seconds: 1500, note: '实际用了 25 分钟' };
    const first = await c.complete(payload);
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().record.task.is_completed, true);
    assert.equal(first.json().total_seconds, 1500);
    assert.equal(first.json().sessions[0].duration_source, 'manual');
    assert.deepEqual(first.json().sessions[0].days, [{ date: getTodayDate(), seconds: 1500 }]);
    assert.equal((await c.complete(payload)).statusCode, 200);
    assert.equal(c.details().sessions.length, 1);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
    assert.equal((await c.complete({ ...payload, duration_seconds: 1800 })).statusCode, 409);
    await c.app.inject({ method: 'POST', url: `/api/daily-tasks/${c.task.id}/uncomplete` });
    assert.equal((await c.complete(payload)).statusCode, 200);
    assert.equal(c.details().record.task.is_completed, false);
    assert.equal(c.details().total_seconds, 1500);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  });

  test(`${kind}: stale completion cannot overwrite saved time or an active timer`, async t => {
    const c = await fixture(t, kind);
    const payload = { request_id: `stale-completion-${kind}`, duration_seconds: 1200 };
    await c.call('/study/start');
    assert.equal((await c.complete(payload)).statusCode, 409);
    assert.equal(c.details().record.task.is_completed, false);
    assert.equal(c.details().sessions.length, 0);
    await c.call(`/sessions/${c.details().active.id}/finish`, {});
    await c.call('/sessions', { request_id: `other-record-${kind}`, duration_seconds: 60 });
    assert.equal((await c.complete(payload)).statusCode, 409);
    assert.equal(c.details().total_seconds, 60);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  });

  test(`${kind}: invalid manual time is rejected; choosing no time still completes without creating a session`, async t => {
    const c = await fixture(t, kind);
    for (const seconds of [-1, 0, 1.5, 43201, '1200']) {
      assert.equal((await c.complete({ request_id: `invalid-${kind}`, duration_seconds: seconds })).statusCode, 400);
    }
    assert.equal((await c.complete({ duration_seconds: 1200 })).statusCode, 400);
    assert.equal(c.details().sessions.length, 0);
    const response = await c.complete({ duration_seconds: null });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().record.task.is_completed, true);
    assert.equal(response.json().total_seconds, 0);
    assert.equal(response.json().sessions.length, 0);
  });
}

test('an overdue ordinary task rejects completion without leaving newly added manual time', async t => {
  const c = await fixture(t, 'task', true);
  assert.equal((await c.complete({ request_id: 'overdue-duration', duration_seconds: 1200 })).statusCode, 403);
  assert.equal(c.details().sessions.length, 0);
  assert.equal(c.details().total_seconds, 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM study_completion_requests').get().n, 0, 'a refused completion must not leave a receipt');
});

test('completion receipts survive backup restore; v30 upgrades and broken v31 backups are handled', async t => {
  const c = await fixture(t, 'task');
  const fs = require('node:fs');
  const { gzipSync, gunzipSync } = require('node:zlib');
  const Database = require('better-sqlite3');
  await c.call('/sessions', { request_id: 'backup-original-time', duration_seconds: 125 });
  const body = { request_id: 'backup-completion', expected_total_seconds: 125, duration_seconds: 125 };
  await c.complete(body);
  await c.app.inject({ method: 'POST', url: `/api/daily-tasks/${c.task.id}/uncomplete` });
  const service = c.app.backupService;
  const archive = fs.readFileSync(service.getPath((await service.create()).name));
  await c.complete({ ...body, request_id: 'later-completion' });
  await service.restore(archive);
  c.taskStudyService.completeWithDuration(c.task.id, body, 'child');
  assert.equal(c.details().record.task.is_completed, false);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM study_completion_requests').get().n, 1);

  const data = JSON.parse(gunzipSync(archive));
  const candidate = new Database(Buffer.from(data.database, 'base64'));
  try {
    candidate.exec('DROP TABLE study_completion_requests');
    const corrupted = gzipSync(JSON.stringify({ ...data, database: candidate.serialize().toString('base64') }));
    await assert.rejects(service.restore(corrupted), /备份缺少任务完成请求凭据/);
    assert.equal(c.db.prepare('SELECT COUNT(*) n FROM study_completion_requests').get().n, 1);
    candidate.pragma('user_version = 30');
    const old = gzipSync(JSON.stringify({ ...data, database: candidate.serialize().toString('base64') }));
    await service.restore(old);
    assert.equal(c.db.pragma('user_version', { simple: true }), 31);
    assert.equal(c.db.prepare('SELECT COUNT(*) n FROM study_completion_requests').get().n, 0);
    c.taskStudyService.completeWithDuration(c.task.id, { ...body, request_id: 'after-v30-upgrade' }, 'child');
    assert.equal(c.details().record.task.is_completed, true);
  } finally { candidate.close(); }
});

test('overdue course homework keeps manual time and requests parent approval', async t => {
  const c = await fixture(t, 'homework', true);
  const response = await c.complete({ request_id: 'overdue-homework-duration', duration_seconds: 1200 });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().record.task.is_completed, false);
  assert.ok(response.json().record.completion_requested_at);
  assert.equal(response.json().total_seconds, 1200);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
});

for (const kind of ['task', 'homework']) test(`${kind}: a parent completing late records the time on the due date, not today`, async t => {
  const c = await fixture(t, kind, true);
  const response = await c.app.inject({ method: 'POST', url: kind === 'homework' ? `/api/homework/${c.details().record.id}/complete` : `/api/daily-tasks/${c.task.id}/study/complete`,
    payload: { request_id: `parent-late-${kind}`, duration_seconds: 1200 } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().record.task.is_completed, true);
  assert.deepEqual(response.json().sessions[0].days, [{ date: shiftDate(getTodayDate(), -1), seconds: 1200 }]);
  const today = (await c.app.inject({ url: `/api/children/${c.child.id}/time-stats?from=${getTodayDate()}&to=${getTodayDate()}` })).json();
  assert.equal(today.summary.recorded_seconds, 0, 'the backfilled time is not counted as today’s study');
});
