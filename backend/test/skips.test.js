const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
  const child = await createChild('小明');
  const loginAs = async who => ({ authorization: `Bearer ${(await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: who.id } })).json().token}` });
  const headers = await loginAs(child);
  const asChild = (method, url, payload, h = headers) => ctx.rawInject({ method, url, headers: h, payload });
  const asParent = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const template = payload => asParent('POST', '/api/task-templates', { subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], ...payload });
  const todayTasks = async () => (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json();
  const taskId = async title => (await todayTasks()).find(task => task.title === title).id;
  const stats = async () => (await asParent('GET', `/api/children/${child.id}/stats`)).json();
  const { tasksService, statsService, rewardsService, skipsService } = ctx.app.services;
  // Past weeks for the streak and weekly completion: the child and templates existed long before.
  const lastMonday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(lastMonday, n);
  const backdateAll = () => {
    ctx.db.prepare('UPDATE children SET created_at = ?').run(familyInstant(day(-30)));
    ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(familyInstant(day(-30)));
  };
  const rowOn = (date, title) => tasksService.getDailyTasks(child.id, date).find(task => task.title === title);
  return { ctx, child, createChild, loginAs, headers, asChild, asParent, template, todayTasks, taskId, stats,
    tasksService, statsService, rewardsService, skipsService, day, backdateAll, rowOn, today: getTodayDate() };
}

test('a child asks to skip with a reason; the task counts until a parent approves, then the day is all done without it', async t => {
  const { child, asChild, asParent, template, todayTasks, taskId, stats, today } = await fixture(t);
  await template({ title: '口算', points: 10 });
  await template({ title: '阅读', subject: '语文', points: 5 });
  const oral = await taskId('口算');

  for (const reason of [undefined, '', '   ', '字'.repeat(51)]) {
    assert.equal((await asChild('POST', `/api/daily-tasks/${oral}/skip`, { reason })).statusCode, 400, String(reason));
  }
  const asked = await asChild('POST', `/api/daily-tasks/${oral}/skip`, { reason: ' 老师今天没布置 ' });
  assert.equal(asked.statusCode, 201);
  assert.deepEqual([asked.json().request.status, asked.json().request.reason, asked.json().request.requested_by, asked.json().task.is_skipped],
    ['pending', '老师今天没布置', 'child', false]);
  assert.equal((await asChild('POST', `/api/daily-tasks/${oral}/skip`, { reason: '再问一次' })).statusCode, 409);
  assert.equal((await todayTasks()).find(task => task.id === oral).skip_request.status, 'pending');

  // Waiting for a parent, the task still counts: finishing the other one is not all done.
  const reading = await asChild('POST', `/api/daily-tasks/${await taskId('阅读')}/complete`);
  assert.equal(reading.json().new_badges.some(badge => badge.key === 'all_done_once'), false);
  assert.deepEqual([(await stats()).today_total_tasks, (await stats()).today_completed_tasks], [2, 1]);

  // Only parents see and settle requests.
  const request = asked.json().request;
  assert.equal((await asChild('GET', '/api/skip-requests?status=pending')).statusCode, 403);
  assert.equal((await asChild('POST', `/api/skip-requests/${request.id}/approve`)).statusCode, 403);
  const pending = (await asParent('GET', '/api/skip-requests?status=pending')).json();
  assert.deepEqual(pending.map(r => [r.task_title, r.task_date, r.child_name, r.reason]), [['口算', today, '小明', '老师今天没布置']]);
  assert.equal((await asParent('GET', '/api/skip-requests?status=nope')).statusCode, 400);

  const approved = await asParent('POST', `/api/skip-requests/${request.id}/approve`);
  assert.equal(approved.statusCode, 200);
  assert.deepEqual([approved.json().request.status, approved.json().task.is_skipped, approved.json().task.skip_reason], ['approved', true, '老师今天没布置']);
  assert.ok(approved.json().new_badges.some(badge => badge.key === 'all_done_once'));
  assert.equal((await asParent('POST', `/api/skip-requests/${request.id}/reject`)).statusCode, 409);
  assert.deepEqual((await asParent('GET', '/api/skip-requests?status=pending')).json(), []);

  // Skipped: not counted, no points, and it cannot be checked off.
  const after = await stats();
  assert.deepEqual([after.today_total_tasks, after.today_completed_tasks, after.today_skipped_tasks, after.today_points], [1, 1, 1, 5]);
  assert.equal((await asChild('POST', `/api/daily-tasks/${oral}/complete`)).statusCode, 409);
  const [history] = (await asParent('GET', `/api/children/${child.id}/history?days=1`)).json().slice(-1);
  assert.deepEqual([history.total_tasks, history.skipped_tasks, history.all_done], [1, 1, true]);
  assert.deepEqual(history.tasks.find(task => task.id === oral).is_skipped, true);
});

