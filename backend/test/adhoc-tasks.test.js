const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '小明' } })).json();
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  const childHeaders = { authorization: `Bearer ${login.token}` };
  const addAdhoc = payload => ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/adhoc-tasks`, payload: { subject: '语文', ...payload } });
  return { ctx, child, childHeaders, addAdhoc, today: getTodayDate() };
}

test('a one-off task is a required task for its day, checked off like any other', async t => {
  const { ctx, child, childHeaders, addAdhoc, today } = await fixture(t);
  await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] } });
  const created = await addAdhoc({ title: ' 手抄报 ', points: 15 });
  assert.equal(created.statusCode, 201);
  assert.deepEqual([created.json().title, created.json().date, created.json().origin, created.json().is_optional], ['手抄报', today, 'adhoc', false]);

  const tasks = (await ctx.rawInject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}`, headers: childHeaders })).json();
  assert.deepEqual(tasks.map(task => [task.title, task.origin]), [['手抄报', 'adhoc'], ['口算', 'template']]);
  const complete = title => ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${tasks.find(task => task.title === title).id}/complete`, headers: childHeaders });

  // Only the template task done: the day is not all done yet.
  assert.equal((await complete('口算')).json().new_badges.some(b => b.key === 'all_done_once'), false);
  const done = (await complete('手抄报')).json();
  assert.equal(done.points_earned, 15);
  assert.ok(done.new_badges.some(b => b.key === 'all_done_once'));
  const stats = (await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/stats` })).json();
  assert.deepEqual([stats.today_total_tasks, stats.today_completed_tasks, stats.today_points], [2, 2, 25]);
  // Regenerating today's tasks never duplicates or drops it.
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}` })).json().length, 2);
});

test('parents list and delete one-off tasks; children cannot manage them; input is validated', async t => {
  const { ctx, child, childHeaders, addAdhoc, today } = await fixture(t);
  for (const payload of [{ title: '' }, { title: '作业', subject: '' }, { title: '作业', points: -1 }, { title: '作业', date: '2026-02-30' }]) {
    assert.equal((await addAdhoc(payload)).statusCode, 400, JSON.stringify(payload));
  }
  const later = (await addAdhoc({ title: '周五交手抄报', date: shiftDate(today, 2) })).json();
  const now = (await addAdhoc({ title: '订正练习', points: 5 })).json();
  await addAdhoc({ title: '昨天补记', date: shiftDate(today, -1) });
  assert.deepEqual((await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/adhoc-tasks` })).json().map(task => task.title), ['订正练习', '周五交手抄报']);

  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/children/${child.id}/adhoc-tasks`, headers: childHeaders, payload: { title: '偷加', subject: '语文' } })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'DELETE', url: `/api/adhoc-tasks/${now.id}`, headers: childHeaders })).statusCode, 403);
  // A child still cannot check off a future one-off task.
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${later.id}/complete`, headers: childHeaders })).statusCode, 403);

  // Deleting a completed one-off task takes back its points; template tasks cannot be deleted this way.
  await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${now.id}/complete`, headers: childHeaders });
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/adhoc-tasks/${now.id}` })).statusCode, 200);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 0);
  await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '口算', subject: '数学' } });
  const templateTask = ctx.app.services.tasksService.getDailyTasks(child.id).find(task => task.title === '口算');
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/adhoc-tasks/${templateTask.id}` })).statusCode, 404);
});

test('one-off tasks count in weekly completion without hiding the templates of an unopened day', async t => {
  const { ctx, child, addAdhoc } = await fixture(t);
  const { tasksService, statsService } = ctx.app.services;
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [1, 2, 3, 4, 5] });
  ctx.db.prepare('UPDATE children SET created_at = ?').run(familyInstant(day(-30)));
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(familyInstant(day(-30)));
  // Added for Wednesday, a day the app was never opened.
  const adhoc = (await addAdhoc({ title: '手抄报', date: day(2) })).json();
  tasksService.completeDailyTask(adhoc.id);

  const completion = statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6));
  assert.deepEqual(Object.fromEntries(completion.items.map(i => [i.title, [i.completed, i.total]])), { 口算: [0, 5], 手抄报: [1, 1] });
  // The parent's one-off task makes Wednesday a working day for the streak.
  assert.equal(ctx.app.services.rewardsService.getCurrentStreak(child.id, day(2)), 1);
});

test('holiday pauses never remove one-off tasks', async t => {
  const { ctx, child, addAdhoc, today } = await fixture(t);
  const school = ctx.app.services.tasksService.createTemplate({ title: '校内作业', subject: '数学' });
  await addAdhoc({ title: '假期手抄报' });
  await ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/periods`, payload: { name: '寒假', start_date: today, end_date: today, paused_template_ids: [school.id] } });
  assert.deepEqual(ctx.app.services.tasksService.getDailyTasks(child.id).map(task => task.title), ['假期手抄报']);
});

