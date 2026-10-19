const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
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
  // A make-up day the parent set before it came; the service only accepts today or later.
  const makeup = (date, acts_as, note = null) => ctx.db.prepare('INSERT INTO makeup_days (id, child_id, date, acts_as, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), child.id, date, acts_as, note, new Date().toISOString());
  return { ctx, child, tasksService, periodsService, statsService, rewardsService, scheduleService, day, template, board, find, history, holiday, makeup };
}

test('school days are weekdays outside holidays plus make-up days; a break carries a task to its last day', async t => {
  const { child, tasksService, day, holiday, makeup } = await fixture(t);
  let calendar = tasksService.calendarFor(child.id);
  assert.deepEqual([calendar.carryUntil(day(4)), calendar.carryUntil(day(3)), calendar.carryUntil(day(5))], [day(6), day(3), day(5)]);

  // A holiday the next week stretches Friday's break to the Sunday after it.
  holiday(day(7), day(11));
  calendar = tasksService.calendarFor(child.id);
  assert.deepEqual([calendar.isSchoolDay(day(8)), calendar.carryUntil(day(4))], [false, day(13)]);

  // A make-up Saturday ends the break early and follows Monday's schedule; one inside a holiday
  // is a school day too.
  makeup(day(12), 1, '国庆调休');
  makeup(day(9), 3);
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
  const { child, tasksService, scheduleService, statsService, day, template, find, board, holiday, makeup } = await fixture(t);
  const oral = template({ title: '口算', carry_over: true });
  template({ title: '周一晨读', subject: '语文', days_of_week: [1] });
  holiday(day(7), day(13), { paused_template_ids: [oral.id] });
  makeup(day(12), 1);
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
  const { ctx, child, tasksService, periodsService, day, template, makeup } = await fixture(t);
  const today = getTodayDate(), yesterday = shiftDate(today, -1);
  // Yesterday and the day after tomorrow (make-up) school days, today and tomorrow a holiday:
  // yesterday's task waits until tomorrow, whatever weekday today is.
  makeup(yesterday, 3);
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

test('make-up days are managed by parents only, from today on', async t => {
  const { ctx, child, makeup } = await fixture(t);
  const day = n => shiftDate(getTodayDate(), n - 2); // day(5) is three days ahead
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

  // Past days are recorded history: no new make-up day there, and an old one stays.
  const yesterday = shiftDate(getTodayDate(), -1);
  const past = await ctx.app.inject({ method: 'POST', url, payload: { date: yesterday, acts_as: 1 } });
  assert.equal(past.statusCode, 400);
  assert.match(past.body, /今天及以后/);
  assert.equal((await ctx.app.inject({ method: 'POST', url, payload: { date: getTodayDate(), acts_as: 1 } })).statusCode, 201);
  makeup(yesterday, 1);
  const old = (await ctx.app.inject({ method: 'GET', url })).json().find(m => m.date === yesterday);
  const removal = await ctx.app.inject({ method: 'DELETE', url: `/api/makeup-days/${old.id}` });
  assert.equal(removal.statusCode, 400);
  assert.match(removal.body, /不能删除/);
  assert.ok((await ctx.app.inject({ method: 'GET', url })).json().some(m => m.id === old.id));
});

test('an unopened Friday task appears on the weekend once, with a real actionable task id', async t => {
  const { ctx, child, tasksService, day, template, board, history } = await fixture(t);
  template({ title: '周五口算', days_of_week: [5], carry_over: true, track_time: true });
  const [saturday] = board(day(5));
  assert.ok(saturday, 'Friday need not have been opened');
  assert.deepEqual([saturday.date, saturday.carried_from, saturday.due_date, saturday.is_optional], [day(4), day(4), day(6), true]);
  assert.equal(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(saturday.id).id, saturday.id);
  assert.equal(board(day(5))[0].id, saturday.id);
  assert.equal(board(day(6))[0].id, saturday.id);
  assert.equal(board(day(6))[0].is_optional, false);
  tasksService.completeDailyTask(saturday.id, { duration_seconds: 600 });
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks WHERE child_id = ?').get(child.id).n, 1);
  assert.deepEqual([history(day(4))[0].completed_tasks, history(day(4))[0].points_earned], [1, 10]);
  assert.equal(history(day(6))[0].total_tasks, 0);
});

test('unopened carried tasks are missed at the deadline and break the streak without history writes', async t => {
  const { ctx, child, tasksService, rewardsService, statsService, day, template, find, history } = await fixture(t);
  template({ title: '周五口算', days_of_week: [5], carry_over: true });
  template({ title: '学校记事', days_of_week: [1, 4] });
  tasksService.completeDailyTask(find(day(3), '学校记事').id);
  tasksService.completeDailyTask(find(day(7), '学校记事').id);
  const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks').get().n;
  const [sunday] = history(day(6));
  assert.deepEqual([sunday.total_tasks, sunday.completed_tasks, sunday.all_done], [1, 0, false]);
  assert.deepEqual(sunday.tasks.map(task => [task.title, task.carried_from, task.due_date]), [['周五口算', day(4), day(6)]]);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(7)), 1);
  assert.equal(statsService.getWeeklyCompletion(child.id, day(0), day(6), day(7)).items.find(i => i.title === '周五口算').total, 1);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks').get().n, before, 'summary reads do not materialize projected tasks');
});