test('turned-down and taken-back skips cannot be asked again; withdrawn ones can, and doing the task withdraws a waiting request', async t => {
  const { ctx, child, createChild, loginAs, asChild, asParent, template, todayTasks, taskId, tasksService, today } = await fixture(t);
  await template({ title: '口算' });
  await template({ title: '听写', subject: '语文' });
  await template({ title: '英语', subject: '英语' });
  const skip = id => asChild('POST', `/api/daily-tasks/${id}/skip`, { reason: '老师今天没布置' });

  const oral = await taskId('口算');
  const rejected = (await skip(oral)).json().request;
  assert.equal((await asParent('POST', `/api/skip-requests/${rejected.id}/reject`)).json().request.status, 'rejected');
  assert.equal((await todayTasks()).find(task => task.id === oral).skip_request.status, 'rejected');
  assert.equal((await skip(oral)).statusCode, 409);

  const dictation = await taskId('听写');
  const withdrawn = (await skip(dictation)).json().request;
  assert.equal((await asChild('POST', `/api/skip-requests/${withdrawn.id}/cancel`)).json().request.status, 'cancelled');
  const again = (await skip(dictation)).json().request;
  assert.equal(again.status, 'pending');
  assert.equal((await asChild('POST', `/api/daily-tasks/${dictation}/complete`)).statusCode, 200);
  assert.equal((await asParent('GET', '/api/skip-requests?status=history')).json().find(r => r.id === again.id).status, 'cancelled');

  // A parent skips directly and may take it back; then the child cannot ask again.
  const english = await taskId('英语');
  const direct = await asParent('POST', `/api/daily-tasks/${english}/skip`, { reason: '英语老师请假' });
  assert.deepEqual([direct.statusCode, direct.json().request.status, direct.json().request.requested_by, direct.json().task.is_skipped], [201, 'approved', 'parent', true]);
  assert.equal((await skip(english)).statusCode, 409);
  assert.equal((await asChild('POST', `/api/daily-tasks/${english}/unskip`)).statusCode, 403);
  const unskipped = await asParent('POST', `/api/daily-tasks/${english}/unskip`);
  assert.deepEqual([unskipped.statusCode, unskipped.json().task.is_skipped], [200, false]);
  assert.equal((await asParent('POST', `/api/daily-tasks/${english}/unskip`)).statusCode, 409);
  assert.equal((await asParent('GET', '/api/skip-requests?status=revoked')).json()[0].daily_task_id, english);
  assert.equal((await skip(english)).statusCode, 409);

  // A parent's skip settles a waiting request with the child's reason.
  await template({ title: '练字', subject: '语文' });
  const extra = await taskId('练字');
  const waiting = (await asChild('POST', `/api/daily-tasks/${extra}/skip`, { reason: '已经在学校做完了' })).json().request;
  const settled = (await asParent('POST', `/api/daily-tasks/${extra}/skip`, { reason: '家长的理由' })).json();
  assert.deepEqual([settled.request.id, settled.request.status, settled.task.skip_reason], [waiting.id, 'approved', '已经在学校做完了']);

  // Children cannot skip other children's tasks or earlier days.
  const sibling = await createChild('小红');
  const siblingTask = (await asChild('GET', `/api/daily-tasks?child_id=${sibling.id}`, undefined, await loginAs(sibling))).json()[0];
  assert.equal((await skip(siblingTask.id)).statusCode, 403);
  const yesterday = tasksService.getDailyTasks(child.id, shiftDate(today, -1))[0];
  assert.equal((await skip(yesterday.id)).statusCode, 403);
  assert.equal((await asParent('POST', `/api/daily-tasks/${yesterday.id}/skip`, { reason: '补记：那天停课' })).statusCode, 201);
  const done = (await todayTasks()).find(task => task.title === '听写');
  assert.equal((await asParent('POST', `/api/daily-tasks/${done.id}/skip`, { reason: '已完成' })).statusCode, 409);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM task_skip_requests WHERE status = 'pending'").get().n, 0);
});

