const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { SCHEMA_VERSION } = require('../src/db');
const { getTodayDate, shiftDate, getWeekRange } = require('../src/utils/date');
const { validateTaskFailures } = require('../src/db/task-failure-constraints');

async function fixture(t, data = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-23', '18:00:00')) });
  const c = createTestApp(); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const s = c.app.services;
  const child = s.childrenService.createChild({ name: '学校任务' });
  const other = s.childrenService.createChild({ name: '另一位孩子' });
  const task = s.tasksService.createAdhocTask(child.id, { title: '学校记事', subject: '语文', points: 5, ...data });
  const call = (suffix, body, actor = { role: 'parent' }, id = task.id, extraHeaders = {}) => c.app.inject({ method: 'POST',
    url: `/api/daily-tasks/${id}/${suffix}`, payload: body,
    headers: { authorization: `Bearer ${c.app.jwt.sign({ ...actor, epoch: c.app.sessionEpoch() })}`, ...extraHeaders } });
  const confirm = (body = {}, actor, id) => call('confirm-failure', { request_id: 'failure-receipt-0001', reason: '没有在学校记录作业', penalty: 0, expected_completed_at: null, ...body }, actor, id);
  const current = () => s.tasksService.getDailyTasks(child.id).find(row => row.id === task.id);
  return { ...c, ...s, child, other, task, call, confirm, current };
}

test('parent confirms pending tasks with optional deductions; replay, restore and stale replays are safe', async t => {
  const c = await fixture(t);
  let response = await c.confirm({ penalty: 2 });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(c.current().is_failed, true);
  assert.equal(c.current().is_completed, false);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), -2);
  const logs = await c.app.inject({ method: 'GET', url: `/api/children/${c.child.id}/point-logs` });
  assert.equal(logs.json()[0].points, -2);
  assert.match(logs.json()[0].title, /确认未完成.*额外扣分/);
  assert.equal((await c.confirm({ penalty: 2 })).statusCode, 200);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), -2);
  assert.equal((await c.confirm({ penalty: 3 })).statusCode, 409);
  assert.equal((await c.confirm({ request_id: 'failure-other-0002' })).statusCode, 409);
  for (const suffix of ['complete', 'uncomplete', 'skip']) {
    const blocked = await c.call(suffix, { reason: '今天没有' }, { role: 'child', child_id: c.child.id });
    assert.equal(blocked.statusCode, 409, `${suffix}: ${blocked.body}`);
  }
  response = await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(c.current().is_failed, false);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  await c.confirm({ penalty: 2 });
  assert.equal(c.current().is_failed, false, 'old confirmation cannot re-close a restored task');
  await c.confirm({ request_id: 'failure-receipt-0002', penalty: 3 });
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  assert.equal(c.current().failure_id, 'failure-receipt-0002', 'old restoration cannot restore a newer failure');
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), -3);
  validateTaskFailures(c.db);
});

test('completed task rewards are reclaimed separately from deductions; restoration never re-awards points', async t => {
  const c = await fixture(t);
  await c.call('complete');
  const completed_at = c.current().completed_at;
  assert.equal((await c.confirm()).statusCode, 409, 'stale pending preview cannot revoke new completion');
  const response = await c.confirm({ penalty: 2, expected_completed_at: completed_at });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), -2, 'five awarded points reclaimed plus two deducted');
  const stats = c.rewardsService.getChildStats(c.child.id);
  assert.equal(stats.today_completed_tasks, 0); assert.equal(stats.today_completion_rate, 0);
  assert.equal(c.rewardsService.getAllDoneDaysCount(c.child.id), 0);
  const history = c.statsService.getHistory(c.child.id, getTodayDate(), getTodayDate());
  assert.equal(history[0].tasks[0].is_failed, true);
  assert.equal(history[0].points_earned, -2);
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  assert.equal((await c.call('complete')).statusCode, 200);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 5);
  validateTaskFailures(c.db);
});

