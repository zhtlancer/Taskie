const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
  const child = await createChild('小明');
  const login = async who => {
    const res = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: who.id } })).json();
    return { authorization: `Bearer ${res.token}` };
  };
  const today = getTodayDate();
  const asParent = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const asChild = (headers, method, url, payload) => ctx.rawInject({ method, url, headers, payload });
  const createPeriod = async (payload, who = child) => asParent('POST', `/api/children/${who.id}/periods`, payload);
  const stats = async () => (await asParent('GET', `/api/children/${child.id}/stats`)).json();
  return { ctx, child, createChild, login, today, asParent, asChild, createPeriod, stats };
}

test('parents manage holiday periods per child; children can only read their own', async t => {
  const { child, createChild, login, today, asParent, asChild, createPeriod } = await fixture(t);
  const winter = await createPeriod({ name: ' 寒假 ', start_date: shiftDate(today, -3), end_date: shiftDate(today, 30) });
  assert.equal(winter.statusCode, 201);
  assert.deepEqual([winter.json().name, winter.json().status, winter.json().days_total], ['寒假', 'active', 34]);

  for (const [payload, status] of [
    [{ name: '', start_date: today, end_date: today }, 400],
    [{ name: '国庆', start_date: '2026-13-01', end_date: today }, 400],
    [{ name: '国庆', start_date: today, end_date: shiftDate(today, -1) }, 400],
    [{ name: '国庆', start_date: shiftDate(today, 30), end_date: shiftDate(today, 40) }, 409],
    [{ name: '国庆', start_date: shiftDate(today, 60), end_date: shiftDate(today, 61), paused_template_ids: ['missing'] }, 400]
  ]) {
    assert.equal((await createPeriod(payload)).statusCode, status, JSON.stringify(payload));
  }
  // Another child may use the same dates.
  const sister = await createChild('小红');
  assert.equal((await createPeriod({ name: '寒假', start_date: today, end_date: today }, sister)).statusCode, 201);

  const headers = await login(child);
  assert.deepEqual((await asChild(headers, 'GET', `/api/children/${child.id}/periods`)).json().map(p => p.name), ['寒假']);
  assert.equal((await asChild(headers, 'GET', `/api/children/${sister.id}/periods`)).statusCode, 403);
  for (const [method, url] of [['POST', `/api/children/${child.id}/periods`], ['PUT', `/api/periods/${winter.json().id}`],
    ['DELETE', `/api/periods/${winter.json().id}`], ['POST', `/api/periods/${winter.json().id}/tasks`]]) {
    assert.equal((await asChild(headers, method, url, { name: '偷偷改', start_date: today, end_date: today })).statusCode, 403, `${method} ${url}`);
  }

  const renamed = await asParent('PUT', `/api/periods/${winter.json().id}`, { name: '寒假（延长）', end_date: shiftDate(today, 35) });
  assert.deepEqual([renamed.json().name, renamed.json().end_date], ['寒假（延长）', shiftDate(today, 35)]);
  assert.equal((await asParent('DELETE', `/api/periods/${winter.json().id}`)).statusCode, 200);
});