test('backups keep one-off tasks; v6 backups restore and incomplete v7 ones are rejected', async t => {
  const { ctx, child, addAdhoc } = await fixture(t);
  await addAdhoc({ title: '手抄报' });
  const archive = fs.readFileSync(ctx.app.backupService.getPath((await ctx.app.backupService.create()).name));
  ctx.db.prepare('DELETE FROM daily_tasks').run();
  await ctx.app.backupService.restore(archive);
  assert.deepEqual(ctx.app.services.tasksService.listAdhocTasks(child.id).map(task => task.title), ['手抄报']);

  const Database = require('better-sqlite3');
  const rewrite = version => {
    const data = JSON.parse(gunzipSync(archive));
    const db = new Database(Buffer.from(data.database, 'base64'));
    db.exec('ALTER TABLE daily_tasks DROP COLUMN origin');
    db.pragma(`user_version = ${version}`);
    data.database = db.serialize().toString('base64');
    db.close();
    return gzipSync(JSON.stringify(data));
  };
  await assert.rejects(() => ctx.app.backupService.restore(rewrite(7)), /备份缺少临时任务数据/);
  await ctx.app.backupService.restore(rewrite(6));
  // Older backups had no one-off tasks: their rows come back as template tasks.
  assert.deepEqual(ctx.db.prepare('SELECT origin FROM daily_tasks').all().map(r => r.origin), ['template']);
});

test('editing a one-off preserves identity, learning sessions and rewards while changing pending details', async t => {
  const { ctx, child, addAdhoc, today } = await fixture(t);
  const created = (await addAdhoc({ title: '手抄报', track_time: true, expected_minutes: 20, due_date: shiftDate(today, 2) })).json();
  const study = ctx.app.services.taskStudyService;
  const session = study.start(created.id);
  const beforeSessions = ctx.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(created.id);
  const task = (await ctx.app.inject({ method: 'GET', url: `/api/adhoc-tasks/${created.id}` })).json();
  const update = await ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${created.id}`, payload: {
    title: ' 更新手抄报 ', subject: '英语', points: 25, due_date: shiftDate(today, 3), expected_minutes: 30, expected_version: task.edit_version
  } });
  assert.equal(update.statusCode, 200, update.body);
  assert.deepEqual([update.json().id, update.json().title, update.json().subject, update.json().points, update.json().date], [created.id, '更新手抄报', '英语', 25, today]);
  assert.deepEqual(ctx.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(created.id), beforeSessions);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 0);
  const latest = update.json();
  assert.equal(latest.due_date, shiftDate(today, 3));
  const stale = await ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${created.id}`, payload: { title: '旧设备覆盖', expected_version: task.edit_version } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().code, 'EDIT_CONFLICT');
  const timing = await ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${created.id}`, payload: { track_time: false, expected_version: latest.edit_version } });
  assert.equal(timing.statusCode, 409);
  assert.equal(timing.json().code, undefined);
  assert.ok(session);
});

test('one-off editing enforces parent-only access, input bounds and immutable dates', async t => {
  const { ctx, childHeaders, addAdhoc, today } = await fixture(t);
  const task = (await addAdhoc({ title: '原任务' })).json();
  const current = (await ctx.app.inject({ method: 'GET', url: `/api/adhoc-tasks/${task.id}` })).json();
  const edit = payload => ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${task.id}`, payload: { expected_version: current.edit_version, ...payload } });
  for (const payload of [{ title: '' }, { subject: null }, { title: '字'.repeat(51) }, { points: -1 }, { points: 1.5 }, { date: shiftDate(today, 1) }, { child_id: 'other' }, { duration_seconds: 60 }, { due_date: '2026-02-30' }, { due_date: shiftDate(today, -1) }, { due_date: shiftDate(today, 400) }, { track_time: 1 }, { expected_minutes: 601 }, { priority: 3 }]) {
    assert.equal((await edit(payload)).statusCode, 400, JSON.stringify(payload));
  }
  assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${task.id}`, payload: { title: '没有版本' } })).statusCode, 400);
  for (const method of ['GET', 'PUT']) assert.equal((await ctx.rawInject({ method, url: `/api/adhoc-tasks/${task.id}`, headers: childHeaders, ...(method === 'PUT' ? { payload: { expected_version: current.edit_version, title: '越权' } } : {}) })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/adhoc-tasks/missing', payload: {} })).statusCode, 404);
  assert.equal(ctx.app.services.tasksService.getAdhocTask(task.id).title, '原任务');
});

test('settled, expired, skipped and course-owned tasks cannot be edited as one-offs', async t => {
  const { ctx, child, addAdhoc, today } = await fixture(t);
  const tasks = [];
  const done = (await addAdhoc({ title: '已完成', points: 11 })).json();
  ctx.app.services.tasksService.completeDailyTask(done.id); tasks.push(done);
  const skipped = (await addAdhoc({ title: '已跳过' })).json();
  ctx.db.prepare('UPDATE daily_tasks SET skipped_at = ? WHERE id = ?').run(new Date().toISOString(), skipped.id); tasks.push(skipped);
  tasks.push((await addAdhoc({ title: '已过期', date: shiftDate(today, -1) })).json());
  const homework = ctx.app.services.homeworkService.create(child.id, { subject: '数学', content: '课程作业', due_date: shiftDate(today, 2), create_task: true }, 'parent');
  tasks.push({ id: homework.task.id });
  for (const task of tasks) {
    const before = ctx.app.services.tasksService.getAdhocTask(task.id);
    assert.equal(before.can_edit, false);
    assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${task.id}`, payload: { title: '覆盖历史', expected_version: before.edit_version } })).statusCode, 409);
  }
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 11);
});

