const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate, getWeekRange } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { tasksService: tasks, childrenService, rewardsService: rewards } = ctx.app.services;
  const child = childrenService.createChild({ name: '补卡同学' });
  const date = shiftDate(getTodayDate(), -2);
  const create = (data = {}) => tasks.createAdhocTask(child.id, { title: '口算', subject: '数学', points: 10, date, ...data });
  const post = (id, action = 'backfill', payload = {}) => ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${id}/${action}`, payload });
  const list = (day = date) => ctx.app.inject({ method: 'GET', url: `/api/daily-tasks/backfill?child_id=${child.id}&date=${day}` });
  return { ...ctx, tasks, rewards, child, date, create, post, list };
}

test('parent backfills existing rows idempotently; points, history, audit and undo stay consistent', async t => {
  const ctx = await fixture(t);
  const row = ctx.create({ track_time: true });
  const before = ctx.db.prepare('SELECT COUNT(*) n FROM daily_tasks').get().n;
  assert.deepEqual((await ctx.list(shiftDate(ctx.date, -1))).json().tasks, []);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM daily_tasks').get().n, before, 'listing cannot create historical tasks');
  for (let i = 0; i < 2; i++) {
    const response = await ctx.post(row.id, 'backfill', { duration_seconds: 600 });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().points_earned, i === 0 ? 10 : 0);
  }
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 10);
  const result = (await ctx.list()).json();
  assert.equal(result.tasks[0].completion_source, 'parent_backfill');
  assert.equal(result.tasks[0].duration_seconds, 600);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].actor, 'parent');
  assert.equal(ctx.db.prepare('SELECT activity_date FROM point_logs WHERE daily_task_id = ?').get(row.id).activity_date, ctx.date);
  const history = ctx.app.services.statsService.getHistory(ctx.child.id, ctx.date, ctx.date);
  assert.equal(history[0].all_done, true);
  assert.equal(history[0].tasks[0].completion_source, 'parent_backfill');
  // Even if a late-night operation is assigned to the prior evening, its time is not real completion time.
  ctx.db.prepare('UPDATE daily_tasks SET completed_at = ? WHERE id = ?').run(`${ctx.date}T10:00:00.000Z`, row.id);
  assert.equal(ctx.app.services.timeStatsService.finishTimes(ctx.child.id, ctx.date, ctx.date).size, 0);
  for (let i = 0; i < 2; i++) assert.equal((await ctx.post(row.id, 'undo-backfill')).statusCode, 200);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 0);
  const undone = (await ctx.list()).json();
  assert.equal(undone.tasks[0].is_completed, false);
  assert.equal(undone.tasks[0].completion_source, null);
  assert.equal(undone.events.length, 2);
  assert.equal(undone.events[0].action, 'undo');
  assert.equal(undone.events[0].points, -10);
  assert.equal((await ctx.post(row.id)).statusCode, 200);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 10);
  assert.equal((await ctx.list()).json().events.length, 3);
});

test('backfill APIs require parents and validate dates, skips, timing and task kind', async t => {
  const ctx = await fixture(t);
  const row = ctx.create({ track_time: true, due_date: shiftDate(getTodayDate(), 2) });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: ctx.child.id, epoch: ctx.app.sessionEpoch() })}` };
  for (const options of [
    { method: 'GET', url: `/api/daily-tasks/backfill?child_id=${ctx.child.id}&date=${ctx.date}` },
    { method: 'POST', url: `/api/daily-tasks/${row.id}/backfill` },
    { method: 'POST', url: `/api/daily-tasks/${row.id}/undo-backfill` }
  ]) assert.equal((await ctx.rawInject({ ...options, headers })).statusCode, 403);
  for (const day of ['2026-02-30', 'bad', getTodayDate(), shiftDate(getTodayDate(), 1)]) {
    assert.equal((await ctx.list(day)).statusCode, 400, day);
  }
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/daily-tasks/backfill' })).statusCode, 400);
  assert.equal((await ctx.post('missing')).statusCode, 404);
  assert.equal((await ctx.post(ctx.create({ date: getTodayDate() }).id)).statusCode, 400);
  assert.equal((await ctx.post(ctx.create({ date: shiftDate(getTodayDate(), 1) }).id)).statusCode, 400);
  assert.equal((await ctx.post(row.id, 'backfill', { duration_seconds: 1 })).statusCode, 400);
  ctx.db.prepare('UPDATE daily_tasks SET skipped_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  assert.equal((await ctx.post(row.id)).statusCode, 409);
  assert.equal((await ctx.post(row.id, 'unskip')).statusCode, 200);
  assert.equal((await ctx.post(row.id)).statusCode, 200);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${row.id}/uncomplete`, headers })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'PUT', url: `/api/daily-tasks/${row.id}/duration`, headers, payload: { duration_seconds: 120 } })).statusCode, 403);
  const goalRow = ctx.create();
  ctx.db.prepare("UPDATE daily_tasks SET origin = 'goal' WHERE id = ?").run(goalRow.id);
  assert.equal((await ctx.post(goalRow.id)).statusCode, 409);
  assert.ok(!(await ctx.list()).json().tasks.some(task => task.id === goalRow.id));
});

test('weekly backfills respect the original week cap; carried tasks reuse their original row', async t => {
  const ctx = await fixture(t);
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const first = ctx.create({ date: monday });
  const second = ctx.create({ date: shiftDate(monday, 1) });
  for (const row of [first, second]) ctx.db.prepare("UPDATE daily_tasks SET schedule_type = 'weekly_times', weekly_target_times = 1, source_template_id = 'weekly-test' WHERE id = ?").run(row.id);
  assert.equal((await ctx.post(first.id)).statusCode, 200);
  assert.equal((await ctx.post(second.id)).statusCode, 409);
  assert.equal((await ctx.post(first.id, 'undo-backfill')).statusCode, 200);
  assert.equal((await ctx.post(second.id)).statusCode, 200);
  const carried = ctx.create({ due_date: shiftDate(getTodayDate(), 1), track_time: true });
  ctx.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 300 WHERE id = ?').run(carried.id);
  assert.equal((await ctx.post(carried.id)).statusCode, 200);
  const row = ctx.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(carried.id);
  assert.equal(row.date, ctx.date);
  assert.ok(!ctx.tasks.getDailyTasks(ctx.child.id).some(task => task.id === carried.id), 'backfilling history must not show up as a completion on today’s board');
  assert.equal(row.duration_seconds, null, 'backfill does not treat an old timer as actual duration');
  assert.equal((await ctx.post(carried.id)).json().points_earned, 0);
});

test('legacy parent complete and undo endpoints also retain backfill audit; ordinary completions cannot be undone by the new endpoint', async t => {
  const ctx = await fixture(t);
  const task = ctx.create();
  assert.equal((await ctx.post(task.id, 'complete')).statusCode, 200);
  assert.equal((await ctx.list()).json().events.length, 1);
  assert.equal((await ctx.post(task.id, 'uncomplete')).statusCode, 200);
  assert.equal((await ctx.list()).json().events.length, 2);
  const other = ctx.create();
  ctx.tasks.completeDailyTask(other.id);
  assert.equal((await ctx.post(other.id, 'undo-backfill')).statusCode, 409);
  const carried = ctx.create({ due_date: shiftDate(getTodayDate(), 1), track_time: true });
  ctx.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 300 WHERE id = ?').run(carried.id);
  const normal = await ctx.post(carried.id, 'complete');
  assert.equal(normal.statusCode, 200);
  assert.equal(normal.json().task.completion_source, null, 'normal completion of an open carried task is still normal');
  assert.equal(normal.json().task.duration_seconds, 300);
});

test('undo after spending points is permitted, and an audit write failure rolls the entire completion back', async t => {
  const ctx = await fixture(t);
  const task = ctx.create();
  assert.equal((await ctx.post(task.id)).statusCode, 200);
  const redemptions = ctx.app.services.redemptionsService;
  const reward = redemptions.createItem({ title: '贴纸', cost: 10 });
  redemptions.requestRedemption(ctx.child.id, reward.id);
  assert.equal((await ctx.post(task.id, 'undo-backfill')).statusCode, 200);
  assert.equal(ctx.rewards.getAvailablePoints(ctx.child.id), -10);
  ctx.db.exec("CREATE TRIGGER fail_backfill BEFORE INSERT ON task_backfill_events BEGIN SELECT RAISE(ABORT, 'test audit failure'); END");
  assert.equal((await ctx.post(task.id)).statusCode, 500);
  assert.equal(ctx.db.prepare('SELECT is_completed FROM daily_tasks WHERE id = ?').get(task.id).is_completed, 0);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 0);
  assert.equal((await ctx.list()).json().events.length, 2);
});

function multipart(buffer) {
  return {
    headers: { 'content-type': 'multipart/form-data; boundary=backfill-test' },
    payload: Buffer.concat([Buffer.from('--backfill-test\r\nContent-Disposition: form-data; name="pin"\r\n\r\n1234\r\n--backfill-test\r\nContent-Disposition: form-data; name="file"; filename="backup.taskie.gz"\r\nContent-Type: application/octet-stream\r\n\r\n'), buffer, Buffer.from('\r\n--backfill-test--\r\n')])
  };
}

test('backfill markers and audit survive backup restore; v14 migrates and damaged v15 is rejected', async t => {
  const ctx = await fixture(t);
  const task = ctx.create();
  await ctx.post(task.id);
  ctx.tasks.recordDaySnapshot(ctx.child.id, ctx.date);
  const backup = ctx.app.backupService;
  const archive = fs.readFileSync(backup.getPath(backup.create().name));
  await ctx.post(task.id, 'undo-backfill');
  ctx.db.prepare('DELETE FROM task_day_snapshots').run();
  const restore = buffer => ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(buffer) });
  assert.equal((await restore(archive)).statusCode, 200);
  assert.equal(ctx.tasks.hasDaySnapshot(ctx.child.id, ctx.date), true);
  assert.equal((await ctx.list()).json().events.length, 1);
  assert.equal((await ctx.list()).json().tasks[0].completion_source, 'parent_backfill');
  const data = JSON.parse(gunzipSync(archive));
  for (const mutation of ['DROP TABLE task_backfill_events', 'ALTER TABLE daily_tasks DROP COLUMN completion_source', 'DROP TABLE task_day_snapshots']) {
    const db = new Database(Buffer.from(data.database, 'base64'));
    db.exec(mutation);
    const damaged = gzipSync(JSON.stringify({ ...data, database: db.serialize().toString('base64') }));
    db.close();
    const response = await restore(damaged);
    assert.equal(response.statusCode, 400, response.body);
    assert.match(response.body, /补卡|快照/);
  }
  const db = new Database(Buffer.from(data.database, 'base64'));
  db.exec('DROP TABLE task_backfill_events; ALTER TABLE daily_tasks DROP COLUMN completion_source; PRAGMA user_version = 14');
  const legacy = gzipSync(JSON.stringify({ ...data, database: db.serialize().toString('base64') }));
  db.close();
  assert.equal((await restore(legacy)).statusCode, 200);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 18);
  assert.equal((await ctx.list()).json().events.length, 0);
});

test('unopened past days list projections without writing, and a parent materializes them on demand', async t => {
  const ctx = await fixture(t);
  const lastMonday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(lastMonday, n);
  const backdate = `${day(-30)}T04:00:00.000Z`;
  ctx.db.prepare('UPDATE children SET created_at = ?').run(backdate);
  const daily = ctx.tasks.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 10 });
  const weekly = ctx.tasks.createTemplate({ title: '跳绳', subject: '体育', days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 5,
    schedule_type: 'weekly_times', weekly_target_times: 1 });
  ctx.tasks.createTemplate({ title: '周日阅读', subject: '语文', days_of_week: [0], points: 5 });
  const piano = (await ctx.app.inject({ method: 'POST', url: '/api/outside-classes', payload: {
    title: '钢琴课', days_of_week: [2], start_time: '16:30', end_time: '17:30', start_date: day(-30), create_task: true, points: 8
  } })).json();
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(backdate);
  ctx.db.prepare('UPDATE outside_classes SET created_at = ?').run(backdate);
  const count = () => ctx.db.prepare('SELECT COUNT(*) n FROM daily_tasks').get().n;
  const materialize = (date, headers) => ctx.rawInject({ method: 'POST', url: '/api/daily-tasks/backfill/day', payload: { child_id: ctx.child.id, date },
    headers: headers || { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() })}` } });

  // Tuesday was never opened: its templates and piano check-in are projected, nothing is written.
  const before = count();
  const projected = (await ctx.list(day(1))).json().tasks;
  assert.deepEqual(projected.map(task => [task.title, task.projected]).sort(), [['口算', true], ['跳绳', true], ['钢琴课', true]]);
  assert.equal(projected.find(task => task.title === '钢琴课').class_id, piano.id);
  assert.equal(count(), before, 'listing an unopened day must not create tasks');
  assert.deepEqual((await ctx.list(day(-31))).json().tasks, [], 'nothing applied before the child existed');

  const child = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: ctx.child.id, epoch: ctx.app.sessionEpoch() })}` };
  assert.equal((await materialize(day(1), child)).statusCode, 403);
  for (const date of [getTodayDate(), 'bad']) assert.equal((await materialize(date)).statusCode, 400);

  for (let i = 0; i < 2; i++) {
    const response = await materialize(day(1));
    assert.equal(response.statusCode, 200, response.body);
    assert.ok(response.json().tasks.every(task => !task.projected));
    assert.equal(response.json().tasks.length, 3);
  }
  assert.equal(count(), before + 3, 'materializing is idempotent');
  const rows = (await ctx.list(day(1))).json().tasks;
  const row = rows.find(task => task.template_id === daily.id);
  assert.equal((await ctx.post(row.id)).json().points_earned, 10);
  assert.equal((await ctx.post(rows.find(task => task.title === '钢琴课').id)).json().points_earned, 8);
  const completion = ctx.app.services.statsService.getWeeklyCompletion(ctx.child.id, day(0), day(6), day(6));
  assert.equal(completion.items.find(item => item.title === '口算').completed, 1);

  // A weekly target met on Thursday drops the weekly template from Tuesday's projection.
  const thursday = (await materialize(day(3))).json().tasks;
  assert.equal((await ctx.post(thursday.find(task => task.template_id === weekly.id).id)).statusCode, 200);
  assert.ok(!(await ctx.list(day(2))).json().tasks.some(task => task.template_id === weekly.id));
  assert.ok((await ctx.list(day(2))).json().tasks.some(task => task.template_id === daily.id));
});
