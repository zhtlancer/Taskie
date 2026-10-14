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
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 5);
});
