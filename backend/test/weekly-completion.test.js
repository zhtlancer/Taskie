const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '小明' } })).json();
  const { tasksService, statsService } = ctx.app.services;
  const lastMonday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(lastMonday, n);
  // Use family noon so the creation date matches the intended business date.
  const backdate = (table, id, date) => ctx.db.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(familyInstant(date), id);
  backdate('children', child.id, day(-30));
  const template = data => {
    const created = tasksService.createTemplate({ subject: '数学', ...data });
    backdate('task_templates', created.id, day(-30));
    return created;
  };
  const completeOn = (date, title) => {
    const task = tasksService.getDailyTasks(child.id, date).find(t => t.title === title);
    tasksService.completeDailyTask(task.id);
  };
  const completion = date => statsService.getWeeklySummary(child.id, date).current_week.completion;
  const byTitle = result => Object.fromEntries(result.items.map(i => [i.title, [i.completed, i.total]]));
  return { ctx, child, tasksService, statsService, day, backdate, template, completeOn, completion, byTitle };
}

test('weekly completion counts scheduled days and weekly targets, including days the app was never opened', async t => {
  const { ctx, child, tasksService, day, template, completeOn, completion, byTitle } = await fixture(t);
  template({ title: '口算', days_of_week: [1, 2, 3, 4, 5] });
  template({ title: '阅读', schedule_type: 'weekly_times', weekly_target_times: 3 });

  completeOn(day(0), '口算');                 // Monday done
  tasksService.getDailyTasks(child.id, day(1)); // Tuesday opened, nothing done
  // Wednesday never opened: still owed one 口算.
  completeOn(day(3), '口算');
  completeOn(day(3), '阅读');
  completeOn(day(4), '口算');
  completeOn(day(4), '阅读');
  completeOn(day(5), '阅读');

  const result = completion(day(6));
  assert.deepEqual(byTitle(result), { 口算: [3, 5], 阅读: [3, 3] });
  assert.deepEqual([result.completed_units, result.total_units, result.completion_rate], [6, 8, 0.75]);

  // Completions beyond the weekly target do not count extra.
  ctx.db.prepare(`INSERT INTO daily_tasks (id, child_id, template_id, title, subject, points, date, is_completed, schedule_type, weekly_target_times)
    SELECT 'extra', child_id, template_id, title, subject, points, ?, 1, schedule_type, weekly_target_times FROM daily_tasks WHERE title = '阅读' LIMIT 1`).run(day(6));
  assert.deepEqual(byTitle(completion(day(6)))['阅读'], [3, 3]);
});

test('days before the child or a template existed are not counted, and the current week counts up to today', async t => {
  const { ctx, child, tasksService, statsService, day, backdate, template } = await fixture(t);
  const daily = template({ title: '口算', days_of_week: [0, 1, 2, 3, 4, 5, 6] });

  backdate('task_templates', daily.id, day(4));               // created on Friday
  assert.equal(statsService.getWeeklySummary(child.id, day(6)).current_week.completion.total_units, 3);

  backdate('children', child.id, day(7));                      // child created this Monday
  const weeks = statsService.getWeeklySummary(child.id, day(7));
  assert.deepEqual([weeks.last_week.completion.total_units, weeks.last_week.completion.completion_rate], [0, null]);
  // This week only counts Monday through today; later days are not due yet.
  const daysSoFar = [0, 1, 2, 3, 4, 5, 6].filter(n => day(7 + n) <= getTodayDate()).length;
  assert.equal(weeks.current_week.completion.total_units, daysSoFar);
  assert.equal(weeks.current_week.completion.as_of, getTodayDate());
  assert.equal(weeks.current_week.completion.completed_units, 0);

  // A template assigned to another child is not owed.
  const other = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '小红' } })).json();
  tasksService.updateTemplate(daily.id, { child_ids: [other.id] });
  assert.equal(statsService.getWeeklySummary(child.id, day(7)).current_week.completion.total_units, 0);
});

