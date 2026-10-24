const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');

test('template edits preserve an already recorded historical day', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-19', '12:00:00')) });
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, tasksService: tasks, statsService } = ctx.app.services;
  const child = childrenService.createChild({ name: '历史快照' });
  ctx.db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-01', '12:00:00'), child.id);
  const old = tasks.createTemplate({ title: '原有周一作业', subject: '语文', days_of_week: [1], points: 10 });
  const added = tasks.createTemplate({ title: '原有周日作业', subject: '数学', days_of_week: [0], points: 20 });
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(familyInstant('2026-10-01', '12:00:00'));
  const date = '2026-10-12';
  assert.deepEqual(tasks.getDailyTasks(child.id, date).map(row => row.template_id), [old.id]);
  tasks.completeDailyTask(tasks.getDailyTasks(child.id, date)[0].id);
  const before = statsService.getHistory(child.id, date, date)[0];
  tasks.updateTemplate(added.id, { days_of_week: [1], points: 200 });
  const projected = tasks.getBackfillTasks(child.id, date).tasks;
  const unexpected = projected.find(row => row.template_id === added.id);
  assert.equal(unexpected, undefined);
  tasks.materializeBackfillDay(child.id, date);
  const after = statsService.getHistory(child.id, date, date)[0];
  assert.deepEqual([before.total_tasks, before.all_done, after.total_tasks, after.all_done], [1, true, 1, true]);
  assert.deepEqual(tasks.getDailyTasks(child.id, date).map(row => row.template_id), [old.id]);
});


test('an opened empty date stays empty after a template is rescheduled', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-12', '12:00:00')) });
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, tasksService: tasks } = ctx.app.services;
  const child = childrenService.createChild({ name: '空白日' });
  const template = tasks.createTemplate({ title: '周日任务', subject: '语文', days_of_week: [0], points: 10 });
  assert.deepEqual(tasks.getDailyTasks(child.id), []);
  t.mock.timers.setTime(new Date(familyInstant('2026-10-14', '12:00:00')).getTime());
  tasks.updateTemplate(template.id, { days_of_week: [1] });
  assert.deepEqual(tasks.getBackfillTasks(child.id, '2026-10-12').tasks, []);
  assert.deepEqual(tasks.materializeBackfillDay(child.id, '2026-10-12').tasks, []);
});

test('v17 upgrade preserves generated dates without freezing dates containing only adhoc tasks', async t => {
  const { initDb } = require('../src/db');
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-19', '12:00:00')) });
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, tasksService: tasks } = ctx.app.services;
  const child = childrenService.createChild({ name: '升级' });
  ctx.db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-01', '12:00:00'), child.id);
  tasks.createTemplate({ title: '阅读', subject: '语文', days_of_week: [1], points: 10 });
  tasks.getDailyTasks(child.id, '2026-10-12');
  tasks.createAdhocTask(child.id, { title: '临时作业', subject: '数学', points: 5, date: '2026-10-13' });
  ctx.db.exec('DROP TABLE task_day_snapshots; PRAGMA user_version = 17');
  initDb(ctx.db);
  assert.equal(tasks.hasDaySnapshot(child.id, '2026-10-12'), true);
  assert.equal(tasks.hasDaySnapshot(child.id, '2026-10-13'), false);
});

test('a carried-over template cannot add tasks to a recorded date', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-16', '12:00:00')) }); // Friday
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, tasksService: tasks, statsService } = ctx.app.services;
  const child = childrenService.createChild({ name: '顺延' });
  ctx.db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-01', '12:00:00'), child.id);
  tasks.createTemplate({ title: '周五作业', subject: '语文', days_of_week: [5], points: 10 });
  const carry = tasks.createTemplate({ title: '可顺延', subject: '数学', days_of_week: [0], points: 10, carry_over: true });
  const plain = tasks.createTemplate({ title: '不顺延', subject: '英语', days_of_week: [0], points: 10 });
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(familyInstant('2026-10-01', '12:00:00'));
  tasks.completeDailyTask(tasks.getDailyTasks(child.id)[0].id);
  t.mock.timers.setTime(new Date(familyInstant('2026-10-17', '12:00:00')).getTime()); // Saturday
  tasks.updateTemplate(carry.id, { days_of_week: [5] });
  tasks.updateTemplate(plain.id, { days_of_week: [5] });
  assert.deepEqual(tasks.getDailyTasks(child.id).map(row => row.title), []);
  assert.deepEqual(ctx.db.prepare("SELECT title FROM daily_tasks WHERE date = '2026-10-16'").all().map(row => row.title), ['周五作业']);
  t.mock.timers.setTime(new Date(familyInstant('2026-10-19', '12:00:00')).getTime()); // Monday, past the carry deadline
  const history = statsService.getHistory(child.id, '2026-10-16', '2026-10-18');
  assert.deepEqual(history.map(day => day.total_tasks), [1, 0, 0]);
  assert.equal(history[0].all_done, true);
});