test('a child can discover, time and complete an unopened task from before the current holiday', async t => {
  const { ctx, child, periodsService, template, makeup } = await fixture(t);
  const today = getTodayDate();
  const yesterday = shiftDate(today, -1);
  makeup(yesterday, 3);
  periodsService.createMakeupDay(child.id, { date: shiftDate(today, 2), acts_as: 3 });
  periodsService.createPeriod(child.id, { name: '小长假', start_date: today, end_date: shiftDate(today, 1) });
  template({ title: '假前口算', days_of_week: [3], carry_over: true, track_time: true });
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  const request = (method, url, payload) => ctx.rawInject({ method, url, payload, headers: { authorization: `Bearer ${login.token}` } });
  const board = await request('GET', `/api/daily-tasks?child_id=${child.id}`);
  assert.equal(board.statusCode, 200);
  const task = board.json().find(row => row.carried_from === yesterday);
  assert.ok(task);
  assert.equal((await request('POST', `/api/daily-tasks/${task.id}/timer/start`)).statusCode, 200);
  const done = await request('POST', `/api/daily-tasks/${task.id}/complete`, { duration_seconds: 600 });
  assert.deepEqual([done.statusCode, done.json().points_earned], [200, 10]);
  assert.equal(ctx.db.prepare('SELECT activity_date FROM point_logs WHERE daily_task_id = ?').get(task.id).activity_date, yesterday);
  assert.equal((await request('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(row => row.id === task.id).is_completed, true);
});

test('opening a weekend preserves weekly obligations for the unopened source day without creating newer templates', async t => {
  const { ctx, child, statsService, day, template, board } = await fixture(t);
  template({ title: '可延后', days_of_week: [5], carry_over: true });
  template({ title: '当天要交', days_of_week: [5] });
  const later = template({ title: '周六才布置', days_of_week: [5] });
  ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run(`${day(5)}T04:00:00Z`, later.id);
  const obligations = () => statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6)).items.map(i => [i.title, i.total]).sort();
  const before = obligations();
  assert.deepEqual(before, [['可延后', 1], ['当天要交', 1]].sort());
  assert.deepEqual(board(day(5)).map(t => t.title), ['可延后']);
  assert.deepEqual(obligations(), before);
  assert.deepEqual(ctx.db.prepare('SELECT title FROM daily_tasks WHERE date = ? ORDER BY title').all(day(4)).map(t => t.title), ['可延后', '当天要交'].sort());
});

test('unopened holiday carries respect template creation, child assignment and holiday pauses', async t => {
  const { ctx, child, tasksService, day, template, board, holiday, history, makeup } = await fixture(t);
  const oral = template({ title: '周五口算', days_of_week: [5], carry_over: true });
  const paused = template({ title: '已暂停', days_of_week: [5], carry_over: true });
  const tooNew = template({ title: '后来才布置', days_of_week: [5], carry_over: true });
  ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run(`${day(5)}T04:00:00Z`, tooNew.id);
  const sibling = ctx.app.services.childrenService.createChild({ name: '妹妹' });
  template({ title: '妹妹的作业', days_of_week: [5], carry_over: true, child_ids: [sibling.id] });
  holiday(day(4), day(4), { paused_template_ids: [paused.id] });
  makeup(day(4), 5);
  // A school day inside a holiday is not paused; the following week extends its break.
  holiday(day(7), day(11));
  assert.deepEqual(board(day(8)).map(task => task.title).sort(), ['周五口算', '已暂停']);
  assert.equal(board(day(8)).find(task => task.template_id === oral.id).due_date, day(13));
  assert.equal(history(day(13))[0].total_tasks, 2);
});

test('adding and deleting a make-up day reconciles pending tasks but preserves completed and still-applicable tasks', async t => {
  const { ctx, child, tasksService, periodsService, template, board } = await fixture(t);
  const today = getTodayDate();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const actsAs = weekday === 1 ? 2 : 1;
  template({ title: '原星期未完成', days_of_week: [weekday] });
  template({ title: '原星期已完成', days_of_week: [weekday], track_time: true });
  template({ title: '调休任务', days_of_week: [actsAs] });
  template({ title: '每天都做', days_of_week: [0, 1, 2, 3, 4, 5, 6], track_time: true });
  const original = board(today);
  const removed = original.find(task => task.title === '原星期未完成');
  const completed = original.find(task => task.title === '原星期已完成');
  const unchanged = original.find(task => task.title === '每天都做');
  tasksService.completeDailyTask(completed.id, { duration_seconds: 600 });
  ctx.app.services.timersService.apply('task', unchanged.id, 'start');
  const makeup = periodsService.createMakeupDay(child.id, { date: today, acts_as: actsAs });
  assert.equal(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(removed.id), undefined, 'the obsolete task is revoked immediately');
  const changed = board(today);
  assert.deepEqual(changed.map(task => task.title).sort(), ['原星期已完成', '每天都做', '调休任务']);
  assert.equal(changed.find(task => task.id === completed.id).duration_seconds, 600);
  assert.equal(changed.find(task => task.id === unchanged.id).timer_running, true);
  const makeupTask = changed.find(task => task.title === '调休任务');
  periodsService.deleteMakeupDay(makeup.id);
  assert.equal(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(makeupTask.id), undefined);
  assert.deepEqual(board(today).map(task => task.title).sort(), ['原星期已完成', '原星期未完成', '每天都做']);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM point_logs WHERE daily_task_id = ?').get(completed.id).n, 1);
});