test('paused templates stop during the period, drop today’s pending task and cannot be checked off', async t => {
  const { ctx, child, login, today, asParent, asChild, createPeriod } = await fixture(t);
  const { tasksService } = ctx.app.services;
  const school = tasksService.createTemplate({ title: '校内作业', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  tasksService.createTemplate({ title: '跳绳', subject: '其他', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const headers = await login(child);
  const titles = async date => (await asParent('GET', `/api/daily-tasks?child_id=${child.id}${date ? `&date=${date}` : ''}`)).json().map(task => task.title).sort();

  const pending = (await asChild(headers, 'GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(task => task.title === '校内作业');
  assert.deepEqual(await titles(), ['校内作业', '跳绳']);

  const holiday = (await createPeriod({ name: '寒假', start_date: today, end_date: shiftDate(today, 10), paused_template_ids: [school.id] })).json();
  assert.deepEqual(holiday.paused_template_ids, [school.id]);
  assert.deepEqual(await titles(), ['跳绳']);
  assert.deepEqual(await titles(shiftDate(today, 5)), ['跳绳']);
  assert.deepEqual(await titles(shiftDate(today, 11)), ['校内作业', '跳绳']);
  // The pending task was removed; a stale client gets a clear error.
  assert.equal((await asChild(headers, 'POST', `/api/daily-tasks/${pending.id}/complete`)).statusCode, 404);

  // Unpausing brings it back today.
  await asParent('PUT', `/api/periods/${holiday.id}`, { paused_template_ids: [] });
  const restored = (await asChild(headers, 'GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(task => task.title === '校内作业');
  assert.ok(restored);

  // A completed task survives pausing, but a pending one generated before cannot be checked off once paused.
  ctx.db.prepare("UPDATE periods SET start_date = ?").run(shiftDate(today, -2));
  const past = tasksService.getDailyTasks(child.id, shiftDate(today, -1)).find(task => task.title === '校内作业');
  ctx.db.prepare('INSERT INTO period_paused_templates (period_id, template_id) VALUES (?, ?)').run(holiday.id, school.id);
  assert.equal((await asParent('POST', `/api/daily-tasks/${past.id}/complete`)).statusCode, 409);
});

test('paused days are rest days for the streak and are not owed in weekly completion', async t => {
  const { ctx, child, createPeriod } = await fixture(t);
  const { tasksService, rewardsService, statsService } = ctx.app.services;
  const school = tasksService.createTemplate({ title: '校内作业', subject: '数学', days_of_week: [1, 2, 3, 4, 5] });
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  ctx.db.prepare('UPDATE children SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  for (const n of [0, 1]) tasksService.completeDailyTask(tasksService.getDailyTasks(child.id, day(n))[0].id);
  await createPeriod({ name: '小长假', start_date: day(2), end_date: day(4), paused_template_ids: [school.id] });

  // Wednesday to Friday paused, weekend unscheduled: the streak carries over to next Monday.
  tasksService.completeDailyTask(tasksService.getDailyTasks(child.id, day(7))[0].id);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 3);
  const completion = statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6));
  assert.deepEqual(completion.items.map(i => [i.title, i.completed, i.total]), [['校内作业', 2, 2]]);
});

test('already generated paused tasks stop counting in history, weekly completion and streak without erasing completions', async t => {
  const { ctx, child, createPeriod, asParent } = await fixture(t);
  const { tasksService: tasks, statsService: stats, rewardsService: rewards } = ctx.app.services;
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  const fixed = tasks.createTemplate({ title: '校内任务', subject: '数学' });
  const weekly = tasks.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 3 });
  ctx.db.prepare('UPDATE children SET created_at = ?').run(`${day(-30)}T04:00:00Z`);
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(`${day(-30)}T04:00:00Z`);
  const rows = [0, 1, 2, 3].flatMap(n => tasks.getDailyTasks(child.id, day(n)));
  tasks.completeDailyTask(rows.find(row => row.date === day(1) && row.template_id === fixed.id).id);
  const completedWeekly = rows.find(row => row.date === day(3) && row.template_id === weekly.id);
  tasks.completeDailyTask(completedWeekly.id);
  const holiday = (await createPeriod({ name: '补设假期', start_date: day(0), end_date: day(6), paused_template_ids: [fixed.id, weekly.id] })).json();
  const points = rewards.getTotalPoints(child.id);
  const hidden = stats.getHistory(child.id, day(0), day(0))[0];
  assert.deepEqual([hidden.total_tasks, hidden.completed_tasks, hidden.tasks.length], [0, 0, 0]);
  assert.equal(tasks.restDayChecker(child.id, day(0), day(6))(day(0)), true);
  assert.deepEqual([stats.getWeeklySummary(child.id, day(0)).current_week.completion.total_units,
    stats.getWeeklySummary(child.id, day(0)).current_week.completion.completed_units], [2, 2]);
  assert.equal(tasks.getDailyTasks(child.id, day(2)).length, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM daily_tasks').get().n, rows.length);
  assert.equal(rewards.getTotalPoints(child.id), points);
  assert.equal(tasks.uncompleteDailyTask(completedWeekly.id).task.is_completed, false);
  assert.equal(stats.getWeeklySummary(child.id, day(0)).current_week.completion.total_units, 1);
  assert.equal((await asParent('POST', `/api/daily-tasks/${completedWeekly.id}/complete`)).statusCode, 409);
  await asParent('PUT', `/api/periods/${holiday.id}`, { paused_template_ids: [] });
  assert.equal(tasks.getDailyTasks(child.id, day(0)).some(row => row.template_id === fixed.id), true);
});

test('deleting holiday tasks or periods keeps dated point history and original titles, including backfills', async t => {
  const { ctx, child, today, createPeriod, asParent, stats } = await fixture(t);
  const yesterday = shiftDate(today, -1);
  const period = (await createPeriod({ name: '假期', start_date: yesterday, end_date: today })).json();
  const progress = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '阅读', subject: '语文', mode: 'progress', total_amount: 10, unit: '页', points: 2 })).json();
  const check = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '读书', subject: '语文', points: 10 })).json();
  await asParent('POST', `/api/period-tasks/${progress.id}/logs`, { amount: 3, date: yesterday });
  const current = (await asParent('POST', `/api/period-tasks/${progress.id}/logs`, { amount: 2 })).json();
  await asParent('POST', `/api/period-tasks/${check.id}/logs`, {});
  // Correcting an entry still removes its points and snapshot.
  await asParent('DELETE', `/api/period-task-logs/${current.log_id}`);
  await asParent('PUT', `/api/period-tasks/${progress.id}`, { title: '改名', unit: '篇' });
  const historyBefore = ctx.app.services.statsService.getHistory(child.id, yesterday, today).map(day => day.points_earned);
  assert.deepEqual(historyBefore, [6, 10]);
  await asParent('DELETE', `/api/period-tasks/${progress.id}`);
  await asParent('DELETE', `/api/periods/${period.id}`);
  assert.deepEqual([(await stats()).total_points, (await stats()).today_points], [16, 10]);
  assert.deepEqual(ctx.app.services.statsService.getHistory(child.id, yesterday, today).map(day => day.points_earned), historyBefore);
  const summary = ctx.app.services.statsService.getWeeklySummary(child.id);
  assert.equal(summary.current_week.daily_breakdown.find(day => day.date === today).points, 10);
  const totalAcrossWeeks = summary.current_week.total_points + summary.last_week.total_points;
  assert.equal(totalAcrossWeeks, 16);
  const ledger = (await asParent('GET', `/api/children/${child.id}/point-logs`)).json();
  assert.deepEqual(ledger.map(row => row.title).sort(), ['读书', '阅读 3页']);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM point_logs WHERE period_log_id IS NULL AND activity_date IS NOT NULL').get().n, 2);
});

