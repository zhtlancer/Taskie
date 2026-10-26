const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { SCHEMA_VERSION, initDb } = require('../src/db');
const { getTodayDate, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-26')) });
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); ctx.db.close(); });
  await ctx.app.ready();
  const services = ctx.app.services;
  const child = services.childrenService.createChild({ name: '优先级' });
  const today = getTodayDate();
  const template = data => services.tasksService.createTemplate({ title: '日常任务', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], ...data });
  const adhoc = data => services.tasksService.createAdhocTask(child.id, { title: '临时任务', subject: '数学', ...data });
  const row = id => ctx.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(id);
  return { ...ctx, ...services, child, today, template, adhoc, row };
}

test('all task sources default to normal, and reject malformed priorities', async t => {
  const c = await fixture(t);
  assert.equal(c.template().priority, 1);
  assert.equal(c.adhoc().priority, 1);
  assert.equal(c.periodsService.createGoal(c.child.id, { title: '阅读', subject: '语文' }).priority, 1);
  assert.equal(c.homeworkService.create(c.child.id, { subject: '数学', content: '练习', due_date: c.today }, 'child').priority, 1);
  for (const priority of [-1, 3, 1.5, '2', true, null, {}, []]) {
    assert.throws(() => c.template({ priority }), e => e.status === 400);
    assert.throws(() => c.adhoc({ priority }), e => e.status === 400);
    assert.throws(() => c.periodsService.createGoal(c.child.id, { title: '阅读', subject: '语文', priority }), e => e.status === 400);
    assert.throws(() => c.homeworkService.create(c.child.id, { subject: '数学', content: '练习', due_date: c.today, priority }, 'parent'), e => e.status === 400);
  }
});

test('template snapshots inherit defaults; edits retain overrides and settled or historical snapshots', async t => {
  const c = await fixture(t);
  const template = c.template({ priority: 2, track_time: true });
  const task = c.tasksService.getDailyTasks(c.child.id)[0];
  assert.equal(task.priority, 2);
  assert.equal(task.default_priority, 2);
  assert.equal(task.priority_override, null);
  const yesterday = shiftDate(c.today, -1), tomorrow = shiftDate(c.today, 1);
  const past = c.tasksService.generateTemplateTasks(c.child.id, yesterday, [template]).get(template.id);
  const future = c.tasksService.generateTemplateTasks(c.child.id, tomorrow, [template]).get(template.id);
  const skippedChild = c.childrenService.createChild({ name: '已跳过' });
  const skipped = c.tasksService.getDailyTasks(skippedChild.id)[0];
  c.db.prepare('UPDATE daily_tasks SET skipped_at = ? WHERE id = ?').run(new Date().toISOString(), skipped.id);
  const other = c.childrenService.createChild({ name: '已完成' });
  const settled = c.tasksService.getDailyTasks(other.id)[0];
  c.db.prepare('UPDATE daily_tasks SET is_completed = 1 WHERE id = ?').run(settled.id);
  c.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 120 WHERE id = ?').run(task.id);
  const overridden = c.tasksService.setDailyPriority(task.id, 0);
  assert.equal(overridden.priority, 0);
  assert.equal(c.tasksService.getTemplate(template.id).priority, 2);
  c.tasksService.updateTemplate(template.id, { priority: 1 });
  const refreshed = c.tasksService.getDailyTasks(c.child.id).find(r => r.id === task.id);
  assert.equal(refreshed.priority, 0);
  assert.equal(refreshed.default_priority, 1);
  assert.equal(c.row(task.id).timer_elapsed_seconds, 120);
  assert.equal(c.row(past.id).priority, 2);
  assert.equal(c.row(settled.id).priority, 2);
  assert.equal(c.row(skipped.id).priority, 2);
  assert.equal(c.row(future.id).priority, 1);
  assert.equal(c.tasksService.setDailyPriority(task.id, null).priority, 1);
  assert.equal(c.tasksService.getDailyTasks(c.child.id).find(r => r.id === task.id).priority_override, null);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
});

