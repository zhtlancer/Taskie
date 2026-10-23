const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
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
  ctx.db.prepare('UPDATE children SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
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
