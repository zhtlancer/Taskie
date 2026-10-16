const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, tasksService, periodsService, timeStatsService } = ctx.app.services;
  const child = childrenService.createChild({ name: '小明' });
  // Last week, so every day is in the past; the week before is the one compared with.
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  const backdate = `${day(-30)}T04:00:00.000Z`;
  ctx.db.prepare('UPDATE children SET created_at = ?').run(backdate);
  const template = data => {
    const created = tasksService.createTemplate({ subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], ...data });
    ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run(backdate, created.id);
    return created;
  };
  // Done on a date with a duration (seconds), none (null) or the timer's (undefined, which never ran).
  const doneOn = (date, title, duration_seconds) => {
    const task = tasksService.getDailyTasks(child.id, date).find(t => t.title === title);
    return tasksService.completeDailyTask(task.id, duration_seconds === undefined ? {} : { duration_seconds }).task;
  };
  const stats = (from = day(0), to = day(6)) => timeStatsService.stats(child.id, from, to);
  return { ctx, child, tasksService, periodsService, day, template, doneOn, stats };
}

test('averages use recorded times only; totals add an estimate from tasks with at least three records', async t => {
  const { template, doneOn, stats, day } = await fixture(t);
  template({ title: '口算', track_time: true, expected_minutes: 15 });
  template({ title: '阅读', subject: '语文', track_time: true });
  template({ title: '整理书包', subject: '其他' });
  [600, 720, 960, null, undefined].forEach((seconds, n) => doneOn(day(n), '口算', seconds));
  doneOn(day(0), '阅读', 1200);
  doneOn(day(1), '阅读', null);
  doneOn(day(0), '整理书包');

  const result = stats();
  const oral = result.tasks.find(task => task.title === '口算');
  assert.deepEqual([oral.sessions, oral.recorded, oral.average_seconds, oral.min_seconds, oral.max_seconds], [5, 3, 760, 600, 960]);
  assert.deepEqual([oral.expected_minutes, oral.judged, oral.over_expected], [15, 3, 1]);
  assert.deepEqual(oral.points, [{ date: day(0), seconds: 600 }, { date: day(1), seconds: 720 }, { date: day(2), seconds: 960 }]);
  const reading = result.tasks.find(task => task.title === '阅读');
  assert.deepEqual([reading.sessions, reading.recorded, reading.average_seconds], [2, 1, 1200]);
  assert.equal(result.tasks.some(task => task.title === '整理书包'), false, 'untimed tasks are not in time stats');

  // Two 口算 times are estimated at its average; 阅读 has too few records to estimate.
  assert.deepEqual([result.summary.recorded_seconds, result.summary.missing, result.summary.estimated_missing, result.summary.estimated_seconds],
    [3480, 3, 2, 3480 + 2 * 760]);
  assert.deepEqual([result.days[0].recorded_seconds, result.days[0].by_subject], [1800, { 数学: 600, 语文: 1200 }]);
  assert.deepEqual([result.days[3].recorded_seconds, result.days[3].missing, result.days[3].estimated_seconds], [0, 1, 760]);
  assert.deepEqual(result.subjects.map(s => [s.subject, s.recorded_seconds, s.estimated_seconds]), [['数学', 2280, 3800], ['语文', 1200, 1200]]);
});

test('the period before, of the same length, is compared with', async t => {
  const { template, doneOn, stats, day } = await fixture(t);
  template({ title: '口算', track_time: true });
  doneOn(day(-7), '口算', 900);
  doneOn(day(-6), '口算', 900);
  doneOn(day(0), '口算', 600);
  const result = stats();
  assert.deepEqual([result.previous.from, result.previous.to, result.previous.recorded_seconds], [day(-7), day(-1), 1800]);
  assert.deepEqual([result.tasks[0].average_seconds, result.tasks[0].previous_average_seconds], [600, 900]);
});