test('failures stop running timed tasks while preserving sessions and forbid new timing or completion', async t => {
  const c = await fixture(t, { track_time: true });
  const started = await c.call('study/start'); assert.equal(started.statusCode, 200, started.body);
  const sid = started.json().active.id;
  t.mock.timers.setTime(Date.now() + 120000);
  assert.equal((await c.confirm()).statusCode, 200);
  const details = c.taskStudyService.details(c.task.id);
  assert.equal(details.total_seconds, 120); assert.equal(details.active, null);
  assert.equal(c.timersService.current(c.child.id), null);
  assert.equal((await c.call('study/start')).statusCode, 409);
  assert.equal((await c.call('study/complete', { request_id: 'failed-completion-001', duration_seconds: 180, expected_total_seconds: 120 })).statusCode, 409);
  const retried = await c.call(`sessions/${sid}/finish`, { complete: true }, { role: 'child', child_id: c.child.id });
  assert.equal(retried.statusCode, 200, retried.body);
  assert.equal(c.current().is_completed, false);
  assert.equal(c.taskStudyService.details(c.task.id).total_seconds, 120);
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  assert.equal((await c.call('study/start')).statusCode, 200);
});

test('confirming a completed legacy timer retains its aggregate without inventing historical sessions', async t => {
  const c = await fixture(t, { track_time: true });
  const done = await c.call('complete', { duration_seconds: 300 });
  assert.equal(done.statusCode, 200, done.body);
  const response = await c.confirm({ expected_completed_at: c.current().completed_at });
  assert.equal(response.statusCode, 200, response.body);
  const details = c.taskStudyService.details(c.task.id);
  assert.equal(details.legacy_seconds, 300);
  assert.equal(details.total_seconds, 300);
  assert.equal(details.sessions.length, 0);
});

test('server rejects child operations, invalid values, changed generations and unsupported task kinds', async t => {
  const c = await fixture(t);
  for (const child of [c.child, c.other]) {
    const actor = { role: 'child', child_id: child.id };
    assert.equal((await c.confirm({}, actor)).statusCode, 403);
    assert.equal((await c.call('restore-failure', { failure_id: 'failure-receipt-0001' }, actor)).statusCode, 403);
  }
  for (const body of [{ penalty: -1 }, { penalty: 1.5 }, { penalty: '2' }, { penalty: 10001 }, { reason: '' }, { reason: '字'.repeat(151) }, { expected_completed_at: undefined }, { request_id: 'bad' }]) {
    assert.equal((await c.confirm(body)).statusCode, 400, JSON.stringify(body));
  }
  const stale = await c.call('confirm-failure', { request_id: 'generation-failure-1', reason: '未完成', expected_completed_at: null }, undefined, undefined, { 'X-Taskie-Data-Generation': 'old' });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().code, 'DATA_RESTORED');
  c.db.prepare("UPDATE daily_tasks SET origin = 'class' WHERE id = ?").run(c.task.id);
  assert.equal((await c.confirm()).statusCode, 409);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM task_failures').get().n, 0);
});

test('homework closes across both APIs and its course summary counts confirmed failures', async t => {
  const c = await fixture(t);
  const record = c.homeworkService.create(c.child.id, { course_kind: 'school', subject: '数学', content: '记事本作业', create_task: true,
    assigned_date: getTodayDate(), due_date: shiftDate(getTodayDate(), 1) }, 'parent');
  const response = await c.confirm({}, undefined, record.task.id);
  assert.equal(response.statusCode, 200, response.body);
  const homework = c.homeworkService.get(record.id);
  assert.equal(homework.task_state, 'failed');
  const summary = c.homeworkService.summary(c.child.id);
  assert.equal(summary.totals.failed, 1); assert.equal(summary.totals.completion_rate, 0);
  assert.throws(() => c.homeworkStudyService.complete(record.id, 'child'), /./);
  assert.throws(() => c.homeworkStudyService.start(record.id), /./);
  const week = getWeekRange(getTodayDate());
  const stats = c.statsService.getWeeklyCompletion(c.child.id, week.startDate, week.endDate);
  assert.ok(stats.items.some(item => item.title.includes('记事本') && item.total === 1 && item.completed === 0));
});

