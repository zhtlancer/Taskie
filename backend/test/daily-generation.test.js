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

test('template edits update auto-generated pending cards and rewards without replacing ids or timers', async t => {
  const { ctx, child, weekday, tasksService: tasks } = await family(t);
  tasks.updateTemplate(weekday.id, { track_time: true });
  tasks.generateToday();
  const getRow = () => ctx.db.prepare("SELECT * FROM daily_tasks WHERE child_id = ? AND date = '2026-10-19'").get(child.id);
  const original = getRow();
  ctx.db.prepare('UPDATE daily_tasks SET timer_started_at = ?, timer_elapsed_seconds = 60 WHERE id = ?')
    .run('2026-10-19T03:59:00.000Z', original.id);
  tasks.updateTemplate(weekday.id, { title: '新阅读', subject: '语文', points: 50 });
  tasks.generateToday();
  const row = getRow();
  assert.deepEqual([row.id, row.title, row.subject, row.points, row.timer_started_at, row.timer_elapsed_seconds],
    [original.id, '新阅读', '语文', 50, '2026-10-19T03:59:00.000Z', 60]);
  assert.equal(tasks.completeDailyTask(row.id, { duration_seconds: 120 }).points_earned, 50);
});

test('today follows schedule and weekly target edits while completed, skipped and past snapshots stay intact', async t => {
  const { ctx, child, weekday, tasksService: tasks, childrenService, skipsService } = await family(t);
  const doneChild = childrenService.createChild({ name: '已完成' });
  const skipChild = childrenService.createChild({ name: '已跳过' });
  tasks.generateToday();
  const find = (childId, date = '2026-10-19') => ctx.db.prepare('SELECT * FROM daily_tasks WHERE child_id = ? AND date = ?').get(childId, date);
  tasks.completeDailyTask(find(doneChild.id).id);
  skipsService.requestSkip(find(skipChild.id).id, '今天没有布置', { role: 'parent' });
  tasks.getDailyTasks(child.id, '2026-10-12');
  const settled = [find(doneChild.id), find(skipChild.id), find(child.id, '2026-10-12')];
  const id = find(child.id).id;
  tasks.updateTemplate(weekday.id, { title: '每周阅读', points: 50, schedule_type: 'weekly_times', weekly_target_times: 3 });
  tasks.generateToday();
  assert.deepEqual([find(child.id).id, find(child.id).schedule_type, find(child.id).weekly_target_times], [id, 'weekly_times', 3]);
  assert.deepEqual([find(doneChild.id), find(skipChild.id), find(child.id, '2026-10-12')], settled);
  tasks.updateTemplate(weekday.id, { schedule_type: 'fixed_days' });
  assert.deepEqual([find(child.id).schedule_type, find(child.id).weekly_target_times], ['fixed_days', null]);
});

test('a recorded empty day stays a rest day after later template edits', async t => {
  const { child, weekday, tasksService: tasks, day, setTime } = await family(t);
  tasks.updateTemplate(weekday.id, { days_of_week: [2, 3, 4, 5] });
  tasks.generateToday();
  assert.equal(tasks.hasDaySnapshot(child.id, '2026-10-19'), true);
  setTime('2026-10-20T04:00:00Z');
  assert.deepEqual([day('2026-10-19').total_tasks, day('2026-10-19').not_opened], [0, false]);
  tasks.updateTemplate(weekday.id, { days_of_week: [1, 2, 3, 4, 5] });
  assert.deepEqual([day('2026-10-19').total_tasks, day('2026-10-19').not_opened], [0, false]);
  assert.deepEqual(tasks.getBackfillTasks(child.id, '2026-10-19').tasks, []);
});

// Friday 10-16 to Monday 10-19 generated automatically, each weekday's task done; the weekend had nothing.
async function recordedWeekend(t) {
  const ctx = await family(t, '2026-10-16T04:00:00Z');
  for (const date of ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']) {
    ctx.setTime(`${date}T04:00:00Z`);
    ctx.tasksService.generateToday();
    const row = ctx.ctx.db.prepare('SELECT id FROM daily_tasks WHERE child_id = ? AND date = ?').get(ctx.child.id, date);
    if (row) ctx.tasksService.completeDailyTask(row.id);
  }
  const state = () => ({
    streak: ctx.rewardsService.getCurrentStreak(ctx.child.id, '2026-10-19'),
    week: ctx.statsService.getWeeklyCompletion(ctx.child.id, '2026-10-12', '2026-10-18', '2026-10-18').items.map(item => [item.title, item.completed, item.total]),
    weekend: ctx.statsService.getHistory(ctx.child.id, '2026-10-17', '2026-10-18').map(day => [day.total_tasks, day.not_opened])
  });
  return { ...ctx, state };
}