test('check-off and progress holiday tasks earn points, pace the rest and protect spent points', async t => {
  const { ctx, child, createChild, login, today, asParent, asChild, createPeriod, stats } = await fixture(t);
  const period = (await createPeriod({ name: '寒假', start_date: shiftDate(today, -5), end_date: shiftDate(today, 4) })).json();
  const addTask = payload => asParent('POST', `/api/periods/${period.id}/tasks`, { subject: '语文', ...payload });

  for (const payload of [{ title: '' }, { title: '作业', mode: 'other' }, { title: '作业', mode: 'progress', total_amount: 0, unit: '页' },
    { title: '作业', mode: 'progress', total_amount: 10 }, { title: '作业', points: -1 }]) {
    assert.equal((await addTask(payload)).statusCode, 400, JSON.stringify(payload));
  }
  const homework = (await addTask({ title: '寒假作业', mode: 'progress', total_amount: 40, unit: '页', points: 2 })).json();
  const book = (await addTask({ title: '读完一本书', mode: 'check', total_amount: 99, unit: '本', points: 30 })).json();
  assert.deepEqual([book.total_amount, book.unit], [1, null]);
  // 40 pages over the 5 days left (today included): 8 a day.
  assert.deepEqual([homework.days_left, homework.suggested_today, homework.remaining_amount], [5, 8, 40]);

  const headers = await login(child);
  const log = (id, payload, h = headers) => asChild(h, 'POST', `/api/period-tasks/${id}/logs`, payload);
  const first = await log(homework.id, { amount: 3 });
  assert.equal(first.statusCode, 201);
  assert.deepEqual([first.json().points_earned, first.json().task.done_amount, first.json().task.today_amount, first.json().task.suggested_today], [6, 3, 3, 5]);
  assert.equal((await log(homework.id, { amount: 38 })).statusCode, 400);
  assert.equal((await log(homework.id, { amount: 0 })).statusCode, 400);
  assert.equal((await log(homework.id, { amount: 2, date: shiftDate(today, -1) })).statusCode, 403);
  assert.equal((await asParent('POST', `/api/period-tasks/${homework.id}/logs`, { amount: 5, date: shiftDate(today, -1) })).statusCode, 201);
  assert.equal((await asParent('POST', `/api/period-tasks/${homework.id}/logs`, { amount: 1, date: shiftDate(today, -6) })).statusCode, 400);
  assert.equal((await asParent('POST', `/api/period-tasks/${homework.id}/logs`, { amount: 1, date: shiftDate(today, 1) })).statusCode, 400);

  assert.equal((await log(book.id, {})).json().points_earned, 30);
  assert.equal((await log(book.id, {})).statusCode, 409);
  // 3 + 5 pages at 2 points, plus 30 for the book; today's share excludes the backfilled 5 pages.
  assert.deepEqual([(await stats()).total_points, (await stats()).today_points], [46, 36]);
  const titles = (await asParent('GET', `/api/children/${child.id}/point-logs`)).json().map(l => l.title).sort();
  assert.deepEqual(titles, ['寒假作业 3页', '寒假作业 5页', '读完一本书']);

  // Another child cannot touch these tasks.
  const sisterHeaders = await login(await createChild('小红'));
  assert.equal((await log(homework.id, { amount: 1 }, sisterHeaders)).statusCode, 403);
  assert.equal((await asChild(sisterHeaders, 'DELETE', `/api/period-task-logs/${first.json().log_id}`)).statusCode, 403);

  // Undo: children may undo today's entries until the points are spent; parents can always correct.
  const parentLog = (await asParent('GET', `/api/children/${child.id}/periods`)).json()[0].tasks[0].logs.find(l => l.date !== today);
  assert.equal((await asChild(headers, 'DELETE', `/api/period-task-logs/${parentLog.id}`)).statusCode, 403);
  const reward = (await asParent('POST', '/api/reward-items', { title: '看动画', cost: 45 })).json();
  // 45 of 46 points are now held, leaving too few to take back today's 6.
  assert.equal((await asChild(headers, 'POST', `/api/children/${child.id}/redemptions`, { reward_id: reward.id })).statusCode, 201);
  assert.equal((await asChild(headers, 'DELETE', `/api/period-task-logs/${first.json().log_id}`)).statusCode, 409);
  const undone = await asParent('DELETE', `/api/period-task-logs/${first.json().log_id}`);
  assert.equal(undone.json().task.done_amount, 5);
  assert.equal((await stats()).total_points, 40);

  // Deleting the period keeps the points the child earned.
  await asParent('DELETE', `/api/periods/${period.id}`);
  assert.equal((await stats()).total_points, 40);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM period_task_logs').get().n, 0);
});

