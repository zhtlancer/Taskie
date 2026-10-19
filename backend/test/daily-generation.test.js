const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

// A child with a weekday task, on Monday 2026-10-19; nobody opens the app unless a test does.
async function family(t, now = '2026-10-19T04:00:00Z') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const services = ctx.app.services;
  const child = services.childrenService.createChild({ name: '自动生成' });
  ctx.db.prepare('UPDATE children SET created_at = ?').run('2026-10-01T04:00:00Z');
  const weekday = services.tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [1, 2, 3, 4, 5], points: 10 });
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run('2026-10-01T04:00:00Z');
  const rows = (date, childId = child.id) => ctx.db.prepare('SELECT title FROM daily_tasks WHERE child_id = ? AND date = ? ORDER BY title').all(childId, date).map(row => row.title);
  const day = date => services.statsService.getHistory(child.id, date, date)[0];
  const setTime = iso => t.mock.timers.setTime(new Date(iso).getTime());
  return { ctx, ...services, child, weekday, rows, day, setTime };
}

test("today's tasks are saved for every child without anyone opening the app", async t => {
  const { childrenService, tasksService, periodsService, child, rows } = await family(t);
  const sibling = childrenService.createChild({ name: '妹妹' });
  periodsService.createGoal(child.id, { title: '每天读书', subject: '语文', mode: 'check', daily_required: true, start_date: '2026-10-19' });
  tasksService.generateToday();
  assert.deepEqual(rows('2026-10-19'), ['口算', '每天读书']);
  assert.deepEqual(rows('2026-10-19', sibling.id), ['口算']);
  assert.equal(tasksService.hasDaySnapshot(child.id, '2026-10-19'), true);
  tasksService.generateToday();
  assert.deepEqual(rows('2026-10-19'), ['口算', '每天读书'], 'running again adds nothing');
});

test('later runs follow configuration changes made during the day', async t => {
  const { ctx, tasksService, child, rows } = await family(t);
  tasksService.generateToday();
  const reading = tasksService.createTemplate({ title: '阅读', subject: '语文', days_of_week: [1], points: 5 });
  tasksService.generateToday();
  assert.deepEqual(rows('2026-10-19'), ['口算', '阅读']);
  const sibling = ctx.app.services.childrenService.createChild({ name: '只给妹妹' });
  tasksService.updateTemplate(reading.id, { child_ids: [sibling.id] });
  tasksService.generateToday();
  assert.deepEqual(rows('2026-10-19'), ['口算'], 'a task reassigned to another child leaves today');
  assert.deepEqual(rows('2026-10-19', sibling.id), ['口算', '阅读'], 'a child added during the day is generated on the next run');
});

test('a day nobody opened keeps its tasks after midnight and counts as missed, not as a rest day', async t => {
  const { tasksService, child, weekday, rows, day, setTime } = await family(t);
  tasksService.generateToday();
  setTime('2026-10-20T04:00:00Z'); // Tuesday
  tasksService.generateToday();
  tasksService.updateTemplate(weekday.id, { days_of_week: [2, 3, 4, 5], title: '改名口算' });
  tasksService.createTemplate({ title: '后加的周一任务', subject: '语文', days_of_week: [1], points: 5 });
  assert.deepEqual(rows('2026-10-19'), ['口算'], "Monday keeps that day's configuration");
  const monday = day('2026-10-19');
  assert.deepEqual([monday.total_tasks, monday.completed_tasks, monday.not_opened], [1, 0, false]);
  assert.deepEqual(tasksService.getBackfillTasks(child.id, '2026-10-19').tasks.map(task => [task.title, Boolean(task.projected)]), [['口算', false]],
    'parents backfill the saved task instead of a projection');
});

test('history marks unopened days that had tasks as not opened, never rest days or today', async t => {
  const { tasksService, child, day } = await family(t, '2026-10-20T04:00:00Z'); // Tuesday; nothing generated so far
  assert.deepEqual([day('2026-10-19').total_tasks, day('2026-10-19').not_opened], [0, true], 'an unopened Monday');
  assert.equal(day('2026-10-18').not_opened, false, 'Sunday had nothing to do');
  assert.equal(day('2026-10-20').not_opened, false, 'today is not over');
  const [task] = tasksService.getBackfillTasks(child.id, '2026-10-19').tasks;
  tasksService.materializeBackfillDay(child.id, '2026-10-19');
  tasksService.backfillDailyTask(tasksService.getBackfillTasks(child.id, '2026-10-19').tasks.find(row => row.template_id === task.template_id).id);
  assert.deepEqual([day('2026-10-19').total_tasks, day('2026-10-19').completed_tasks, day('2026-10-19').not_opened], [1, 1, false]);
});

test('a day whose tasks were all skipped is a rest day, not an unopened one', async t => {
  const { tasksService, skipsService, child, day } = await family(t, '2026-10-20T04:00:00Z');
  tasksService.materializeBackfillDay(child.id, '2026-10-19');
  const [task] = tasksService.getBackfillTasks(child.id, '2026-10-19').tasks;
  skipsService.requestSkip(task.id, '生病请假', { role: 'parent' });
  assert.deepEqual([day('2026-10-19').total_tasks, day('2026-10-19').not_opened], [0, false]);
});