test('weekly failures consume no target, stay visible after target is met and survive template edits', async t => {
  const c = await fixture(t);
  const template = c.tasksService.createTemplate({ title: '每周阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [0,1,2,3,4,5,6] });
  const today = getTodayDate();
  const task = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  assert.equal((await c.confirm({}, undefined, task.id)).statusCode, 200);
  assert.equal(c.tasksService.weeklyCount(c.child.id, template.id, today), 0);
  c.tasksService.updateTemplate(template.id, { title: '新规则', points: 20, track_time: false });
  assert.equal(c.tasksService.getDailyTasks(c.child.id).find(row => row.id === task.id).title, '每周阅读');
  t.mock.timers.setTime(Date.now() + 86400000);
  const tomorrow = c.tasksService.getDailyTasks(c.child.id).find(row => row.template_id === template.id);
  c.tasksService.completeDailyTask(tomorrow.id);
  assert.ok(c.tasksService.getDailyTasks(c.child.id, today).find(row => row.id === task.id)?.is_failed);
  validateTaskFailures(c.db);
});

test('v46 upgrades, current restores and invalid failure backups preserve live state', async t => {
  const c = await fixture(t);
  await c.confirm({ penalty: 3 });
  const backup = await c.app.backupService.create('failure-test');
  const archive = fs.readFileSync(c.app.backupService.getPath(backup.name));
  const parsed = JSON.parse(gunzipSync(archive));
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  await c.app.backupService.restore(archive);
  assert.equal(c.current().is_failed, true);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), -3);
  const altered = mutate => {
    const candidate = new Database(Buffer.from(parsed.database, 'base64'));
    try { candidate.pragma('foreign_keys = OFF'); mutate(candidate); return gzipSync(JSON.stringify({ ...parsed, database: candidate.serialize().toString('base64') })); }
    finally { candidate.close(); }
  };
  for (const mutate of [db => db.exec('DROP TABLE task_failures'), db => db.exec('UPDATE daily_tasks SET failure_penalty = 0'), db => db.exec('DELETE FROM point_logs'), db => db.exec('UPDATE daily_tasks SET is_completed = 1')]) {
    await assert.rejects(c.app.backupService.restore(altered(mutate)), /未完成确认/);
    assert.equal(c.current().is_failed, true);
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), -3);
  }
  const legacy = altered(db => {
    db.exec("DELETE FROM task_failures; DELETE FROM point_logs; DROP TABLE task_failures;");
    for (const column of ['failure_id', 'failed_at', 'failure_reason', 'failure_penalty']) db.exec(`ALTER TABLE daily_tasks DROP COLUMN ${column}`);
    db.pragma('user_version = 46');
  });
  await c.app.backupService.restore(legacy);
  assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(c.current().is_failed, false);
  validateTaskFailures(c.db);
});

