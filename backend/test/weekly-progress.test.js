const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '小明' } })).json();
  const { tasksService, rewardsService, statsService } = ctx.app.services;
  // A fully past week keeps day-of-week rules deterministic.
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  const tasksOn = date => tasksService.getDailyTasks(child.id, date);
  const find = (date, title) => tasksOn(date).find(task => task.title === title);
  const complete = (date, title) => tasksService.completeDailyTask(find(date, title).id);
  return { ctx, child, tasksService, rewardsService, statsService, day, tasksOn, find, complete };
}

test('weekly tasks are flexible while there is slack and required once times left reach days left', async t => {
  const { tasksService, day, find, complete } = await fixture(t);
  tasksService.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 3 });

  // Monday: 3 times left over 7 days.
  assert.deepEqual(pick(find(day(0), '阅读')), { is_optional: true, week_days_left: 7, weekly_remaining_times: 3 });
  // Thursday with nothing done: 3 times over 4 days still has slack.
  assert.equal(find(day(3), '阅读').is_optional, true);
  // Friday with nothing done: 3 times over 3 days leaves no slack.
  assert.deepEqual(pick(find(day(4), '阅读')), { is_optional: false, week_days_left: 3, weekly_remaining_times: 3 });

  // Completing Friday leaves 2 times over Saturday and Sunday: required again.
  complete(day(4), '阅读');
  assert.equal(find(day(5), '阅读').is_optional, false);
  // Friday's own classification is based only on earlier days, so it does not change.
  assert.equal(find(day(4), '阅读').is_optional, false);
  assert.equal(find(day(5), '阅读').weekly_remaining_times, 2);
});

test('skipping a flexible weekly task keeps the day all done, but skipping a required one does not', async t => {
  const { tasksService, rewardsService, statsService, child, day, tasksOn, complete } = await fixture(t);
  tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  tasksService.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 3 });

  for (const n of [0, 4, 5, 6]) tasksOn(day(n));
  complete(day(0), '口算');                      // Monday: reading is flexible and skipped
  complete(day(4), '口算');                      // Friday: reading is required (3 left, 3 days) and skipped
  complete(day(5), '阅读');                      // Saturday: only the bonus-free reading done, 口算 skipped

  const history = Object.fromEntries(statsService.getHistory(child.id, day(0), day(6)).map(d => [d.date, d]));
  assert.deepEqual(summary(history[day(0)]), { total_tasks: 1, completed_tasks: 1, all_done: true });
  assert.deepEqual(summary(history[day(4)]), { total_tasks: 2, completed_tasks: 1, all_done: false });
  assert.deepEqual(summary(history[day(5)]), { total_tasks: 2, completed_tasks: 1, all_done: false });
  assert.deepEqual(summary(history[day(6)]), { total_tasks: 2, completed_tasks: 0, all_done: false });
  // Days the app was never opened have nothing to count.
  assert.deepEqual(summary(history[day(1)]), { total_tasks: 0, completed_tasks: 0, all_done: false });
  assert.equal(rewardsService.getAllDoneDaysCount(child.id), 1);

  // A completed flexible task counts as a bonus without making the day harder.
  complete(day(6), '口算');
  complete(day(6), '阅读');
  assert.deepEqual(summary(statsService.getHistory(child.id, day(6), day(6))[0]), { total_tasks: 2, completed_tasks: 2, all_done: true });
  assert.equal(rewardsService.getAllDoneDaysCount(child.id), 2);
  assert.equal(statsService.getWeeklySummary(child.id, day(6)).current_week.daily_breakdown.filter(d => d.all_done).length, 2);
});

test('a day with only flexible weekly tasks and nothing completed is not all done', async t => {
  const { tasksService, rewardsService, child, day, tasksOn, complete } = await fixture(t);
  tasksService.createTemplate({ title: '跳绳', subject: '其他', schedule_type: 'weekly_times', weekly_target_times: 2 });
  tasksOn(day(0));
  assert.equal(rewardsService.getAllDoneDaysCount(child.id), 0);
  complete(day(0), '跳绳');
  assert.equal(rewardsService.getAllDoneDaysCount(child.id), 1);
});

test('the all-done badge unlocks when only flexible weekly tasks are left today', async t => {
  const { ctx, child } = await fixture(t);
  await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] } });
  // Target 1 is flexible every day except Sunday, when one day is left.
  await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 1 } });
  const tasks = (await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}` })).json();
  const reading = tasks.find(task => task.title === '阅读');
  const sunday = new Date(`${getTodayDate()}T00:00:00Z`).getUTCDay() === 0;
  assert.equal(reading.is_optional, !sunday);

  const result = (await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${tasks.find(task => task.title === '口算').id}/complete` })).json();
  assert.equal(result.new_badges.some(badge => badge.key === 'all_done_once'), !sunday);
  const stats = (await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/stats` })).json();
  assert.deepEqual([stats.today_total_tasks, stats.today_completed_tasks], sunday ? [2, 1] : [1, 1]);
});

test('counting all-done days uses a constant number of queries however much history exists', async t => {
  const { ctx, tasksService, rewardsService, child } = await fixture(t);
  tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  tasksService.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 3 });
  const today = getTodayDate();
  let expected = 0;
  const prepare = ctx.db.prepare.bind(ctx.db);
  const countQueries = () => {
    let queries = 0;
    ctx.db.prepare = sql => { queries++; return prepare(sql); };
    try {
      assert.equal(rewardsService.getAllDoneDaysCount(child.id), expected);
    } finally {
      ctx.db.prepare = prepare;
    }
    return queries;
  };
  let queriesWithShortHistory;
  for (let n = 120; n >= 1; n--) {
    const date = shiftDate(today, -n);
    for (const task of tasksService.getDailyTasks(child.id, date)) {
      if (task.title === '口算' && n % 5) tasksService.completeDailyTask(task.id);
    }
    // Reading is never done, so it becomes required (and unmet) from Friday to Sunday.
    if (n % 5 && [1, 2, 3, 4].includes(new Date(`${date}T00:00:00Z`).getUTCDay())) expected++;
    if (n === 100) queriesWithShortHistory = countQueries();
  }

  const queries = countQueries();
  assert.equal(queries, queriesWithShortHistory, '120 days of history must not need more queries than 20');
  // The school calendar (holidays and make-up days) and tasks carried over a break add one query each.
  assert.ok(queries <= 8, `expected a handful of queries, got ${queries}`);
});

function pick(task) {
  return { is_optional: task.is_optional, week_days_left: task.week_days_left, weekly_remaining_times: task.weekly_remaining_times };
}

function summary(day) {
  return { total_tasks: day.total_tasks, completed_tasks: day.completed_tasks, all_done: day.all_done };
}