test('carried one-off edits keep legacy time and valid deadlines; disabling timing retains completed sessions', async t => {
  const { ctx, addAdhoc, today } = await fixture(t);
  const task = (await addAdhoc({ title: '多日任务', date: shiftDate(today, -1), due_date: shiftDate(today, 1), track_time: true })).json();
  ctx.db.prepare('UPDATE daily_tasks SET duration_seconds = 180, duration_source = ? WHERE id = ?').run('manual', task.id);
  ctx.app.services.taskStudyService.manual(task.id, { request_id: 'retained_manual_session', duration_seconds: 120 }, 'parent');
  const sessions = ctx.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(task.id);
  const days = ctx.db.prepare('SELECT * FROM homework_session_days WHERE session_id = ?').all('retained_manual_session');
  const current = ctx.app.services.tasksService.getAdhocTask(task.id);
  const edit = payload => ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${task.id}`, payload: { expected_version: current.edit_version, ...payload } });
  assert.equal((await edit({ due_date: null })).statusCode, 400);
  const updated = await edit({ title: '延后交', due_date: shiftDate(today, 3), track_time: false });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.equal(updated.json().homework_legacy_seconds, 180);
  assert.equal(updated.json().track_time, false);
  assert.equal(updated.json().date, shiftDate(today, -1));
  assert.deepEqual(ctx.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(task.id), sessions);
  assert.deepEqual(ctx.db.prepare('SELECT * FROM homework_session_days WHERE session_id = ?').all('retained_manual_session'), days);
});

test('record editors reject a stale data generation before changing either kind of record', async t => {
  const { ctx, child, addAdhoc } = await fixture(t);
  const task = (await addAdhoc({ title: '恢复保护' })).json();
  const before = ctx.app.services.tasksService.getAdhocTask(task.id);
  const mistake = ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: '恢复前内容' });
  for (const [url, payload] of [
    [`/api/adhoc-tasks/${task.id}`, { title: '旧窗口覆盖', expected_version: before.edit_version }],
    [`/api/mistakes/${mistake.id}`, { description: '旧窗口覆盖', expected_version: mistake.edit_version }]
  ]) {
    const response = await ctx.app.inject({ method: 'PUT', url, headers: { 'x-taskie-data-generation': 'old-restored-data' }, payload });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'DATA_RESTORED');
  }
  assert.equal(ctx.app.services.tasksService.getAdhocTask(task.id).title, '恢复保护');
  assert.equal(ctx.app.services.mistakesService.getMistake(mistake.id).description, '恢复前内容');
});

test('editing unrelated fields keeps a one-off priority default and occurrence override; explicit changes update priority', async t => {
  const { ctx, addAdhoc } = await fixture(t);
  const task = (await addAdhoc({ title: '优先级来源', priority: 1 })).json();
  const tasks = ctx.app.services.tasksService;
  const priority = () => { const row = tasks.getAdhocTask(task.id); return [row.priority, row.default_priority, row.priority_override]; };
  const edit = payload => ctx.app.inject({ method: 'PUT', url: `/api/adhoc-tasks/${task.id}`, payload: { expected_version: tasks.getAdhocTask(task.id).edit_version, ...payload } });
  tasks.setDailyPriority(task.id, 2);
  assert.equal((await edit({ title: '仅改标题' })).statusCode, 200);
  assert.deepEqual(priority(), [2, 1, 2]);
  assert.equal((await edit({ title: '完整表单保留高优先', priority: 2 })).statusCode, 200);
  assert.deepEqual(priority(), [2, 1, 2]);
  tasks.setDailyPriority(task.id, null);
  assert.deepEqual(priority(), [1, 1, null]);
  tasks.setDailyPriority(task.id, 2);
  assert.equal((await edit({ priority: 0 })).statusCode, 200);
  assert.deepEqual(priority(), [0, 0, null]);
  tasks.setDailyPriority(task.id, 2);
  tasks.setDailyPriority(task.id, null);
  assert.deepEqual(priority(), [0, 0, null]);
});