test('priority endpoint is parent-only, validates input, respects restore generation and preserves history', async t => {
  const c = await fixture(t);
  const task = c.adhoc();
  const url = `/api/daily-tasks/${task.id}/priority`;
  const childToken = c.app.jwt.sign({ role: 'child', child_id: c.child.id, epoch: c.app.sessionEpoch() });
  assert.equal((await c.rawInject({ method: 'PUT', url, payload: { priority: 2 }, headers: { authorization: `Bearer ${childToken}` } })).statusCode, 403);
  const call = (payload, headers) => c.app.inject({ method: 'PUT', url, payload, headers });
  for (const priority of [undefined, '2', false, 3, -1]) assert.equal((await call({ priority })).statusCode, 400);
  assert.equal((await call({ priority: 2 }, { 'x-taskie-data-generation': 'before-restore' })).statusCode, 409);
  assert.equal(c.row(task.id).priority_override, null);
  const saved = await call({ priority: 2 });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().priority, 2);
  assert.equal(c.tasksService.listAdhocTasks(c.child.id)[0].priority, 2);
  c.db.prepare("UPDATE daily_tasks SET skipped_at = '2026-10-26T00:00:00Z' WHERE id = ?").run(task.id);
  assert.equal((await call({ priority: 0 })).statusCode, 409);
  c.db.prepare('UPDATE daily_tasks SET skipped_at = NULL, is_completed = 1 WHERE id = ?').run(task.id);
  assert.equal((await call({ priority: null })).statusCode, 409);
  c.db.prepare('UPDATE daily_tasks SET is_completed = 0, date = ? WHERE id = ?').run(shiftDate(c.today, -1), task.id);
  assert.equal((await call({ priority: 0 })).statusCode, 409);
  const carried = c.adhoc({ date: shiftDate(c.today, -1), due_date: shiftDate(c.today, 1) });
  assert.equal(c.tasksService.setDailyPriority(carried.id, 0).priority, 0);
  assert.throws(() => c.tasksService.setDailyPriority('missing', 2), e => e.status === 404);
});

test('homework priority belongs to the parent, snapshots into deferred tasks and is edited only on the record', async t => {
  const c = await fixture(t);
  const body = { subject: '数学', content: '练习册', due_date: shiftDate(c.today, 1), create_task: true };
  assert.throws(() => c.homeworkService.create(c.child.id, { ...body, priority: 2 }, 'child'), e => e.status === 403);
  const record = c.homeworkService.create(c.child.id, body, 'child');
  assert.throws(() => c.homeworkService.update(record.id, { priority: 2 }, 'child'), e => e.status === 403);
  c.homeworkService.update(record.id, { priority: 2 }, 'parent');
  const attached = c.homeworkService.createTask(record.id);
  assert.equal(attached.task.priority, 2);
  // The record is the only place to change a course homework task's priority.
  assert.throws(() => c.tasksService.setDailyPriority(attached.task.id, 0), e => e.status === 400);
  assert.equal((await c.app.inject({ method: 'PUT', url: `/api/daily-tasks/${attached.task.id}/priority`, payload: { priority: 0 } })).statusCode, 400);
  assert.equal(c.row(attached.task.id).priority_override, null);
  c.db.prepare('UPDATE daily_tasks SET priority_override = 0 WHERE id = ?').run(attached.task.id); // An override saved before this rule.
  c.homeworkService.update(record.id, { priority: 1 }, 'parent');
  assert.equal(c.homeworkService.get(record.id).task.priority, 1, 'editing the record replaces an earlier occurrence override');
  assert.equal(c.row(attached.task.id).priority_override, null);
  c.db.prepare('UPDATE daily_tasks SET is_completed = 1 WHERE id = ?').run(attached.task.id);
  c.homeworkService.update(record.id, { priority: 2 }, 'parent');
  assert.equal(c.row(attached.task.id).priority, 1);
  const immediate = c.homeworkService.create(c.child.id, { ...body, priority: 0 }, 'parent');
  assert.equal(immediate.task.priority, 0);
});

test('retaining a task after deleting its homework record restores parent priority editing without losing provenance or time', async t => {
  const c = await fixture(t);
  const record = c.homeworkService.create(c.child.id, {
    subject: '数学', content: '删除记录后保留任务', due_date: c.today, create_task: true, priority: 2, track_time: true
  }, 'parent');
  const taskId = record.task.id;
  c.homeworkStudyService.manual(record.id, { request_id: 'detached-priority-study', duration_seconds: 120 }, 'parent');
  const url = `/api/daily-tasks/${taskId}/priority`;
  // A live relationship, rather than the historical marker, must enforce the single editing entry.
  c.db.prepare('UPDATE daily_tasks SET is_course_homework = 0 WHERE id = ?').run(taskId);
  assert.equal((await c.app.inject({ method: 'PUT', url, payload: { priority: 0 } })).statusCode, 400);
  c.db.prepare('UPDATE daily_tasks SET is_course_homework = 1 WHERE id = ?').run(taskId);
  assert.equal((await c.app.inject({ method: 'DELETE', url: `/api/homework/${record.id}` })).statusCode, 200);
  const detached = c.tasksService.getDailyTasks(c.child.id).find(task => task.id === taskId);
  assert.equal(detached.homework, null);
  assert.equal(detached.is_course_homework, 1);
  const before = c.row(taskId);
  const sessions = c.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(taskId);
  const statsBefore = c.timeStatsService.stats(c.child.id, c.today, c.today).summary;
  const childToken = c.app.jwt.sign({ role: 'child', child_id: c.child.id, epoch: c.app.sessionEpoch() });
  assert.equal((await c.rawInject({ method: 'PUT', url, payload: { priority: 0 }, headers: { authorization: `Bearer ${childToken}` } })).statusCode, 403);
  const edited = await c.app.inject({ method: 'PUT', url, payload: { priority: 0 } });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().priority, 0);
  assert.equal(c.row(taskId).priority_override, 0);
  const reset = await c.app.inject({ method: 'PUT', url, payload: { priority: null } });
  assert.equal(reset.statusCode, 200, reset.body);
  assert.equal(reset.json().priority, 2);
  assert.deepEqual(c.row(taskId), before, 'reset changes no task fields beyond restoring the original priority');
  assert.deepEqual(c.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(taskId), sessions);
  assert.deepEqual(c.timeStatsService.stats(c.child.id, c.today, c.today).summary, statsBefore);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  c.tasksService.completeDailyTask(taskId);
  assert.equal((await c.app.inject({ method: 'PUT', url, payload: { priority: 0 } })).statusCode, 409);
});