test('failed carried and optional weekly tasks become required and block all-done/rest-day', async t => {
  const c = await fixture(t);
  const monday = getTodayDate();
  const mondayRow = c.tasksService.getDailyTasks(c.child.id, monday).find(row => row.id === c.task.id);
  assert.equal(mondayRow.id, c.task.id);
  const weekly = c.tasksService.createTemplate({ title: '每周阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [0,1,2,3,4,5,6] });
  const weeklyRow = c.tasksService.getDailyTasks(c.child.id, monday).find(row => row.template_id === weekly.id);
  assert.equal(weeklyRow.is_optional, true);
  assert.equal((await c.confirm({}, undefined, weeklyRow.id)).statusCode, 200);
  await c.call('complete');
  const afterWeeklyFailure = c.tasksService.getDailyTasks(c.child.id, monday);
  assert.equal(afterWeeklyFailure.find(row => row.id === weeklyRow.id).is_optional, false);
  assert.equal(c.rewardsService.getChildStats(c.child.id).today_completion_rate, 0.5);
  assert.equal(c.rewardsService.getAllDoneDaysCount(c.child.id), 0);

  // Confirming a future-due carried task on Tuesday also marks it non-optional on Tuesday's board.
  const futureAdhoc = c.tasksService.createAdhocTask(c.child.id, { title: '跨天任务', subject: '数学', points: 5, due_date: shiftDate(monday, 3) });
  t.mock.timers.setTime(Date.now() + 86400000);
  const tuesday = getTodayDate();
  const tuesdaySibling = c.tasksService.createAdhocTask(c.child.id, { title: '周二常规', subject: '数学', points: 5 });
  c.tasksService.completeDailyTask(tuesdaySibling.id);
  assert.equal((await c.confirm({ request_id: 'failure-carried-001' }, undefined, futureAdhoc.id)).statusCode, 200);
  const tuesdayBoard = c.tasksService.getDailyTasks(c.child.id, tuesday);
  const carriedFailed = tuesdayBoard.find(row => row.id === futureAdhoc.id);
  assert.equal(carriedFailed.carried_from, monday);
  assert.equal(carriedFailed.is_optional, false);
  validateTaskFailures(c.db);
});

test('child cannot add or edit study sessions on a failed task while parent still retains edit access', async t => {
  const c = await fixture(t, { track_time: true });
  c.taskStudyService.manual(c.task.id, { request_id: 'failure-session-init', duration_seconds: 120, date: getTodayDate(), note: '初稿' }, 'child');
  assert.equal((await c.confirm()).statusCode, 200);
  const childAuth = { authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: c.child.id, epoch: c.app.sessionEpoch() })}` };
  const parentAuth = { authorization: `Bearer ${c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() })}` };
  const childEdit = await c.app.inject({ method: 'PUT', url: `/api/daily-tasks/${c.task.id}/sessions/failure-session-init`,
    payload: { duration_seconds: 180, note: '孩子试图修改' }, headers: childAuth });
  assert.equal(childEdit.statusCode, 409);
  const parentEdit = await c.app.inject({ method: 'PUT', url: `/api/daily-tasks/${c.task.id}/sessions/failure-session-init`,
    payload: { duration_seconds: 180, note: '家长核正' }, headers: parentAuth });
  assert.equal(parentEdit.statusCode, 200);
  assert.equal(c.taskStudyService.details(c.task.id).total_seconds, 180);
});

test('carried failures block history and all-done on their confirmation day, including after midnight', async t => {
  const c = await fixture(t, { due_date: '2026-11-26' });
  const monday = getTodayDate();
  const due = shiftDate(monday, 3);
  // The family day differs from UTC in the default time zone.
  t.mock.timers.setTime(new Date(familyInstant(shiftDate(monday, 1), '00:30:00')).getTime());
  const tuesday = getTodayDate();
  const sibling = c.tasksService.createAdhocTask(c.child.id, { title: '周二常规', subject: '数学', points: 5 });
  c.tasksService.completeDailyTask(sibling.id);
  assert.equal((await c.confirm({ penalty: 2 })).statusCode, 200);

  const checkTuesday = () => {
    const stats = c.rewardsService.getChildStats(c.child.id, tuesday);
    const history = c.statsService.getHistory(c.child.id, tuesday, tuesday)[0];
    assert.equal(stats.today_total_tasks, 2);
    assert.equal(stats.today_completed_tasks, 1);
    assert.equal(stats.today_completion_rate, 0.5);
    assert.equal(history.total_tasks, 2);
    assert.equal(history.completion_rate, 0.5);
    assert.equal(history.all_done, false);
    const failed = history.tasks.filter(task => task.id === c.task.id);
    assert.equal(failed.length, 1);
    assert.equal(failed[0].is_failed, true);
    assert.equal(failed[0].is_optional, false);
    assert.equal(failed[0].carried_from, monday);
    assert.equal(failed[0].due_date, due);
    assert.equal(c.rewardsService.getAllDoneDaysCount(c.child.id), 0);
    const week = c.statsService.getWeeklySummary(c.child.id, tuesday).current_week;
    assert.equal(week.daily_breakdown.find(day => day.date === tuesday).all_done, false);
    assert.equal(history.points_earned, 5, 'the penalty keeps its original task date');
  };
  checkTuesday();
  // A range covering the source day must count a carried failure once on its confirmation day, not on Monday too.
  const rangeHistory = c.statsService.getHistory(c.child.id, monday, tuesday);
  assert.equal(rangeHistory[0].total_tasks, 0);
  assert.equal(rangeHistory[1].total_tasks, 2);
  assert.equal(c.statsService.getWeeklySummary(c.child.id, tuesday).current_week.total_tasks, 2);
  assert.equal(c.tasksService.restDayChecker(c.child.id, monday, tuesday)(monday), true);
  t.mock.timers.setTime(Date.now() + 86400000);
  checkTuesday();
  assert.equal(c.statsService.getHistory(c.child.id, due, due)[0].tasks.some(task => task.id === c.task.id), false,
    'a failed carry is not projected again as a deadline miss');

  assert.equal((await c.call('restore-failure', { failure_id: 'failure-receipt-0001' })).statusCode, 200);
  const restored = c.statsService.getHistory(c.child.id, tuesday, tuesday)[0];
  assert.equal(restored.total_tasks, 1);
  assert.equal(restored.all_done, true);
  assert.equal(c.rewardsService.getChildStats(c.child.id, tuesday).today_completion_rate, 1);
  assert.equal(c.rewardsService.getAllDoneDaysCount(c.child.id), 1);
  validateTaskFailures(c.db);
});

test('same-day and overdue historical failures do not gain carried failure projections', async t => {
  const c = await fixture(t, { due_date: '2026-11-24' });
  const monday = getTodayDate();
  assert.equal((await c.confirm()).statusCode, 200);
  assert.equal(c.statsService.getHistory(c.child.id, monday, monday)[0].total_tasks, 1);
  assert.equal(c.tasksService.summaryTasksBetween(c.child.id, monday, shiftDate(monday, 1))
    .filter(task => task.id === c.task.id).length, 1);
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  t.mock.timers.setTime(Date.now() + 2 * 86400000);
  assert.equal((await c.confirm({ request_id: 'failure-after-deadline' })).statusCode, 200);
  const today = getTodayDate();
  assert.equal(c.tasksService.getDailyTasks(c.child.id).some(task => task.id === c.task.id), false);
  assert.equal(c.statsService.getHistory(c.child.id, today, today)[0].total_tasks, 0);
  assert.equal(c.tasksService.restDayChecker(c.child.id, today, today)(today), true);
  assert.equal(c.rewardsService.getChildStats(c.child.id).today_total_tasks, 0);
});

test('a carried failure alone prevents its confirmation day from being a rest day', async t => {
  const c = await fixture(t, { due_date: '2026-11-26' });
  const monday = getTodayDate();
  t.mock.timers.setTime(Date.now() + 86400000);
  const tuesday = getTodayDate();
  c.tasksService.getDailyTasks(c.child.id);
  assert.equal(c.tasksService.restDayChecker(c.child.id, tuesday, tuesday)(tuesday), true);
  assert.equal((await c.confirm()).statusCode, 200);
  assert.equal(c.tasksService.restDayChecker(c.child.id, tuesday, tuesday)(tuesday), false);
  assert.equal(c.statsService.getHistory(c.child.id, tuesday, tuesday)[0].total_tasks, 1);
  assert.equal(c.rewardsService.getChildStats(c.child.id).today_total_tasks, 1);
  const wednesday = shiftDate(tuesday, 1);
  assert.equal(c.tasksService.restDayChecker(c.child.id, wednesday, wednesday)(wednesday), true);
  assert.equal(c.statsService.getHistory(c.child.id, wednesday, wednesday)[0].total_tasks, 0);
  assert.deepEqual(c.statsService.getHistory(c.child.id, monday, tuesday).map(day => day.total_tasks), [0, 1]);
  assert.equal(c.tasksService.restDayChecker(c.child.id, monday, monday)(monday), true);

  t.mock.timers.setTime(Date.now() + 86400000);
  assert.equal(c.rewardsService.getChildStats(c.child.id, tuesday).today_total_tasks, 1);
  await c.call('restore-failure', { failure_id: 'failure-receipt-0001' });
  assert.equal(c.tasksService.restDayChecker(c.child.id, tuesday, tuesday)(tuesday), true);
  assert.equal(c.statsService.getHistory(c.child.id, tuesday, tuesday)[0].total_tasks, 0);
});