test('completion as of a day owes only what was due by then, and weekly targets only what can no longer be made up', async t => {
  const { child, statsService, tasksService, day, template, completeOn } = await fixture(t);
  template({ title: '口算', days_of_week: [1, 2, 3, 4, 5] });
  template({ title: '阅读', schedule_type: 'weekly_times', weekly_target_times: 3 });
  const asOf = n => {
    const result = statsService.getWeeklyCompletion(child.id, day(0), day(6), day(n));
    return { items: Object.fromEntries(result.items.map(i => [i.title, [i.completed, i.total]])), rate: result.completion_rate, as_of: result.as_of };
  };

  // Monday before anything is done: one 口算 is due, reading is not due yet.
  assert.deepEqual(asOf(0), { items: { 口算: [0, 1] }, rate: 0, as_of: day(0) });

  completeOn(day(0), '口算');
  completeOn(day(0), '阅读');                    // reading done early counts without raising what is owed
  tasksService.getDailyTasks(child.id, day(1));  // Tuesday opened, nothing done; Wednesday never opened
  assert.deepEqual(asOf(2), { items: { 口算: [1, 3], 阅读: [1, 1] }, rate: 0.5, as_of: day(2) });

  completeOn(day(3), '口算');
  completeOn(day(4), '口算');
  // Friday: 3 times minus 2 days left still owes 1, already covered.
  assert.deepEqual(asOf(4).items, { 口算: [3, 5], 阅读: [1, 1] });
  // Saturday: 1 day left, so 2 are owed and only 1 is done.
  assert.deepEqual(asOf(5).items, { 口算: [3, 5], 阅读: [1, 2] });
  // Sunday and any later day: the whole week is due.
  assert.deepEqual(asOf(6).items, { 口算: [3, 5], 阅读: [1, 3] });
  assert.deepEqual(asOf(20), { ...asOf(6), as_of: day(6) });
  // A day before the week starts owes nothing.
  assert.deepEqual(asOf(-1), { items: {}, rate: null, as_of: day(-1) });
});

test('generated tasks count even before the child was created; only projection is limited', async t => {
  const { child, day, backdate, template, completeOn, completion, byTitle } = await fixture(t);
  template({ title: '口算', days_of_week: [1, 2, 3, 4, 5] });
  completeOn(day(0), '口算');                 // e.g. a parent backfilling Monday
  backdate('children', child.id, day(3));     // child "created" on Thursday
  // Monday's real task counts; Tuesday and Wednesday are not projected; Thursday and Friday are.
  assert.deepEqual(byTitle(completion(day(6))), { 口算: [1, 3] });
});

test('tasks from a deleted template still count on the days they were generated', async t => {
  const { tasksService, day, template, completeOn, completion, byTitle } = await fixture(t);
  const daily = template({ title: '口算', days_of_week: [1, 2, 3, 4, 5] });
  completeOn(day(0), '口算');
  completeOn(day(1), '口算');
  tasksService.deleteTemplate(daily.id);
  // Only the two generated days remain owed; unopened days no longer project a deleted template.
  assert.deepEqual(byTitle(completion(day(6))), { 口算: [2, 2] });
});