test('finish times are the day’s last completion in the evening, past midnight included, never later backfills', async t => {
  const { ctx, template, doneOn, stats, day } = await fixture(t);
  template({ title: '口算' });
  template({ title: '阅读', subject: '语文' });
  const at = (task, iso) => ctx.db.prepare('UPDATE daily_tasks SET completed_at = ? WHERE id = ?').run(iso, task.id);
  at(doneOn(day(0), '口算'), `${day(0)}T11:00:00.000Z`);   // 19:00 in Shanghai
  at(doneOn(day(0), '阅读'), `${day(0)}T12:30:00.000Z`);   // 20:30
  at(doneOn(day(1), '口算'), `${day(1)}T16:30:00.000Z`);   // 00:30 the night after Tuesday
  at(doneOn(day(2), '口算'), `${day(5)}T12:00:00.000Z`);   // a backfill on Saturday
  const result = stats();
  assert.deepEqual(result.days.slice(0, 3).map(d => d.finished_at), ['20:30', '00:30', null]);
  // (20:30 + 24:30) / 2 = 22:30
  assert.deepEqual([result.summary.finish_days, result.summary.finish_average, result.summary.finish_latest, result.summary.finish_latest_date],
    [2, '22:30', '00:30', day(1)]);

  // Today is not over: its latest completion so far shows on the day but stays out of the averages.
  const today = getTodayDate();
  at(doneOn(today, '口算'), new Date().toISOString());
  const withToday = stats(day(0), today);
  assert.notEqual(withToday.days.at(-1).finished_at, null);
  assert.deepEqual([withToday.summary.finish_days, withToday.summary.finish_average], [2, '22:30']);
});

test('long-term tasks give time per page, ignoring entries from before timing was used', async t => {
  const { ctx, child, periodsService, stats, day } = await fixture(t);
  const book = periodsService.createGoal(child.id, { title: '西游记', subject: '语文', mode: 'progress', unit: '页', total_amount: 200, start_date: day(-30), track_time: true });
  const log = (n, amount, duration_seconds) => {
    const { log_id } = periodsService.logProgress(book.id, { amount, date: day(n), duration_seconds }, { role: 'parent' });
    ctx.db.prepare('UPDATE period_task_logs SET created_at = ? WHERE id = ?').run(`${day(n)}T12:00:00.000Z`, log_id);
  };
  log(0, 10, null);   // before the first timed entry: not counted as missing
  log(1, 10, 600);
  log(2, 20, 900);
  log(3, 5, null);    // after: missing
  const result = stats();
  assert.deepEqual(result.goals, [{ id: book.id, title: '西游记', unit: '页', seconds_per_unit: 50, previous_seconds_per_unit: null, amount: 30,
    points: [{ date: day(1), seconds_per_unit: 60 }, { date: day(2), seconds_per_unit: 45 }] }]);
  const entry = result.tasks.find(task => task.kind === 'goal');
  assert.deepEqual([entry.sessions, entry.recorded, entry.average_seconds], [3, 2, 750]);
  assert.deepEqual([result.summary.recorded_seconds, result.summary.missing], [1500, 1]);
});

test('children read their own time stats only, over at most 366 days', async t => {
  const { ctx, child } = await fixture(t);
  const login = async who => ({ authorization: `Bearer ${(await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: who.id } })).json().token}` });
  const sister = ctx.app.services.childrenService.createChild({ name: '小红' });
  const headers = await login(child);
  const own = await ctx.rawInject({ method: 'GET', url: `/api/children/${child.id}/time-stats`, headers });
  assert.equal(own.statusCode, 200);
  assert.deepEqual([own.json().from, own.json().to, own.json().days.length], [shiftDate(getTodayDate(), -6), getTodayDate(), 7]);
  assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/children/${sister.id}/time-stats`, headers })).statusCode, 403);
  const today = getTodayDate();
  for (const query of [`from=${today}&to=${shiftDate(today, -1)}`, `from=${shiftDate(today, -366)}&to=${today}`, 'from=x&to=y']) {
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/time-stats?${query}` })).statusCode, 400, query);
  }
});