test('logging holiday progress keeps the streak going on days without daily tasks', async t => {
  const { ctx, child, today, createPeriod, asParent } = await fixture(t);
  const period = (await createPeriod({ name: '寒假', start_date: shiftDate(today, -3), end_date: today })).json();
  const task = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '寒假作业', subject: '语文', mode: 'progress', total_amount: 10, unit: '页' })).json();
  for (const n of [-2, -1, 0]) await asParent('POST', `/api/period-tasks/${task.id}/logs`, { amount: 1, date: shiftDate(today, n) });
  assert.equal(ctx.app.services.rewardsService.getCurrentStreak(child.id, today), 3);
});

test('backups keep periods and progress, restore older backups and reject incomplete v5 ones', async t => {
  const { ctx, child, today, createPeriod, asParent } = await fixture(t);
  const period = (await createPeriod({ name: '寒假', start_date: today, end_date: shiftDate(today, 5) })).json();
  const task = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '寒假作业', subject: '语文', mode: 'progress', total_amount: 10, unit: '页', points: 1 })).json();
  await asParent('POST', `/api/period-tasks/${task.id}/logs`, { amount: 4 });
  const archive = require('node:fs').readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const restore = buffer => ctx.app.backupService.restore(buffer);

  await asParent('DELETE', `/api/periods/${period.id}`);
  restore(archive);
  const restored = ctx.app.services.periodsService.listPeriods(child.id);
  assert.deepEqual([restored[0].name, restored[0].tasks[0].done_amount], ['寒假', 4]);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM point_logs WHERE period_log_id IS NOT NULL').get().n, 1);

  const Database = require('better-sqlite3');
  const rewrite = (sql, version) => {
    const data = JSON.parse(gunzipSync(archive));
    const db = new Database(Buffer.from(data.database, 'base64'));
    db.exec(sql);
    db.pragma(`user_version = ${version}`);
    data.database = db.serialize().toString('base64');
    db.close();
    return gzipSync(JSON.stringify(data));
  };
  const withoutPeriods = 'DROP TABLE period_task_logs; DROP TABLE period_tasks; DROP TABLE period_paused_templates; DROP TABLE periods; ALTER TABLE point_logs DROP COLUMN period_log_id';
  assert.throws(() => restore(rewrite(withoutPeriods, 5)), /备份缺少假期数据/);
  restore(rewrite(withoutPeriods, 4));
  assert.deepEqual(ctx.app.services.periodsService.listPeriods(child.id), []);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 28);
});