test('a skipped weekly time uses up one of the weekly target', async t => {
  const { child, template, tasksService, statsService, skipsService, day, backdateAll, rowOn } = await fixture(t);
  await template({ title: '阅读', schedule_type: 'weekly_times', weekly_target_times: 2 });
  await template({ title: '周末作业', schedule_type: 'weekly_times', weekly_target_times: 1, days_of_week: [0, 6] });
  backdateAll();
  const parent = { role: 'parent' };

  const monday = rowOn(day(0), '阅读');
  assert.equal(monday.is_optional, true);
  const skipped = skipsService.requestSkip(monday.id, '体育课改到周一', parent).task;
  assert.deepEqual([skipped.is_skipped, skipped.weekly_skipped_times, skipped.weekly_remaining_times], [true, 1, 1]);
  tasksService.completeDailyTask(rowOn(day(1), '阅读').id);
  // Done once and skipped once: the weekly target is used up, so no more reading rows this week.
  assert.equal(rowOn(day(2), '阅读'), undefined);
  // Weekend homework not done on Saturday is required on Sunday; skipping it leaves nothing owed.
  tasksService.getDailyTasks(child.id, day(5));
  const sunday = rowOn(day(6), '周末作业');
  assert.equal(sunday.is_optional, false);
  skipsService.requestSkip(sunday.id, '这周没有周末作业', parent);
  const completion = statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6));
  assert.deepEqual(completion.items.map(item => [item.title, item.completed, item.total]), [['阅读', 1, 1]]);
});

test('a day with every task skipped is a rest day for the streak; taking the skip back breaks it again', async t => {
  const { child, template, tasksService, rewardsService, skipsService, day, backdateAll, rowOn } = await fixture(t);
  await template({ title: '口算' });
  backdateAll();
  tasksService.completeDailyTask(rowOn(day(0), '口算').id);
  const tuesday = rowOn(day(1), '口算');
  skipsService.requestSkip(tuesday.id, '运动会', { role: 'parent' });
  tasksService.completeDailyTask(rowOn(day(2), '口算').id);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(2)), 2);
  skipsService.unskip(tuesday.id);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(2)), 1);
});

test("a daily-required long-term task can be skipped for the day, and logging progress still counts", async t => {
  const { child, asChild, asParent, todayTasks, stats } = await fixture(t);
  const goal = (await asParent('POST', `/api/children/${child.id}/goals`, { title: '西游记', subject: '语文', mode: 'progress', unit: '页', total_amount: 100, points: 1, daily_required: true })).json();
  const row = (await todayTasks()).find(task => task.goal_id === goal.id);
  assert.equal((await stats()).today_total_tasks, 1);

  // A waiting request is withdrawn by logging progress.
  const waiting = (await asChild('POST', `/api/daily-tasks/${row.id}/skip`, { reason: '今天去医院' })).json().request;
  assert.equal((await asChild('POST', `/api/period-tasks/${goal.id}/logs`, { amount: 5 })).statusCode, 201);
  assert.equal((await asParent('GET', '/api/skip-requests?status=cancelled')).json()[0].id, waiting.id);
  assert.deepEqual([(await stats()).today_total_tasks, (await stats()).today_completed_tasks], [1, 1]);

  // Once skipped (here after undoing that entry), the day no longer needs a log.
  const [entry] = (await asParent('GET', `/api/children/${child.id}/goals`)).json()[0].logs;
  assert.equal((await asChild('DELETE', `/api/period-task-logs/${entry.id}`)).statusCode, 200);
  assert.equal((await asParent('POST', `/api/daily-tasks/${row.id}/skip`, { reason: '今天去医院' })).statusCode, 201);
  assert.deepEqual([(await stats()).today_total_tasks, (await stats()).today_skipped_tasks], [0, 1]);
  // Logging anyway completes the day's item: done wins over the skip.
  await asChild('POST', `/api/period-tasks/${goal.id}/logs`, { amount: 5 });
  const after = (await todayTasks()).find(task => task.goal_id === goal.id);
  assert.deepEqual([after.is_completed, after.is_skipped], [true, false]);
  assert.deepEqual([(await stats()).today_total_tasks, (await stats()).today_completed_tasks], [1, 1]);
});