test('goal defaults update only pending current/future daily snapshots', async t => {
  const c = await fixture(t);
  const goal = c.periodsService.createGoal(c.child.id, { title: '阅读', subject: '语文', daily_required: true, priority: 2 });
  const daily = c.tasksService.getDailyTasks(c.child.id).find(r => r.goal_id === goal.id);
  assert.equal(daily.priority, 2);
  assert.throws(() => c.tasksService.setDailyPriority(daily.id, 0), e => e.status === 400);
  c.periodsService.updateTask(goal.id, { priority: 0 });
  assert.equal(c.row(daily.id).priority, 0);
  c.db.prepare('UPDATE daily_tasks SET is_completed = 1 WHERE id = ?').run(daily.id);
  c.periodsService.updateTask(goal.id, { priority: 2 });
  assert.equal(c.row(daily.id).priority, 0);
});

test('sort deadlines reflect same-day, explicit homework, and the last allowed weekly day', async t => {
  const c = await fixture(t);
  const weekly = c.template({ title: '每周', days_of_week: [1, 3, 5], schedule_type: 'weekly_times', weekly_target_times: 1 });
  const ordinary = c.adhoc();
  const homework = c.adhoc({ due_date: shiftDate(c.today, 2) });
  const rows = c.tasksService.getDailyTasks(c.child.id);
  assert.equal(rows.find(r => r.id === ordinary.id).sort_due_date, c.today);
  assert.equal(rows.find(r => r.id === homework.id).sort_due_date, shiftDate(c.today, 2));
  assert.equal(rows.find(r => r.title === '每周').sort_due_date, '2026-10-30');
  assert.equal(rows.find(r => r.title === '每周').is_optional, true);
  c.periodsService.createPeriod(c.child.id, { name: '周五放假', start_date: '2026-10-30', end_date: '2026-11-01', paused_template_ids: [weekly.id] });
  assert.equal(c.tasksService.getDailyTasks(c.child.id).find(r => r.title === '每周').sort_due_date, '2026-10-28');
});

test('v31 upgrades existing sources to normal; current restore retains overrides and incomplete v32 is rejected', async t => {
  const c = await fixture(t);
  const template = c.template({ priority: 2 });
  const task = c.tasksService.getDailyTasks(c.child.id)[0];
  c.tasksService.setDailyPriority(task.id, 0);
  const goal = c.periodsService.createGoal(c.child.id, { title: '备份目标', subject: '语文', priority: 2 });
  const homework = c.homeworkService.create(c.child.id, { subject: '数学', content: '备份作业', due_date: c.today, priority: 0 }, 'parent');
  const service = c.app.backupService;
  const archive = fs.readFileSync(service.getPath((await service.create()).name));
  c.tasksService.setDailyPriority(task.id, 1);
  await service.restore(archive);
  assert.equal(c.row(task.id).priority_override, 0);
  assert.equal(c.tasksService.getTemplate(template.id).priority, 2);
  assert.equal(c.periodsService.getTask(goal.id).priority, 2);
  assert.equal(c.homeworkService.get(homework.id).priority, 0);
  const data = JSON.parse(gunzipSync(archive));
  const old = new Database(Buffer.from(data.database, 'base64'));
  t.after(() => old.close());
  old.exec('ALTER TABLE daily_tasks DROP COLUMN priority_override');
  for (const table of ['task_templates', 'daily_tasks', 'homework_records', 'period_tasks']) old.exec(`ALTER TABLE ${table} DROP COLUMN priority`);
  const pack = () => gzipSync(JSON.stringify({ ...data, database: old.serialize().toString('base64') }));
  await assert.rejects(service.restore(pack()), /缺少任务优先级/);
  assert.equal(c.row(task.id).priority_override, 0, 'invalid restore leaves live data alone');
  old.pragma('user_version = 31');
  await service.restore(pack());
  assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(c.row(task.id).priority, 1);
  assert.equal(c.row(task.id).priority_override, null);
  assert.equal(c.tasksService.getTemplate(template.id).priority, 1);
  assert.equal(c.periodsService.getTask(goal.id).priority, 1);
  assert.equal(c.homeworkService.get(homework.id).priority, 1);
  initDb(c.db);
  assert.equal(c.row(task.id).priority, 1, 'startup is idempotent');
});
