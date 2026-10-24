const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');

async function fixture(t, now = familyInstant('2026-10-20', '12:00:00'), data = {}) {
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
  const c = await fixture(t, familyInstant('2026-10-20', '23:50:00'), { due_date: '2026-10-22' });
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
  const c = await fixture(t, familyInstant('2026-10-20', '23:50:00'));
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
  const archive = require('node:fs').readFileSync(backup.getPath((await backup.create('ordinary-study')).name));
  c.db.prepare('DELETE FROM homework_sessions').run();
  await backup.restore(archive);
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

test('a task revoked with study time stays out of later days, keeps its time and returns when assigned again', async t => {
  const c = await fixture(t);
  const other = c.childrenService.createChild({ name: '另一个孩子' });
  const template = c.tasksService.createTemplate({ title: '练字', subject: '语文', track_time: true, carry_over: true, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const plain = c.tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const board = () => c.tasksService.getDailyTasks(c.child.id);
  const task = board().find(row => row.template_id === template.id);
  c.tasksService.completeDailyTask(board().find(row => row.template_id === plain.id).id);
  const sid = c.taskStudyService.start(task.id).active.id; c.advance(600);
  c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
  assert.equal(c.taskStudyService.details(task.id).active, null, 'revoking ends the running session');
  assert.ok(c.taskStudyService.session(task.id, sid).ended_at);
  assert.ok(!board().some(row => row.id === task.id));
  assert.throws(() => c.taskStudyService.start(task.id), err => err.status === 409);
  assert.throws(() => c.tasksService.completeDailyTask(task.id), err => err.status === 409);

  // Assigned again the same day: the same task returns with its time.
  c.tasksService.updateTemplate(template.id, { child_ids: [c.child.id, other.id] });
  assert.equal(board().find(row => row.template_id === template.id).id, task.id);
  assert.equal(c.taskStudyService.details(task.id).total_seconds, 600);
  c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });

  // The next days neither count it as missed nor carry it over.
  c.advance(24 * 3600);
  const history = c.statsService.getHistory(c.child.id, '2026-10-20', '2026-10-20')[0];
  assert.deepEqual(history.tasks.map(row => row.title).sort(), ['口算', '阅读与练习'].sort());
  assert.ok(!c.statsService.getWeeklyCompletion(c.child.id, '2026-10-19', '2026-10-25').items.some(item => item.template_id === template.id));
  assert.ok(!board().some(row => row.id === task.id));
  assert.equal(c.stats('2026-10-20').summary.recorded_seconds, 600, 'the study time still counts');
});

test('a task revoked by a calendar change with study time is not missed on later days', async t => {
  const c = await fixture(t, familyInstant('2026-10-24', '12:00:00')); // a Saturday
  const template = c.tasksService.createTemplate({ title: '数学练习', subject: '数学', track_time: true, days_of_week: [1, 2, 3, 4, 5] });
  const makeup = c.periodsService.createMakeupDay(c.child.id, { date: '2026-10-24', acts_as: 1 });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.taskStudyService.start(task.id); c.advance(300);
  c.periodsService.deleteMakeupDay(makeup.id);
  assert.equal(c.taskStudyService.details(task.id).total_seconds, 300);
  assert.throws(() => c.tasksService.completeDailyTask(task.id), err => err.status === 409);
  assert.throws(() => c.taskStudyService.start(task.id), err => err.status === 409);
  c.advance(24 * 3600);
  assert.ok(!c.tasksService.getDailyTasks(c.child.id).some(row => row.id === task.id));
  assert.deepEqual(c.statsService.getHistory(c.child.id, '2026-10-24', '2026-10-24')[0].tasks.map(row => row.title), ['阅读与练习']);
  assert.equal(c.stats('2026-10-24').summary.recorded_seconds, 300);
});

test('ordinary tasks keep their finish-time rule after switching to study sessions', async t => {
  const c = await fixture(t, familyInstant('2026-10-19', '12:00:00'), { due_date: '2026-10-20' });
  c.taskStudyService.details(c.task.id); // opening the study window switches the task to sessions
  t.mock.timers.setTime(Date.parse(familyInstant('2026-10-20', '21:30:00')));
  c.tasksService.completeDailyTask(c.task.id, {});
  assert.deepEqual([...c.timeStatsService.finishTimes(c.child.id, '2026-10-19', '2026-10-20')], [],
    'a task of an earlier day finished later is not that later day\'s finish time');
});

test('a v22 backup without the revoked marker is rejected before restoring', async t => {
  const c = await fixture(t);
  const Database = require('better-sqlite3');
  const { gzipSync, gunzipSync } = require('node:zlib');
  const backup = c.app.backupService;
  const packed = JSON.parse(gunzipSync(require('node:fs').readFileSync(backup.getPath((await backup.create('revoked')).name))));
  const damaged = new Database(Buffer.from(packed.database, 'base64'));
  t.after(() => damaged.close());
  damaged.exec('ALTER TABLE daily_tasks DROP COLUMN revoked_at');
  const archive = () => gzipSync(JSON.stringify({ ...packed, database: damaged.serialize().toString('base64') }));
  await assert.rejects(() => backup.restore(archive()), /已取消任务标记/);
  damaged.pragma('user_version = 21');
  await backup.restore(archive());
  assert.equal(c.db.pragma('user_version', { simple: true }), 30);
});

test('a carrying task revoked with study time is not carried over the weekend', async t => {
  const c = await fixture(t, familyInstant('2026-10-23', '12:00:00')); // a Friday
  const other = c.childrenService.createChild({ name: '另一个孩子' });
  const template = c.tasksService.createTemplate({ title: '周末前练习', subject: '数学', track_time: true, carry_over: true, days_of_week: [1, 2, 3, 4, 5] });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.taskStudyService.start(task.id); c.advance(300);
  c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
  c.advance(24 * 3600);
  assert.ok(!c.tasksService.getDailyTasks(c.child.id).some(row => row.carried_from === '2026-10-23'));
  assert.ok(!c.tasksService.carryDeadlines(c.child.id).has(`${template.id}|2026-10-23`));
});

for (const action of ['delete', 'unpause']) {
  test(`past study snapshots return when a holiday is ${action === 'delete' ? 'deleted' : 'unpaused'} after midnight`, async t => {
    const c = await fixture(t);
    const template = c.tasksService.createTemplate({ title: '可恢复的假期任务', subject: '数学', track_time: true });
    const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
    c.taskStudyService.start(task.id); c.advance(60);
    const holiday = c.periodsService.createPeriod(c.child.id, { name: '误设假期', start_date: '2026-10-20', end_date: '2026-10-20', paused_template_ids: [template.id] });
    assert.ok(!c.tasksService.getDailyTasks(c.child.id).some(row => row.id === task.id));
    assert.equal(c.taskStudyService.details(task.id).active, null);
    assert.equal(c.db.prepare('SELECT revoked_at FROM daily_tasks WHERE id = ?').get(task.id).revoked_at, null);
    c.advance(86400);
    if (action === 'delete') c.periodsService.deletePeriod(holiday.id);
    else c.periodsService.updatePeriod(holiday.id, { paused_template_ids: [] });
    const history = c.statsService.getHistory(c.child.id, '2026-10-20', '2026-10-20')[0];
    assert.ok(history.tasks.some(row => row.id === task.id));
    assert.ok(c.statsService.getWeeklyCompletion(c.child.id, '2026-10-19', '2026-10-25').items.some(item => item.template_id === template.id));
    assert.equal(c.taskStudyService.details(task.id).total_seconds, 60);
    assert.equal(c.stats('2026-10-20').summary.recorded_seconds, 60);
  });
}

for (const reason of ['assignment', 'calendar']) {
  test(`revoking a studied task through ${reason} cancels its pending skip request`, async t => {
    const c = await fixture(t);
    const other = c.childrenService.createChild({ name: '另一位孩子' });
    const template = c.tasksService.createTemplate({ title: '等待跳过审批的任务', subject: '数学', track_time: true, days_of_week: [2] });
    const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
    const sid = c.taskStudyService.start(task.id).active.id; c.advance(60);
    c.taskStudyService.finish(task.id, sid, {}, 'child');
    const request = c.skipsService.requestSkip(task.id, '没布置', { role: 'child' }).request;
    let makeup;
    if (reason === 'assignment') c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
    else makeup = c.periodsService.createMakeupDay(c.child.id, { date: '2026-10-20', acts_as: 1 });
    assert.equal(c.skipsService.getRequest(request.id).status, 'cancelled');
    assert.ok(c.skipsService.getRequest(request.id).resolved_at);
    assert.ok(!c.skipsService.listRequests({ status: 'pending' }).some(row => row.id === request.id));
    assert.equal(c.taskStudyService.details(task.id).total_seconds, 60);
    if (reason === 'assignment') c.tasksService.updateTemplate(template.id, { child_ids: [c.child.id] });
    else c.periodsService.deleteMakeupDay(makeup.id);
    c.tasksService.getDailyTasks(c.child.id);
    assert.notEqual(c.skipsService.requestSkip(task.id, '再次确认', { role: 'child' }).request.id, request.id);
  });
}

test('deleting only a course record preserves its saved finish-time attribution through backup', async t => {
  const c = await fixture(t);
  const record = c.homeworkService.create(c.child.id, { subject: '语文', content: '次日写完', due_date: '2026-10-22', create_task: true }, 'parent');
  t.mock.timers.setTime(Date.parse(familyInstant('2026-10-21', '21:30:00')));
  c.homeworkStudyService.complete(record.id, 'child');
  const finish = () => [...c.timeStatsService.finishTimes(c.child.id, '2026-10-20', '2026-10-21')];
  assert.deepEqual(finish(), [['2026-10-21', 1290]]);
  c.homeworkService.delete(record.id, {}, 'parent');
  assert.deepEqual(finish(), [['2026-10-21', 1290]]);
  const backup = c.app.backupService;
  await backup.restore(require('node:fs').readFileSync(backup.getPath((await backup.create('finish-snapshot')).name)));
  assert.deepEqual(finish(), [['2026-10-21', 1290]]);
  c.tasksService.uncompleteDailyTask(record.task.id);
  assert.deepEqual(finish(), []);
  c.tasksService.completeDailyTask(record.task.id);
  assert.deepEqual(finish(), [], 'a new ordinary-task completion uses the ordinary finish rule');
});

test('v22 finish times migrate; v23 backups missing attribution are rejected safely', async t => {
  const c = await fixture(t);
  const other = c.childrenService.createChild({ name: '保留分配' });
  const template = c.tasksService.createTemplate({ title: '升级前撤销的任务', subject: '数学', track_time: true });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.taskStudyService.manual(task.id, { request_id: 'upgrade_revoked_session', duration_seconds: 60 }, 'child');
  const request = c.skipsService.requestSkip(task.id, '未布置', { role: 'child' }).request;
  c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
  // Simulate the dangling pending request produced before this fix.
  c.db.prepare("UPDATE task_skip_requests SET status = 'pending', resolved_at = NULL WHERE id = ?").run(request.id);
  const record = c.homeworkService.create(c.child.id, { subject: '语文', content: '迁移完成时间', due_date: '2026-10-22', create_task: true }, 'parent');
  t.mock.timers.setTime(Date.parse(familyInstant('2026-10-21', '21:30:00')));
  c.homeworkStudyService.complete(record.id, 'child');
  const Database = require('better-sqlite3');
  const { gzipSync, gunzipSync } = require('node:zlib');
  const backup = c.app.backupService;
  const packed = JSON.parse(gunzipSync(require('node:fs').readFileSync(backup.getPath((await backup.create('finish-migration')).name))));
  const old = new Database(Buffer.from(packed.database, 'base64')); t.after(() => old.close());
  old.exec('ALTER TABLE daily_tasks DROP COLUMN finish_on_actual_date');
  const archive = () => gzipSync(JSON.stringify({ ...packed, database: old.serialize().toString('base64') }));
  await assert.rejects(() => backup.restore(archive()), /完成时间归属/);
  assert.deepEqual([...c.timeStatsService.finishTimes(c.child.id, '2026-10-21', '2026-10-21')], [['2026-10-21', 1290]]);
  old.pragma('user_version = 22');
  await backup.restore(archive());
  assert.equal(c.db.pragma('user_version', { simple: true }), 30);
  assert.equal(c.skipsService.getRequest(request.id).status, 'cancelled');
  assert.equal(c.db.prepare('SELECT finish_on_actual_date AS actual FROM daily_tasks WHERE id = ?').get(c.task.id).actual, 0);
  assert.deepEqual([...c.timeStatsService.finishTimes(c.child.id, '2026-10-21', '2026-10-21')], [['2026-10-21', 1290]]);
});

test('a holiday pausing a studied task cancels its pending skip request', async t => {
  const c = await fixture(t);
  const template = c.tasksService.createTemplate({ title: '每天阅读', subject: '语文', track_time: true });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.taskStudyService.manual(task.id, { request_id: 'paused_skip_session', duration_seconds: 60 }, 'child');
  const request = c.skipsService.requestSkip(task.id, '老师没布置', { role: 'child' }).request;
  c.periodsService.createPeriod(c.child.id, { name: '临时停课', start_date: '2026-10-20', end_date: '2026-10-20', paused_template_ids: [template.id] });
  c.tasksService.getDailyTasks(c.child.id); // the board (or the minute timer) applies the pause
  assert.equal(c.skipsService.getRequest(request.id).status, 'cancelled');
  assert.equal(c.db.prepare('SELECT revoked_at FROM daily_tasks WHERE id = ?').get(task.id).revoked_at, null);
  assert.equal(c.taskStudyService.details(task.id).total_seconds, 60);
});

test('undo preserves an unconverted manual duration without a prior study request', async t => {
  const c = await fixture(t);
  assert.equal((await c.call('POST', '/complete', { duration_seconds: 900 })).statusCode, 200);
  assert.equal(c.db.prepare('SELECT homework_legacy_seconds AS seconds FROM daily_tasks WHERE id = ?').get(c.task.id).seconds, null);
  assert.equal((await c.call('POST', '/uncomplete')).statusCode, 200);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  assert.equal((await c.call('POST', '/uncomplete')).statusCode, 200);
  assert.equal(c.details().legacy_seconds, 900);
  assert.equal(c.details().sessions.length, 0, 'unknown historical runs must not become fabricated sessions');
  assert.equal(c.stats().summary.recorded_seconds, 900);
  assert.equal((await c.call('POST', '/complete')).statusCode, 200);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  assert.equal(c.details().total_seconds, 900);
});

test('a failed undo rolls back legacy conversion along with completion and points', async t => {
  const c = await fixture(t);
  await c.call('POST', '/complete', { duration_seconds: 900 });
  c.db.exec("CREATE TRIGGER fail_undo BEFORE DELETE ON point_logs BEGIN SELECT RAISE(ABORT, 'simulated undo failure'); END");
  assert.throws(() => c.tasksService.uncompleteDailyTask(c.task.id), /simulated undo failure/);
  const row = c.db.prepare('SELECT is_completed, duration_seconds, homework_legacy_seconds FROM daily_tasks WHERE id = ?').get(c.task.id);
  assert.deepEqual(row, { is_completed: 1, duration_seconds: 900, homework_legacy_seconds: null });
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
});

for (const mode of ['running', 'paused']) {
  for (const change of ['reassign', 'disable', 'holiday', 'weekday']) {
    test(`${change} preserves a ${mode} unconverted timer and its task id`, async t => {
      const c = await fixture(t);
      const other = c.childrenService.createChild({ name: '保留分配' });
      const template = c.tasksService.createTemplate({ title: '旧计时保全', subject: '数学', track_time: true, days_of_week: [0,1,2,3,4,5,6] });
      const board = () => c.tasksService.getDailyTasks(c.child.id);
      const task = board().find(row => row.template_id === template.id);
      c.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = ?, timer_started_at = ? WHERE id = ?')
        .run(mode === 'running' ? 300 : 900, mode === 'running' ? new Date(Date.now() - 600000).toISOString() : null, task.id);
      let period;
      const apply = () => {
        if (change === 'reassign') c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
        if (change === 'disable') c.tasksService.updateTemplate(template.id, { track_time: false });
        if (change === 'holiday' && !period) period = c.periodsService.createPeriod(c.child.id, { name: '暂停旧计时', start_date: '2026-10-20', end_date: '2026-10-20', paused_template_ids: [template.id] });
        if (change === 'weekday') c.tasksService.updateTemplate(template.id, { days_of_week: [3] });
        board();
      };
      apply(); apply();
      const row = c.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(task.id);
      assert.ok(row, 'the original task must remain');
      assert.equal(Boolean(row.revoked_at), ['reassign', 'weekday'].includes(change));
      const detail = c.taskStudyService.details(task.id);
      assert.equal(detail.active, null);
      assert.equal(detail.total_seconds, 900);
      assert.equal(detail.legacy_seconds, mode === 'running' ? 300 : 900);
      assert.equal(detail.sessions.length, mode === 'running' ? 1 : 0);
      if (mode === 'running') assert.deepEqual(detail.sessions[0].days.map(({ date, seconds }) => ({ date, seconds })), [{ date: '2026-10-20', seconds: 600 }]);
      assert.equal(c.stats().summary.recorded_seconds, 900);
      assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
      if (change !== 'disable') assert.equal(board().some(row => row.id === task.id), false);
      assert.throws(() => c.taskStudyService.start(task.id), err => err.status === 409);
      if (change === 'reassign') c.tasksService.updateTemplate(template.id, { child_ids: null });
      if (change === 'disable') c.tasksService.updateTemplate(template.id, { track_time: true });
      if (change === 'holiday') c.periodsService.deletePeriod(period.id);
      if (change === 'weekday') c.tasksService.updateTemplate(template.id, { days_of_week: [0,1,2,3,4,5,6] });
      assert.equal(board().find(row => row.id === task.id).id, task.id);
      assert.equal(c.taskStudyService.details(task.id).total_seconds, 900);
    });
  }
}

test('legacy preservation keeps real cross-midnight allocations and the old 12-hour cap', async t => {
  const c = await fixture(t, familyInstant('2026-10-21', '12:00:00'));
  const template = c.tasksService.createTemplate({ title: '跨日旧计时', subject: '语文', track_time: true, days_of_week: [0,1,2,3,4,5,6] });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 300, timer_started_at = ? WHERE id = ?')
    .run(familyInstant('2026-10-20', '23:50:00'), task.id);
  c.tasksService.updateTemplate(template.id, { track_time: false });
  const detail = c.taskStudyService.details(task.id);
  assert.equal(detail.total_seconds, 43200);
  assert.equal(detail.legacy_seconds, 300);
  assert.deepEqual(detail.sessions[0].days.map(({ date, seconds }) => ({ date, seconds })), [
    { date: '2026-10-20', seconds: 600 }, { date: '2026-10-21', seconds: 42300 }
  ]);
  assert.equal(c.timeStatsService.stats(c.child.id, '2026-10-20', '2026-10-21').summary.recorded_seconds, 43200);
});

test('a failed revocation rolls back conversion, assignment and session creation together', async t => {
  const c = await fixture(t), other = c.childrenService.createChild({ name: '另一个孩子' });
  const template = c.tasksService.createTemplate({ title: '回滚旧计时', subject: '数学', track_time: true });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.timersService.apply('task', task.id, 'start'); c.advance(600);
  const before = c.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(task.id);
  c.db.exec("CREATE TRIGGER fail_revocation BEFORE UPDATE OF revoked_at ON daily_tasks BEGIN SELECT RAISE(ABORT, 'simulated revoke failure'); END");
  assert.throws(() => c.tasksService.updateTemplate(template.id, { child_ids: [other.id] }), /simulated revoke failure/);
  assert.deepEqual(c.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(task.id), before);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM homework_sessions WHERE task_id = ?').get(task.id).n, 0);
  assert.equal(c.tasksService.getTemplate(template.id).child_ids, null);
});

test('unstarted empty legacy snapshots may still be removed without keeping ghost tasks', async t => {
  const c = await fixture(t), other = c.childrenService.createChild({ name: '另一个孩子' });
  const template = c.tasksService.createTemplate({ title: '从未学习', subject: '数学', track_time: true });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.tasksService.updateTemplate(template.id, { child_ids: [other.id] });
  assert.equal(c.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(task.id), undefined);
});

test('turning timing off leaves an unstarted task as a plain task, not a study-session one', async t => {
  const c = await fixture(t);
  const template = c.tasksService.createTemplate({ title: '不再计时', subject: '数学', track_time: true, points: 5 });
  const board = () => c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  const task = board();
  c.tasksService.updateTemplate(template.id, { track_time: false });
  assert.equal(c.db.prepare('SELECT homework_legacy_seconds AS seconds FROM daily_tasks WHERE id = ?').get(task.id).seconds, null);
  assert.equal(board().study_sessions, undefined);
  assert.equal(c.db.prepare('SELECT COUNT(*) AS n FROM homework_sessions WHERE task_id = ?').get(task.id).n, 0);
  c.tasksService.updateTemplate(template.id, { track_time: true });
  assert.equal(board().study_sessions.managed, false, 'an unstarted task converts only when /study is opened');
  assert.equal(c.taskStudyService.details(task.id).legacy_seconds, 0);
  assert.equal(board().study_sessions.managed, true);
});

test('deleting a template keeps its legacy timer available for later conversion', async t => {
  const c = await fixture(t);
  const template = c.tasksService.createTemplate({ title: '保留独立任务', subject: '语文', track_time: true });
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.timersService.apply('task', task.id, 'start'); c.advance(600);
  c.tasksService.deleteTemplate(template.id);
  const detail = c.taskStudyService.details(task.id);
  assert.equal(detail.record.task.id, task.id);
  assert.equal(detail.active.timer_seconds, 600);
  assert.equal(c.taskStudyService.finish(task.id, detail.active.id, {}, 'child').total_seconds, 600);
});

test('ending across midnight saves the session even when completing the expired task is rejected', async t => {
  const c = await fixture(t, familyInstant('2026-10-20', '23:50:00'));
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(1800);
  const ended = await c.call('POST', `/sessions/${sid}/finish`, { complete: true, note: '跨日已学完这部分' });
  assert.equal(ended.statusCode, 200, ended.body);
  const result = ended.json();
  assert.equal(result.completion_result.status, 'rejected');
  assert.equal(result.completion_result.status_code, 403);
  assert.equal(result.active, null);
  assert.equal(result.total_seconds, 1800);
  assert.equal(result.sessions[0].note, '跨日已学完这部分');
  assert.equal(result.record.task.is_completed, false);
  assert.deepEqual(c.stats('2026-10-20', '2026-10-21').days.map(day => day.recorded_seconds), [600,1200]);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  c.advance(120);
  assert.equal((await c.call('POST', `/sessions/${sid}/finish`, { complete: true })).json().total_seconds, 1800);
  assert.equal((await c.call('POST', '/study/start')).statusCode, 409);
  assert.equal((await c.call('POST', '/study/complete')).statusCode, 403);
  assert.equal((await c.call('POST', '/backfill', {}, true)).statusCode, 200);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  await c.call('POST', '/uncomplete', undefined, true);
  const retry = (await c.call('POST', `/sessions/${sid}/finish`, { complete: true }, true)).json();
  assert.equal(retry.record.task.is_completed, false, 'retrying an old finish must not complete an undone task again');
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
});

test('completion storage failures roll back completion but never undo the saved session', async t => {
  const c = await fixture(t);
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(600);
  c.db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON point_logs BEGIN SELECT RAISE(ABORT, 'simulated completion failure'); END");
  assert.equal((await c.call('POST', `/sessions/${sid}/finish`, { complete: true, note: '已保存学习' })).statusCode, 500);
  assert.equal(c.details().total_seconds, 600);
  assert.equal(c.details().active, null);
  assert.equal(c.details().sessions[0].note, '已保存学习');
  assert.equal(c.details().record.task.is_completed, false);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
});

test('invalid finish input does not save or stop an active session', async t => {
  const c = await fixture(t);
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(120);
  for (const payload of [{ complete: 'true' }, { note: '字'.repeat(501), complete: true }]) {
    assert.equal((await c.call('POST', `/sessions/${sid}/finish`, payload)).statusCode, 400);
    assert.ok(c.details().active.timer_started_at);
    assert.equal(c.details().sessions.length, 0);
  }
});

test('unfinished study stays discoverable after midnight without rejoining today or mutating history', async t => {
  const c = await fixture(t, familyInstant('2026-10-20', '23:30:00'));
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(3600);
  const next = c.tasksService.createAdhocTask(c.child.id, { title: '第二天学习', subject: '数学', track_time: true });
  c.taskStudyService.start(next.id);
  assert.equal(c.tasksService.getDailyTasks(c.child.id).some(task => task.id === c.task.id), false);
  const before = c.db.prepare('SELECT total_changes() AS n').get().n;
  const response = await c.rawInject({ method: 'GET', url: `/api/children/${c.child.id}/unfinished-study`, headers: c.headers() });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(c.db.prepare('SELECT total_changes() AS n').get().n, before, 'the discovery endpoint must be read-only');
  const found = response.json().items.find(item => item.task_id === c.task.id);
  assert.equal(response.json().today, '2026-10-21');
  assert.equal(response.json().time_zone, require('../src/config').timeZone);
  assert.equal(found.session.id, sid);
  assert.equal(found.session.timer_started_at, null);
  assert.equal(found.session.timer_seconds, 3600);
  const ended = await c.call('POST', `/sessions/${sid}/finish`, { note: '保存昨晚的学习' });
  assert.equal(ended.statusCode, 200, ended.body);
  assert.equal(c.taskStudyService.unfinished(c.child.id).items.some(item => item.task_id === c.task.id), false);
  assert.equal(c.stats('2026-10-20', '2026-10-21').summary.recorded_seconds, 3600);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
});

test('unfinished study includes homework identifiers and enforces sibling and anonymous access', async t => {
  const c = await fixture(t);
  const record = c.homeworkService.create(c.child.id, { subject: '语文', content: '未结束的课文练习', due_date: '2026-10-21', create_task: true }, 'parent');
  c.homeworkStudyService.start(record.id);
  const item = c.taskStudyService.unfinished(c.child.id).items[0];
  assert.equal(item.record_id, record.id);
  assert.equal(item.task_id, record.task.id);
  const other = c.childrenService.createChild({ name: '其他孩子' });
  const url = `/api/children/${other.id}/unfinished-study`;
  assert.equal((await c.rawInject({ method: 'GET', url, headers: c.headers() })).statusCode, 403);
  assert.equal((await c.rawInject({ method: 'GET', url })).statusCode, 401);
  assert.equal((await c.app.inject({ method: 'GET', url: '/api/children/missing/unfinished-study' })).statusCode, 404);
});

test('an old client timer running past midnight pauses into an unfinished record the child can end', async t => {
  for (const pauseWith of ['bar', 'old-button']) {
    await t.test(pauseWith, async t => {
      const c = await fixture(t, familyInstant('2026-10-20', '23:30:00'));
      assert.equal((await c.call('POST', '/timer/start')).statusCode, 200);
      c.advance(3600);
      const unfinished = () => c.taskStudyService.unfinished(c.child.id).items;
      const bar = (await c.rawInject({ method: 'GET', url: `/api/children/${c.child.id}/current-timer`, headers: c.headers() })).json().timer;
      assert.deepEqual([bar.kind, bar.id, bar.timer_seconds], ['task', c.task.id, 3600]);
      const paused = pauseWith === 'bar'
        ? await c.rawInject({ method: 'POST', url: `/api/children/${c.child.id}/current-timer/pause`, headers: c.headers() })
        : await c.call('POST', '/timer/pause');
      assert.equal(paused.statusCode, 200, paused.body);
      const found = unfinished().find(item => item.task_id === c.task.id);
      assert.ok(found, 'the paused time stays reachable from the unfinished list');
      assert.deepEqual([found.session.timer_started_at, found.session.timer_seconds], [null, 3600]);
      assert.deepEqual(found.session.days, [{ date: '2026-10-20', seconds: 1800 }, { date: '2026-10-21', seconds: 1800 }]);
      assert.equal((await c.call('POST', `/sessions/${found.session.id}/finish`)).statusCode, 200);
      assert.equal(c.details().total_seconds, 3600, 'no time counted twice');
      assert.equal(unfinished().length, 0);
      assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0, 'an overdue task earns nothing');
    });
  }
});
