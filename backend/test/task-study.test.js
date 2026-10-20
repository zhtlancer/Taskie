const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

async function fixture(t, now = '2026-10-20T04:00:00Z', data = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const c = createTestApp(); t.after(() => cleanupTestApp(c)); await c.app.ready();
  const services = c.app.services;
  const child = services.childrenService.createChild({ name: '普通任务分次学习' });
  const task = services.tasksService.createAdhocTask(child.id, { title: '阅读与练习', subject: '语文', track_time: true, points: 10, ...data });
  const headers = () => ({ authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: child.id, epoch: c.app.sessionEpoch() })}` });
  const call = (method, suffix, payload, parent = false) => (parent ? c.app.inject : c.rawInject)({ method, url: `/api/daily-tasks/${task.id}${suffix}`, payload, ...(parent ? {} : { headers: headers() }) });
  const advance = seconds => t.mock.timers.setTime(Date.now() + seconds * 1000);
  const details = () => services.taskStudyService.details(task.id);
  const stats = (from = '2026-10-20', to = from) => services.timeStatsService.stats(child.id, from, to);
  return { ...c, ...services, child, task, call, advance, details, stats, headers };
}

test('ordinary tasks allow multiple sessions, pausing, final completion and undo without losing time', async t => {
  const c = await fixture(t);
  const first = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(600);
  await c.call('POST', `/sessions/${first}/pause`);
  c.advance(300);
  assert.equal((await c.call('POST', '/study/start')).json().active.id, first);
  c.advance(60);
  const ended = await c.call('POST', `/sessions/${first}/finish`, { note: '读完第一部分' });
  assert.equal(ended.statusCode, 200, ended.body);
  assert.equal(ended.json().total_seconds, 660);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  assert.equal(c.stats().summary.recorded_seconds, 660, 'unfinished tasks count actual time');
  assert.equal((await c.call('POST', `/sessions/${first}/finish`)).json().sessions.length, 1);
  const second = (await c.call('POST', '/study/start')).json().active.id;
  assert.notEqual(second, first);
  c.advance(300);
  const completed = await c.call('POST', `/sessions/${second}/finish`, { complete: true });
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().record.task.is_completed, true);
  assert.equal(completed.json().total_seconds, 960);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  await c.call('POST', `/sessions/${second}/finish`, { complete: true });
  await c.call('POST', '/complete');
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  await c.call('POST', '/uncomplete');
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  assert.equal(c.stats().summary.recorded_seconds, 960);
  assert.equal(c.stats().summary.sessions, 2);
  assert.equal(c.stats().tasks[0].average_seconds, 960, 'task averages use the whole task, not one of its sessions');
  assert.equal(c.details().sessions.length, 2);
});

test('direct completion ends the active ordinary session atomically; aggregate overrides are rejected', async t => {
  const c = await fixture(t);
  await c.call('POST', '/study/start'); c.advance(120);
  const rejected = await c.call('POST', '/complete', { duration_seconds: 900 });
  assert.equal(rejected.statusCode, 409);
  assert.ok(c.details().active.timer_started_at);
  const completed = await c.call('POST', '/complete');
  assert.equal(completed.statusCode, 200, completed.body);
  assert.equal(completed.json().points_earned, 10);
  assert.equal(c.details().active, null);
  assert.equal(c.details().total_seconds, 120);
  assert.equal((await c.call('PUT', '/duration', { duration_seconds: 600 })).statusCode, 409);
});

test('ordinary cross-midnight sessions split actual dates and do not become two learning sessions', async t => {
  const c = await fixture(t, '2026-10-20T15:50:00Z', { due_date: '2026-10-22' });
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(1800);
  await c.call('POST', `/sessions/${sid}/finish`);
  const stats = c.stats('2026-10-20', '2026-10-21');
  assert.equal(stats.summary.recorded_seconds, 1800);
  assert.equal(stats.summary.sessions, 1);
  assert.equal(stats.tasks[0].kind, 'adhoc');
  assert.equal(stats.tasks[0].average_seconds, 1800);
  assert.deepEqual(stats.days.map(day => day.recorded_seconds), [600, 1200]);
  assert.equal((await c.call('PUT', `/sessions/${sid}`, { note: '改昨天' })).statusCode, 403);
  assert.equal((await c.call('PUT', `/sessions/${sid}`, { note: '家长更正' }, true)).statusCode, 200);
});

test('ordinary tasks retain deadlines: child may end a session after midnight, parent completes overdue task', async t => {
  const c = await fixture(t, '2026-10-20T15:50:00Z');
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(1800);
  assert.equal((await c.call('POST', '/study/complete')).statusCode, 403);
  assert.equal((await c.call('POST', `/sessions/${sid}/finish`)).statusCode, 200);
  assert.equal((await c.call('POST', '/study/start')).statusCode, 409);
  const parent = await c.call('POST', '/backfill', { duration_seconds: null }, true);
  assert.equal(parent.statusCode, 200, parent.body);
  assert.equal(parent.json().task.completion_source, 'parent_backfill');
  assert.equal(c.details().total_seconds, 1800);
  assert.equal(c.stats('2026-10-21').days[0].finished_at, null);
  assert.equal((await c.call('PUT', `/sessions/${sid}`, { note: '孩子修改补卡' })).statusCode, 403);
});

test('manual records are idempotent, editable independently and scoped to the owner and task', async t => {
  const c = await fixture(t);
  const payload = { request_id: 'ordinary_manual_1', duration_seconds: 300, note: '手动一次' };
  assert.equal((await c.call('POST', '/sessions', payload)).statusCode, 200);
  await c.call('POST', '/sessions', payload);
  assert.equal(c.details().sessions.length, 1);
  assert.equal((await c.call('PUT', '/sessions/ordinary_manual_1', { duration_seconds: 600, note: '更正' })).statusCode, 200);
  assert.equal(c.details().total_seconds, 600);
  const other = c.childrenService.createChild({ name: '另一个孩子' });
  const token = c.app.jwt.sign({ role: 'child', child_id: other.id, epoch: c.app.sessionEpoch() });
  const denied = await c.rawInject({ method: 'POST', url: `/api/daily-tasks/${c.task.id}/sessions`, payload, headers: { authorization: `Bearer ${token}` } });
  assert.equal(denied.statusCode, 403);
  const second = c.tasksService.createAdhocTask(c.child.id, { title: '第二个任务', subject: '数学', track_time: true });
  const mismatch = await c.app.inject({ method: 'PUT', url: `/api/daily-tasks/${second.id}/sessions/ordinary_manual_1`, payload: { note: '串任务' } });
  assert.equal(mismatch.statusCode, 404);
  assert.equal((await c.call('POST', '/sessions', { ...payload, request_id: 'invalid_future_1', date: '2026-10-21' })).statusCode, 400);
});

test('starting ordinary, course-homework and goal timers pauses the other kinds', async t => {
  const c = await fixture(t);
  await c.call('POST', '/study/start'); c.advance(60);
  const record = c.homeworkService.create(c.child.id, { subject: '数学', content: '课程练习', due_date: '2026-10-22', create_task: true }, 'parent');
  c.homeworkStudyService.start(record.id);
  assert.equal(c.details().active.timer_started_at, null);
  assert.equal(c.details().active.duration_seconds, 60);
  c.advance(60); await c.call('POST', '/study/start');
  assert.equal(c.homeworkStudyService.details(record.id).active.timer_started_at, null);
  const goal = c.periodsService.createGoal(c.child.id, { title: '长篇阅读', subject: '语文', mode: 'progress', unit: '页', total_amount: 10, track_time: true });
  c.timersService.apply('goal', goal.id, 'start');
  assert.equal(c.details().active.timer_started_at, null);
});

test('legacy running timers convert without double counting or fabricating past sessions', async t => {
  const c = await fixture(t);
  c.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 300, timer_started_at = ? WHERE id = ?').run(new Date(Date.now() - 600000).toISOString(), c.task.id);
  const detail = (await c.call('GET', '/study')).json();
  assert.equal(detail.legacy_seconds, 300);
  assert.equal(detail.sessions.length, 0);
  assert.equal(detail.active.timer_seconds, 600);
  await c.call('POST', `/sessions/${detail.active.id}/finish`);
  assert.equal(c.details().total_seconds, 900);
  assert.equal(c.stats().summary.recorded_seconds, 900);
  assert.equal(c.details().sessions.length, 1);
  await c.call('GET', '/study');
  assert.equal(c.details().total_seconds, 900);
});

test('skipping saves the active session, and disabling template timing preserves session history', async t => {
  const c = await fixture(t);
  const template = c.tasksService.createTemplate({ title: '练字', subject: '语文', track_time: true, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.taskStudyService.start(task.id); c.advance(120);
  c.tasksService.updateTemplate(template.id, { track_time: false });
  assert.equal(c.taskStudyService.details(task.id).active, null);
  assert.equal(c.taskStudyService.details(task.id).total_seconds, 120);
  assert.throws(() => c.taskStudyService.start(task.id), err => err.status === 409);
  await c.call('POST', '/study/start'); c.advance(180);
  const skipped = await c.call('POST', '/skip', { reason: '今天请假' }, true);
  assert.equal(skipped.statusCode, 201, skipped.body);
  assert.equal(c.details().active, null);
  assert.equal(c.details().total_seconds, 180);
  assert.equal(c.stats().summary.recorded_seconds, 300);
});

test('weekly completion counts one final completion, not the number of learning sessions', async t => {
  const c = await fixture(t);
  const template = c.tasksService.createTemplate({ title: '每周阅读', subject: '语文', track_time: true, schedule_type: 'weekly_times', weekly_target_times: 1, allow_extra: true, extra_points: 3, extra_reward_limit: 1, days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 10 });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  for (let i = 0; i < 3; i++) {
    const sid = c.taskStudyService.start(task.id).active.id; c.advance(60);
    c.taskStudyService.finish(task.id, sid, {}, 'child');
  }
  assert.equal(c.tasksService.describeTask(task).weekly_completed_times, 0);
  c.taskStudyService.complete(task.id, 'child');
  assert.equal(c.tasksService.describeTask(task).weekly_completed_times, 1);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  c.tasksService.uncompleteDailyTask(task.id);
  assert.equal(c.tasksService.describeTask(task).weekly_completed_times, 0);
  assert.equal(c.taskStudyService.details(task.id).total_seconds, 180);
});

test('completed legacy durations and new sessions survive backup and restore together', async t => {
  const c = await fixture(t);
  c.tasksService.completeDailyTask(c.task.id, { duration_seconds: 900 });
  assert.equal(c.details().legacy_seconds, 900);
  assert.equal(c.details().sessions.length, 0);
  await c.call('POST', '/uncomplete');
  await c.call('POST', '/sessions', { request_id: 'backup_manual_session', duration_seconds: 300 });
  const backup = c.app.backupService;
  const archive = require('node:fs').readFileSync(backup.getPath(backup.create('ordinary-study').name));
  c.db.prepare('DELETE FROM homework_sessions').run();
  backup.restore(archive);
  assert.equal(c.details().total_seconds, 1200);
  assert.equal(c.details().sessions.length, 1);
  assert.equal(c.stats().summary.recorded_seconds, 1200);
});

test('untimed tasks remain direct check-offs; timed tasks can complete without recording a duration', async t => {
  const c = await fixture(t, undefined, { track_time: false });
  assert.equal((await c.call('GET', '/study')).statusCode, 409);
  assert.equal((await c.call('POST', '/complete')).json().task.is_completed, true);
  const timed = c.tasksService.createAdhocTask(c.child.id, { title: '忘记计时', subject: '数学', track_time: true });
  c.taskStudyService.details(timed.id);
  c.taskStudyService.complete(timed.id, 'child');
  assert.equal(c.stats().summary.missing, 1);
  assert.equal(c.stats().summary.recorded_seconds, 0);
});

test('expected time compares the complete task total across sessions', async t => {
  const c = await fixture(t, undefined, { expected_minutes: 10 });
  for (let i = 0; i < 2; i++) {
    const sid = c.taskStudyService.start(c.task.id).active.id; c.advance(360);
    c.taskStudyService.finish(c.task.id, sid, {}, 'child');
  }
  assert.equal(c.stats().tasks[0].judged, 0, 'unfinished work is not yet judged against the expected time');
  c.taskStudyService.complete(c.task.id, 'child');
  const task = c.stats().tasks[0];
  assert.equal(task.average_seconds, 720);
  assert.equal(task.expected_minutes, 10);
  assert.equal(task.judged, 1);
  assert.equal(task.over_expected, 1);
});

test('unassigning a template and then undoing completion keeps actual study history', async t => {
  const c = await fixture(t);
  const other = c.childrenService.createChild({ name: '保留分配的孩子' });
  const template = c.tasksService.createTemplate({ title: '分配的练习', subject: '数学', track_time: true, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  const sid = c.taskStudyService.start(task.id).active.id; c.advance(120);
  c.taskStudyService.finish(task.id, sid, { complete: true }, 'child');
  c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
  c.tasksService.uncompleteDailyTask(task.id);
  assert.equal(c.taskStudyService.details(task.id).total_seconds, 120);
  assert.ok(!c.tasksService.getDailyTasks(c.child.id).some(row => row.id === task.id));
  assert.equal(c.stats().summary.recorded_seconds, 120);
});
