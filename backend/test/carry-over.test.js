const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, tasksService, periodsService, statsService, rewardsService, scheduleService } = ctx.app.services;
  const child = childrenService.createChild({ name: '伊伊' });
  // Last week's Monday: every day of last week is in the past.
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  const backdate = `${day(-30)}T04:00:00.000Z`;
  ctx.db.prepare('UPDATE children SET created_at = ?').run(backdate);
  const template = data => {
    const created = tasksService.createTemplate({ subject: '数学', days_of_week: [1, 2, 3, 4, 5], ...data });
    ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run(backdate, created.id);
    return created;
  };
  const board = date => tasksService.getDailyTasks(child.id, date);
  const find = (date, title) => board(date).find(task => task.title === title);
  const history = (from, to = from) => statsService.getHistory(child.id, from, to);
  const holiday = (start_date, end_date, extra = {}) => periodsService.createPeriod(child.id, { name: '假期', start_date, end_date, ...extra });
  return { ctx, child, tasksService, periodsService, statsService, rewardsService, scheduleService, day, template, board, find, history, holiday };
}

test('school days are weekdays outside holidays plus make-up days; a break carries a task to its last day', async t => {
  const { child, tasksService, periodsService, day, holiday } = await fixture(t);
  let calendar = tasksService.calendarFor(child.id);
  assert.deepEqual([calendar.carryUntil(day(4)), calendar.carryUntil(day(3)), calendar.carryUntil(day(5))], [day(6), day(3), day(5)]);

  // A holiday the next week stretches Friday's break to the Sunday after it.
  holiday(day(7), day(11));
  calendar = tasksService.calendarFor(child.id);
  assert.deepEqual([calendar.isSchoolDay(day(8)), calendar.carryUntil(day(4))], [false, day(13)]);

  // A make-up Saturday ends the break early and follows Monday's schedule; one inside a holiday
  // is a school day too.
  periodsService.createMakeupDay(child.id, { date: day(12), acts_as: 1, note: '国庆调休' });
  periodsService.createMakeupDay(child.id, { date: day(9), acts_as: 3 });
  calendar = tasksService.calendarFor(child.id);
  assert.deepEqual([calendar.isSchoolDay(day(12)), calendar.weekdayOf(day(12)), calendar.isSchoolDay(day(9)), calendar.holidayOn(day(9))], [true, 1, true, null]);
  assert.deepEqual([calendar.carryUntil(day(4)), calendar.carryUntil(day(9)), calendar.carryUntil(day(12))], [day(8), day(11), day(13)]);
});

test("Friday's task may wait for the weekend: optional until Sunday, credited to Friday when done", async t => {
  const { ctx, child, tasksService, rewardsService, day, template, board, find, history } = await fixture(t);
  template({ title: '口算', carry_over: true, points: 10 });
  template({ title: '学校记事', subject: '其他', points: 5 });

  const friday = find(day(4), '口算');
  assert.deepEqual([friday.is_optional, friday.due_date], [true, day(6)]);
  assert.deepEqual([find(day(4), '学校记事').is_optional, find(day(4), '学校记事').due_date], [false, null]);
  assert.equal(find(day(3), '口算').is_optional, false, 'Thursday is followed by school');
  tasksService.completeDailyTask(find(day(4), '学校记事').id);
  // Friday is all done without the task that may wait.
  assert.deepEqual([history(day(4))[0].total_tasks, history(day(4))[0].all_done], [1, true]);

  // It comes along on Saturday (optional) and Sunday (its last day).
  const saturday = board(day(5));
  assert.deepEqual(saturday.map(t => [t.title, t.carried_from, t.due_date, t.is_optional]), [['口算', day(4), day(6), true]]);
  const sunday = find(day(6), '口算');
  assert.deepEqual([sunday.id, sunday.is_optional], [friday.id, false]);

  // Done (here by the parent, any time): points and history go to Friday.
  const done = tasksService.completeDailyTask(friday.id);
  assert.equal(done.points_earned, 10);
  assert.equal(ctx.db.prepare('SELECT activity_date FROM point_logs WHERE daily_task_id = ?').get(friday.id).activity_date, day(4));
  assert.deepEqual([history(day(4))[0].completed_tasks, history(day(4))[0].total_tasks], [2, 2]);
  assert.deepEqual(history(day(5), day(6)).map(d => d.total_tasks), [0, 0]);
  // Monday done too: Saturday and Sunday are rest days between Friday and Monday.
  tasksService.completeDailyTask(find(day(7), '学校记事').id);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 2);
});