test('materializing a carried task records its date with that day\'s other tasks', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-17', '12:00:00')) }); // Saturday
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, tasksService: tasks } = ctx.app.services;
  const child = childrenService.createChild({ name: '未打开' });
  ctx.db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-01', '12:00:00'), child.id);
  tasks.createTemplate({ title: '可顺延', subject: '数学', days_of_week: [5], points: 10, carry_over: true });
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(familyInstant('2026-10-01', '12:00:00'));
  assert.deepEqual(tasks.getDailyTasks(child.id).map(row => row.carried_from), ['2026-10-16']);
  assert.equal(tasks.hasDaySnapshot(child.id, '2026-10-16'), true);
  const later = tasks.createTemplate({ title: '后改周五', subject: '语文', days_of_week: [5], points: 10, carry_over: true });
  ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-01', '12:00:00'), later.id);
  assert.deepEqual(tasks.getDailyTasks(child.id).map(row => row.title), ['可顺延']);
});

test('materializing a carried source day includes its class check-in exactly once and freezes additions', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-17', '12:00:00')) }); // Saturday
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, tasksService: tasks, scheduleService: schedule, statsService } = ctx.app.services;
  const child = childrenService.createChild({ name: '顺延和课外班' });
  ctx.db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-01', '12:00:00'), child.id);
  tasks.createTemplate({ title: '周五口算', subject: '数学', days_of_week: [5], points: 10, carry_over: true });
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(familyInstant('2026-10-01', '12:00:00'));
  const piano = schedule.createClass({ title: '钢琴课', days_of_week: [5], start_time: '16:00', end_time: '17:00',
    start_date: '2026-10-01', child_ids: [child.id], create_task: true, points: 8 });
  const rescheduled = schedule.createClass({ title: '原周日课程', days_of_week: [0], start_time: '09:00', end_time: '10:00',
    start_date: '2026-10-01', child_ids: [child.id], create_task: true, points: 6 });
  ctx.db.prepare('UPDATE outside_classes SET created_at = ?').run(familyInstant('2026-10-01', '12:00:00'));
  const sourceRows = () => ctx.db.prepare("SELECT * FROM daily_tasks WHERE child_id = ? AND date = '2026-10-16' ORDER BY id").all(child.id);
  assert.deepEqual(sourceRows(), [], 'Friday was never opened');

  const board = tasks.getDailyTasks(child.id);
  assert.deepEqual(board.map(row => [row.title, row.carried_from]), [['周五口算', '2026-10-16']]);
  const rows = sourceRows();
  assert.equal(rows.length, 2, 'Friday includes both homework and its class check-in');
  const lesson = rows.find(row => row.class_id === piano.id);
  assert.ok(lesson);
  assert.deepEqual([lesson.origin, lesson.class_lesson_date, lesson.title, lesson.points], ['class', '2026-10-16', '钢琴课', 8]);
  assert.equal(tasks.hasDaySnapshot(child.id, '2026-10-16'), true);
  assert.deepEqual(tasks.getBackfillTasks(child.id, '2026-10-16').tasks.map(row => row.id).sort(), rows.map(row => row.id));
  const friday = statsService.getHistory(child.id, '2026-10-16', '2026-10-16')[0];
  // The carried homework stays optional until Sunday, so only the check-in counts on Friday for now.
  assert.deepEqual(friday.tasks.map(task => [task.title, task.is_optional]), [['周五口算', true], ['钢琴课', false]]);
  assert.equal(friday.total_tasks, 1);

  tasks.getDailyTasks(child.id);
  assert.deepEqual(sourceRows(), rows, 'reopening does not duplicate or alter either source task');
  schedule.updateClass(rescheduled.id, { days_of_week: [5], points: 60 });
  tasks.getDailyTasks(child.id);
  tasks.materializeBackfillDay(child.id, '2026-10-16');
  assert.deepEqual(sourceRows(), rows, 'a later course edit cannot add a check-in to the recorded Friday');
});