test('later configuration never adds tasks to recorded days in the streak, weekly completion or history', async t => {
  for (const [name, change] of [
    ['weekend template', ({ tasksService, weekday }) => tasksService.updateTemplate(weekday.id, { days_of_week: [0, 1, 2, 3, 4, 5, 6] })],
    ['long-term task started earlier', ({ periodsService, child }) => periodsService.createGoal(child.id, { title: '每天读书', subject: '语文', mode: 'check', daily_required: true, start_date: '2026-10-17' })],
    ['outside class started earlier', ({ scheduleService, child }) => scheduleService.createClass({ title: '周末钢琴', days_of_week: [0, 6], start_time: '09:00', end_time: '10:00',
      start_date: '2026-10-01', child_ids: [child.id], create_task: true, points: 5 })]
  ]) {
    await t.test(name, async t => {
      const ctx = await recordedWeekend(t);
      const before = ctx.state();
      assert.deepEqual([before.streak, before.weekend], [2, [[0, false], [0, false]]]);
      change(ctx);
      ctx.ctx.db.prepare('UPDATE outside_classes SET created_at = ?').run('2026-10-01T04:00:00Z');
      assert.deepEqual(ctx.state(), before);
    });
  }
});

test('days without a record are still projected from the configuration', async t => {
  const { tasksService, rewardsService, statsService, child, weekday, setTime } = await family(t, '2026-10-16T04:00:00Z');
  tasksService.generateToday();
  tasksService.completeDailyTask(tasksService.getDailyTasks(child.id)[0].id);
  setTime('2026-10-19T04:00:00Z'); // the server was down over the weekend
  tasksService.generateToday();
  tasksService.completeDailyTask(tasksService.getDailyTasks(child.id)[0].id);
  assert.equal(rewardsService.getCurrentStreak(child.id, '2026-10-19'), 2);
  tasksService.updateTemplate(weekday.id, { days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(rewardsService.getCurrentStreak(child.id, '2026-10-19'), 1, 'the unrecorded Sunday now had a task');
  assert.deepEqual(statsService.getHistory(child.id, '2026-10-18', '2026-10-18').map(day => day.not_opened), [true]);
});

for (const [name, recordedDays, allowedDays, expected] of [
  ['fully recorded', [12, 13, 14, 15, 16, 17, 18], [0, 1, 2, 3, 4, 5, 6], 0],
  ['partly recorded', [12, 13, 14, 15, 16, 17], [0, 1, 2, 3, 4, 5, 6], 1],
  ['unrecorded', [], [0, 1, 2, 3, 4, 5, 6], 3],
  ['only allowed dates recorded', [12, 13, 14, 15, 16], [1, 2, 3, 4, 5], 0]
]) {
  test(`reassigning a weekly template projects only unrecorded allowed dates (${name})`, async t => {
    const { ctx, child, childrenService, tasksService: tasks, statsService: stats, weekday } = await family(t);
    tasks.deleteTemplate(weekday.id);
    const other = childrenService.createChild({ name: '原被分配的孩子' });
    const template = tasks.createTemplate({ title: '每周阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 3,
      days_of_week: allowedDays, child_ids: [other.id], points: 5 });
    ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run('2026-10-01T04:00:00Z', template.id);
    for (const day of recordedDays) tasks.generateDay(child.id, `2026-10-${day}`);
    const completion = asOf => stats.getWeeklyCompletion(child.id, '2026-10-12', '2026-10-18', asOf);
    assert.equal(completion('2026-10-18').total_units, 0);
    tasks.updateTemplate(template.id, { child_ids: null });
    const week = completion('2026-10-18');
    assert.equal(week.total_units, expected);
    assert.equal(week.completed_units, 0);
    assert.equal(week.items.length, expected ? 1 : 0);
    if (expected) assert.equal(week.items[0].weekly_target, 3, 'the configured target stays visible');
    assert.equal(completion('2026-10-12').total_units, 0, 'future opportunities keep the weekly task optional early in the week');
    for (const day of recordedDays) {
      const history = stats.getHistory(child.id, `2026-10-${day}`, `2026-10-${day}`)[0];
      assert.deepEqual([history.total_tasks, history.not_opened], [0, false]);
    }
  });
}