test('a carried task not done by its last day is missed on that day, breaking all-done and the streak', async t => {
  const { child, tasksService, rewardsService, day, template, find, history } = await fixture(t);
  template({ title: '口算', carry_over: true });
  template({ title: '学校记事', subject: '其他' });
  const friday = find(day(4), '口算');
  tasksService.completeDailyTask(find(day(4), '学校记事').id);
  find(day(5), '口算');
  const [sunday] = history(day(6));
  assert.deepEqual([sunday.total_tasks, sunday.completed_tasks, sunday.all_done], [1, 0, false]);
  assert.deepEqual(sunday.tasks.map(t => [t.id, t.carried_from, t.due_date]), [[friday.id, day(4), day(6)]]);
  tasksService.completeDailyTask(find(day(7), '学校记事').id);
  // Sunday owed the task and nothing was done: the streak starts again on Monday.
  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 1);
});

test('weekly completion owes a carried task only once its deadline has passed', async t => {
  const { child, tasksService, statsService, day, template, find } = await fixture(t);
  template({ title: '口算', carry_over: true });
  for (const n of [0, 1, 2, 3]) tasksService.completeDailyTask(find(day(n), '口算').id);
  const completion = asOf => statsService.getWeeklyCompletion(child.id, day(0), day(6), asOf).items.map(i => [i.title, i.completed, i.total]);
  // Friday never opened: its task is projected, but not owed before its last day, Sunday (which,
  // like any day's own tasks, owes it as of that day).
  assert.deepEqual(completion(day(5)), [['口算', 4, 4]]);
  assert.deepEqual(completion(day(6)), [['口算', 4, 5]]);
  assert.deepEqual(completion(day(7)), [['口算', 4, 5]]);
  // Opened and done on Saturday: counted at once.
  tasksService.completeDailyTask(find(day(4), '口算').id);
  assert.deepEqual(completion(day(5)), [['口算', 5, 5]]);
});