test('v5 point histories migrate to durable snapshots; incomplete v6 backups fail before altering live data', async t => {
  const { ctx, child, today, createPeriod, asParent } = await fixture(t);
  const yesterday = shiftDate(today, -1);
  const period = (await createPeriod({ name: '旧假期', start_date: yesterday, end_date: today })).json();
  const task = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '旧阅读', subject: '语文', mode: 'progress', total_amount: 10, unit: '页', points: 2 })).json();
  await asParent('POST', `/api/period-tasks/${task.id}/logs`, { amount: 3, date: yesterday });
  const removed = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '已删任务', subject: '数学', points: 4 })).json();
  await asParent('POST', `/api/period-tasks/${removed.id}/logs`, {});
  await asParent('DELETE', `/api/period-tasks/${removed.id}`);
  const archive = require('node:fs').readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const data = JSON.parse(gunzipSync(archive));
  const Database = require('better-sqlite3');
  const old = new Database(Buffer.from(data.database, 'base64'));
  old.exec('ALTER TABLE point_logs DROP COLUMN activity_date; ALTER TABLE point_logs DROP COLUMN activity_title');
  data.database = old.serialize().toString('base64');
  const epoch = ctx.app.sessionEpoch(), backups = ctx.app.backupService.list();
  assert.throws(() => ctx.app.backupService.restore(gzipSync(JSON.stringify(data))), /备份缺少积分历史快照/);
  assert.equal(ctx.app.sessionEpoch(), epoch);
  assert.deepEqual(ctx.app.backupService.list(), backups);
  old.pragma('user_version = 5');
  data.database = old.serialize().toString('base64');
  old.close();
  ctx.app.backupService.restore(gzipSync(JSON.stringify(data)));
  const { initDb } = require('../src/db');
  initDb(ctx.db); // Repeating initialization must preserve the migrated snapshots.
  const entries = ctx.db.prepare('SELECT activity_date, activity_title FROM point_logs ORDER BY points DESC').all();
  assert.deepEqual(entries, [
    { activity_date: yesterday, activity_title: '旧阅读 3页' },
    { activity_date: today, activity_title: '历史积分记录（来源已删除）' }
  ]);
  await asParent('DELETE', `/api/periods/${period.id}`);
  assert.deepEqual(ctx.app.services.statsService.getHistory(child.id, yesterday, today).map(day => day.points_earned), [6, 4]);
  // Current backups keep those snapshots even after all sources have been deleted.
  const restoredArchive = require('node:fs').readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  ctx.db.exec('DELETE FROM point_logs');
  ctx.app.backupService.restore(restoredArchive);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 10);
  assert.deepEqual(ctx.app.services.statsService.getHistory(child.id, yesterday, today).map(day => day.points_earned), [6, 4]);
});

test('retrying a progress entry with the same request id records it and its points once', async t => {
  const { child, login, today, asParent, asChild, createPeriod, stats } = await fixture(t);
  const period = (await createPeriod({ name: '寒假', start_date: today, end_date: shiftDate(today, 30) })).json();
  const book = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '阅读', subject: '语文', mode: 'progress', total_amount: 10, unit: '页', points: 2, completion_bonus: 5 })).json();
  const headers = await login(child);
  const log = payload => asChild(headers, 'POST', `/api/period-tasks/${book.id}/logs`, payload);

  const first = await log({ amount: 5, request_id: 'progress-request-1' });
  const retry = await log({ amount: 5, request_id: 'progress-request-1' });
  assert.deepEqual([first.statusCode, retry.statusCode], [201, 201]);
  assert.equal(retry.json().log_id, first.json().log_id);
  assert.equal(retry.json().points_earned, 10);
  assert.equal(retry.json().task.done_amount, 5);
  assert.equal((await stats()).total_points, 10);

  assert.equal((await log({ amount: 4, request_id: 'progress-request-1' })).statusCode, 409, 'same id with other content');
  assert.equal((await log({ amount: 5, request_id: 'bad id' })).statusCode, 400);
  // The finishing entry still replays after the task is complete, with its bonus.
  const finish = await log({ amount: 5, request_id: 'progress-request-2' });
  const finishRetry = await log({ amount: 5, request_id: 'progress-request-2' });
  assert.equal(finishRetry.statusCode, 201, finishRetry.body);
  assert.deepEqual([finishRetry.json().points_earned, finishRetry.json().completion_bonus], [finish.json().points_earned, 5]);
  assert.equal((await stats()).total_points, 25);
  // An id cannot be replayed against another child's task.
  const other = (await asParent('POST', `/api/periods/${period.id}/tasks`, { title: '口算', subject: '数学', mode: 'progress', total_amount: 10, unit: '页', points: 1 })).json();
  assert.equal((await asParent('POST', `/api/period-tasks/${other.id}/logs`, { amount: 5, request_id: 'progress-request-1' })).statusCode, 409);
});