test('weekly completion is served with the weekly summary and limited to the child themself', async t => {
  const { ctx, child } = await fixture(t);
  const other = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '小红' } })).json();
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  const headers = { authorization: `Bearer ${login.token}` };
  const own = await ctx.rawInject({ method: 'GET', url: `/api/children/${child.id}/weekly-summary`, headers });
  assert.equal(own.statusCode, 200);
  assert.ok('completion' in own.json().current_week && 'completion' in own.json().last_week);
  assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/children/${other.id}/weekly-summary`, headers })).statusCode, 403);
});

test('switching between fixed and weekly schedules preserves both kinds of completion and undo', async t => {
  const { child, tasksService, day, template, completion } = await fixture(t);
  const fixed = template({ title: '固定转每周' });
  const weekly = template({ title: '每周转固定', schedule_type: 'weekly_times', weekly_target_times: 2 });
  for (const task of tasksService.getDailyTasks(child.id, day(0))) tasksService.completeDailyTask(task.id);
  tasksService.updateTemplate(fixed.id, { schedule_type: 'weekly_times', weekly_target_times: 3 });
  tasksService.updateTemplate(weekly.id, { schedule_type: 'fixed_days' });
  const changed = tasksService.getDailyTasks(child.id, day(2));
  for (const task of changed) tasksService.completeDailyTask(task.id);
  const result = completion(day(6));
  for (const id of [fixed.id, weekly.id]) {
    const items = result.items.filter(i => i.template_id === id);
    assert.equal(items.length, 2);
    assert.equal(items.reduce((sum, i) => sum + i.completed, 0), 2);
  }
  assert.equal(new Set(result.items.map(i => i.key)).size, result.items.length);
  tasksService.uncompleteDailyTask(changed.find(t => t.template_id === fixed.id).id);
  assert.equal(completion(day(6)).items.filter(i => i.template_id === fixed.id).reduce((sum, i) => sum + i.completed, 0), 1);
  // A fixed-day completion must not consume the later weekly schedule's quota.
  for (const n of [2, 3, 4]) {
    const task = tasksService.getDailyTasks(child.id, day(n)).find(t => t.template_id === fixed.id);
    assert.ok(task);
    tasksService.completeDailyTask(task.id);
  }
  assert.equal(tasksService.getDailyTasks(child.id, day(5)).some(t => t.template_id === fixed.id), false);
  assert.equal(completion(day(6)).items.filter(i => i.template_id === fixed.id).reduce((sum, i) => sum + i.completed, 0), 4);
});

test('deleted same-title weekly templates retain independent quotas and old orphan completions stay separate', async t => {
  const { ctx, child, tasksService, day, template, completion } = await fixture(t);
  const a = template({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 2 });
  const b = template({ title: '阅读', subject: '英语', schedule_type: 'weekly_times', weekly_target_times: 2 });
  for (const n of [0, 1]) for (const task of tasksService.getDailyTasks(child.id, day(n))) tasksService.completeDailyTask(task.id);
  const before = completion(day(6));
  assert.equal(before.completed_units, 4);
  tasksService.deleteTemplate(a.id); tasksService.deleteTemplate(b.id);
  assert.deepEqual(completion(day(6)), before);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM daily_tasks WHERE template_id IS NULL AND source_template_id IS NOT NULL').get().n, 4);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 40);
  assert.ok(tasksService.describeTasksBetween(child.id, day(0), day(6)).every(task => task.weekly_completed_times === 2));
  // Data from before snapshot migration cannot reveal which deleted template a row belonged to.
  ctx.db.exec('UPDATE daily_tasks SET source_template_id = NULL, template_created_at = NULL');
  const legacy = completion(day(6));
  assert.equal(legacy.completed_units, 4);
  assert.equal(legacy.items.length, 4);
  assert.equal(new Set(legacy.items.map(i => i.key)).size, 4);
});

test('a weekly task first created Wednesday owes one unit then, five by Sunday, and preserves real backfills', async t => {
  const { child, tasksService, statsService, day, backdate, template } = await fixture(t);
  const weekly = template({ title: '首周任务', schedule_type: 'weekly_times', weekly_target_times: 7 });
  backdate('task_templates', weekly.id, day(2));
  const asOf = n => statsService.getWeeklyCompletion(child.id, day(0), day(6), day(n));
  assert.equal(asOf(1).total_units, 0);
  assert.equal(asOf(2).total_units, 1);
  assert.equal(asOf(6).total_units, 5);
  // The child's later creation date also limits the first week's projected duties.
  backdate('children', child.id, day(4));
  assert.equal(asOf(3).total_units, 0);
  assert.equal(asOf(4).total_units, 1);
  assert.equal(asOf(6).total_units, 3);
  const task = tasksService.getDailyTasks(child.id, day(0))[0];
  tasksService.completeDailyTask(task.id);
  assert.equal(asOf(0).completed_units, 1);
  assert.equal(asOf(0).total_units, 1);
  // Deletion preserves the creation snapshot used to bound the first week.
  tasksService.deleteTemplate(weekly.id);
  assert.equal(asOf(6).total_units, 3);
});