test('a holiday carries a task across weeks; a make-up day follows its weekday even inside a paused holiday', async t => {
  const { child, tasksService, periodsService, scheduleService, statsService, day, template, find, board, holiday } = await fixture(t);
  const oral = template({ title: '口算', carry_over: true });
  template({ title: '周一晨读', subject: '语文', days_of_week: [1] });
  holiday(day(7), day(13), { paused_template_ids: [oral.id] });
  periodsService.createMakeupDay(child.id, { date: day(12), acts_as: 1 });
  scheduleService.createTimetable(child.id, { name: '本学期', start_date: day(-7), end_date: day(30),
    slots: [{ id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' }],
    lessons: [{ slot_id: 's1', weekday: 1, subject: '语文' }, { slot_id: 's1', weekday: 6, subject: '周六兴趣' }] });

  // Friday's task waits until the make-up Saturday ends the break.
  const friday = find(day(4), '口算');
  assert.equal(friday.due_date, day(11));
  assert.deepEqual(board(day(9)).map(t => [t.title, t.carried_from, t.is_optional]), [['口算', day(4), true]]);
  assert.equal(statsService.getWeeklyCompletion(child.id, day(0), day(6), day(9)).items.find(i => i.title === '口算').total, 4);

  // The make-up Saturday follows Monday: Monday's tasks and lessons, the paused one included.
  assert.deepEqual(board(day(12)).map(t => t.title).sort(), ['口算', '周一晨读']);
  const [saturday] = scheduleService.schedule(child.id, day(12), day(12));
  assert.deepEqual([saturday.holiday, saturday.makeup.acts_as, saturday.school.map(s => s.subject)], [null, 1, ['语文']]);
  assert.equal(scheduleService.schedule(child.id, day(9), day(9))[0].holiday, '假期');
});

test('one-off tasks may have a due date; they stay open until then', async t => {
  const { ctx, child, day, board, history } = await fixture(t);
  const add = payload => ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/adhoc-tasks`, payload: { title: '手抄报', subject: '其他', date: day(1), ...payload } });
  for (const due_date of [day(0), 'friday', shiftDate(day(1), 121)]) assert.equal((await add({ due_date })).statusCode, 400, due_date);
  const poster = (await add({ due_date: day(3) })).json();
  assert.deepEqual([poster.due_date, poster.is_optional], [day(3), true]);
  assert.equal((await add({ title: '当天交', due_date: day(1) })).json().due_date, null, 'the same day means no extra time');
  assert.deepEqual(board(day(2)).filter(t => t.carried_from).map(t => [t.title, t.is_optional]), [['手抄报', true]]);
  assert.equal(board(day(3)).find(t => t.title === '手抄报').is_optional, false);
  assert.deepEqual(history(day(3))[0].tasks.map(t => [t.title, t.carried_from]), [['手抄报', day(1)]]);
});

test('children may act on a carried task until its deadline, and only then', async t => {
  const { ctx, child, tasksService, periodsService, day, template } = await fixture(t);
  const today = getTodayDate(), yesterday = shiftDate(today, -1);
  // Yesterday and the day after tomorrow (make-up) school days, today and tomorrow a holiday:
  // yesterday's task waits until tomorrow, whatever weekday today is.
  periodsService.createMakeupDay(child.id, { date: yesterday, acts_as: 3 });
  periodsService.createMakeupDay(child.id, { date: shiftDate(today, 2), acts_as: 3 });
  periodsService.createPeriod(child.id, { name: '小长假', start_date: today, end_date: shiftDate(today, 1) });
  template({ title: '口算', days_of_week: [0, 1, 2, 3, 4, 5, 6], carry_over: true, track_time: true, points: 10 });
  template({ title: '学校记事', subject: '其他', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const old = tasksService.getDailyTasks(child.id, yesterday);
  const oral = old.find(t => t.title === '口算');
  const notes = old.find(t => t.title === '学校记事');
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  const asChild = (method, url, payload) => ctx.rawInject({ method, url, payload, headers: { authorization: `Bearer ${login.token}` } });

  const todayBoard = (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json();
  assert.deepEqual(todayBoard.filter(t => t.carried_from).map(t => [t.id, t.due_date]), [[oral.id, shiftDate(today, 1)]]);
  assert.equal((await asChild('POST', `/api/daily-tasks/${notes.id}/complete`)).statusCode, 403, 'yesterday’s task without carry-over');
  assert.equal((await asChild('POST', `/api/daily-tasks/${oral.id}/timer/start`)).statusCode, 200);
  const done = await asChild('POST', `/api/daily-tasks/${oral.id}/complete`, { duration_seconds: 600 });
  assert.deepEqual([done.statusCode, done.json().points_earned], [200, 10]);
  // Done today, it stays on today's board as done.
  assert.equal((await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(t => t.id === oral.id).is_completed, true);
  assert.equal((await asChild('PUT', `/api/daily-tasks/${oral.id}/duration`, { duration_seconds: 900 })).statusCode, 200);
  assert.equal((await asChild('POST', `/api/daily-tasks/${oral.id}/uncomplete`)).statusCode, 200);
  assert.equal((await asChild('POST', `/api/daily-tasks/${oral.id}/skip`, { reason: '老师说不用交' })).statusCode, 201);

  // Past its deadline a carried task is closed to the child.
  const longAgo = tasksService.getDailyTasks(child.id, day(4)).find(t => t.title === '口算');
  assert.equal((await asChild('POST', `/api/daily-tasks/${longAgo.id}/complete`)).statusCode, 403);
});

test('carry-over is a fixed-day template setting, applied to tasks still to do when changed', async t => {
  const { ctx, child, tasksService, day, template, find } = await fixture(t);
  const oral = template({ title: '口算' });
  assert.equal(find(day(4), '口算').due_date, null);
  tasksService.completeDailyTask(find(day(3), '口算').id);
  const updated = tasksService.updateTemplate(oral.id, { carry_over: true });
  assert.equal(updated.carry_over, true);
  assert.equal(find(day(4), '口算').due_date, day(6), 'the open Friday task follows');
  assert.equal(tasksService.updateTemplate(oral.id, { schedule_type: 'weekly_times', weekly_target_times: 2 }).carry_over, false);
  const weekly = await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 2, carry_over: true } });
  assert.equal(weekly.json().carry_over, false);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '错', subject: '语文', carry_over: 'yes' } })).statusCode, 400);
  assert.equal(child.name, '伊伊');
});

test('make-up days are managed by parents only', async t => {
  const { ctx, child, day } = await fixture(t);
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  const headers = { authorization: `Bearer ${login.token}` };
  const url = `/api/children/${child.id}/makeup-days`;
  assert.equal((await ctx.rawInject({ method: 'POST', url, headers, payload: { date: day(5), acts_as: 1 } })).statusCode, 403);
  for (const payload of [{ date: day(5) }, { date: day(5), acts_as: 7 }, { date: 'x', acts_as: 1 }]) {
    assert.equal((await ctx.app.inject({ method: 'POST', url, payload })).statusCode, 400, JSON.stringify(payload));
  }
  const created = await ctx.app.inject({ method: 'POST', url, payload: { date: day(5), acts_as: 5, note: '调休' } });
  assert.equal(created.statusCode, 201);
  assert.equal((await ctx.app.inject({ method: 'POST', url, payload: { date: day(5), acts_as: 1 } })).statusCode, 409);
  assert.deepEqual((await ctx.rawInject({ method: 'GET', url, headers })).json().map(m => [m.date, m.acts_as]), [[day(5), 5]]);
  assert.equal((await ctx.rawInject({ method: 'DELETE', url: `/api/makeup-days/${created.json().id}`, headers })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/makeup-days/${created.json().id}` })).statusCode, 200);
});
