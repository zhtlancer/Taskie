const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '小明' } })).json();
  const { tasksService, statsService, rewardsService } = ctx.app.services;
  // Last week's Monday keeps weekdays deterministic; everything existed well before it.
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  const backdateAll = () => {
    ctx.db.prepare('UPDATE children SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
    ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  };
  const find = (date, title) => tasksService.getDailyTasks(child.id, date).find(task => task.title === title);
  return { ctx, child, tasksService, statsService, rewardsService, day, backdateAll, find };
}

test('a weekend task appears only on its days, is flexible on Saturday and required on Sunday', async t => {
  const { tasksService, day, find } = await fixture(t);
  tasksService.createTemplate({ title: '周末作业', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [6, 0] });

  for (const n of [0, 1, 2, 3, 4]) assert.equal(find(day(n), '周末作业'), undefined, `weekday ${n}`);
  assert.deepEqual(pick(find(day(5), '周末作业')), { is_optional: true, week_days_left: 2, weekly_remaining_times: 1 });
  assert.deepEqual(pick(find(day(6), '周末作业')), { is_optional: false, week_days_left: 1, weekly_remaining_times: 1 });

  tasksService.completeDailyTask(find(day(5), '周末作业').id);
  // Done on Saturday: Sunday's target is met, so the task is hidden.
  assert.equal(find(day(6), '周末作业'), undefined);
});

test('weekly targets must fit the allowed days', async t => {
  const { ctx, tasksService } = await fixture(t);
  const create = payload => ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '周末作业', subject: '语文', schedule_type: 'weekly_times', ...payload } });
  assert.equal((await create({ weekly_target_times: 3, days_of_week: [6, 0] })).statusCode, 400);
  assert.equal((await create({ weekly_target_times: 1, days_of_week: [] })).statusCode, 400);
  assert.equal((await create({ weekly_target_times: 3, days_of_week: [6, 6, 0] })).statusCode, 400);
  const deduped = (await create({ weekly_target_times: 2, days_of_week: [6, 6, 0] })).json();
  assert.deepEqual(deduped.days_of_week, [6, 0]);
  assert.throws(() => tasksService.updateTemplate(deduped.id, { title: '不应保存', weekly_target_times: 3, days_of_week: [6, 6, 0] }), error => error.status === 400);
  assert.equal(tasksService.getTemplate(deduped.id).title, '周末作业');
  const ok = (await create({ weekly_target_times: 2, days_of_week: [6, 0] })).json();
  assert.deepEqual(ok.days_of_week, [6, 0]);
  assert.throws(() => tasksService.updateTemplate(ok.id, { days_of_week: [0] }), { status: 400, message: '每周目标次数不能超过可完成的天数' });
  assert.equal(tasksService.updateTemplate(ok.id, { days_of_week: [0], weekly_target_times: 1 }).weekly_target_times, 1);
});

test('unopened weekly deadlines break streaks, while early completion and paused deadlines do not', async t => {
  const { ctx, child, tasksService, rewardsService, day, backdateAll } = await fixture(t);
  const sunday = tasksService.createTemplate({ title: '周日任务', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [0] });
  backdateAll();
  for (const n of [-15, -1]) tasksService.completeDailyTask(tasksService.getDailyTasks(child.id, day(n))[0].id);
  // Two completed Sundays with an unopened, missed Sunday in between.
  const first = day(-15), missed = day(-8), last = day(-1);
  assert.equal(rewardsService.getCurrentStreak(child.id, last), 1);
  assert.equal(tasksService.restDayChecker(child.id, first, last)(missed), false);
  ctx.app.services.periodsService.createPeriod(child.id, { name: '休息', start_date: missed, end_date: missed, paused_template_ids: [sunday.id] });
  assert.equal(rewardsService.getCurrentStreak(child.id, last), 2);
  ctx.app.services.periodsService.deletePeriod(ctx.app.services.periodsService.listPeriods(child.id)[0].id);
  // Completing the missed week's goal on Saturday means Sunday is a rest day.
  tasksService.updateTemplate(sunday.id, { days_of_week: [6, 0] });
  tasksService.completeDailyTask(tasksService.getDailyTasks(child.id, day(-9))[0].id);
  assert.equal(rewardsService.getCurrentStreak(child.id, last), 3);
  assert.equal(tasksService.restDayChecker(child.id, first, last)(missed), true);
});

test('weekly completion owes a weekend task only once its days can no longer be used', async t => {
  const { child, tasksService, statsService, day, backdateAll, find } = await fixture(t);
  tasksService.createTemplate({ title: '周末作业', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [6, 0] });
  backdateAll();
  const asOf = n => Object.fromEntries(statsService.getWeeklyCompletion(child.id, day(0), day(6), day(n)).items.map(i => [i.title, [i.completed, i.total]]));

  assert.deepEqual(asOf(4), {});                       // Friday: both weekend days still ahead
  assert.deepEqual(asOf(5), {});                       // Saturday: Sunday is still available
  assert.deepEqual(asOf(6), { 周末作业: [0, 1] });      // Sunday: now due and missed
  tasksService.completeDailyTask(find(day(5), '周末作业').id);
  assert.deepEqual(asOf(5), { 周末作业: [1, 1] });      // done early counts
});

test('weekends without tasks are rest days that neither count nor break the streak', async t => {
  const { ctx, child, tasksService, rewardsService, day, backdateAll, find } = await fixture(t);
  tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [1, 2, 3, 4, 5] });
  backdateAll();
  for (const n of [3, 4, 7]) tasksService.completeDailyTask(find(day(n), '口算').id);   // Thu, Fri, next Mon

  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 3);
  // A missed weekday still breaks it.
  ctx.db.prepare('DELETE FROM daily_tasks WHERE date = ?').run(day(3));
  ctx.db.prepare('DELETE FROM point_logs WHERE child_id = ? AND daily_task_id NOT IN (SELECT id FROM daily_tasks)').run(child.id);
  tasksService.getDailyTasks(child.id, day(3));
  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 2);

  // A weekend with a flexible weekly task left undone is still a rest day.
  tasksService.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  backdateAll();
  for (const n of [5, 6]) tasksService.getDailyTasks(child.id, day(n));
  // Saturday is a rest day (reading still has Sunday), but Sunday owed the reading and it was missed.
  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 1);
});

function pick(task) {
  return { is_optional: task.is_optional, week_days_left: task.week_days_left, weekly_remaining_times: task.weekly_remaining_times };
}
