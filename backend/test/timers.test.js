const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

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
  const todayTask = async title => (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(task => task.title === title);
  const timer = (id, action, kind = 'daily-tasks') => asChild('POST', `/api/${kind}/${id}/timer/${action}`);
  // Moves a running timer's start back, as if it had been running that long.
  const runFor = (table, id, seconds) => ctx.db.prepare(`UPDATE ${table} SET timer_started_at = ? WHERE id = ?`)
    .run(new Date(Date.now() - seconds * 1000).toISOString(), id);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 2, `${actual} is not about ${expected}`);
  return { ctx, child, createChild, loginAs, headers, asChild, asParent, template, todayTask, timer, runFor, near, today: getTodayDate() };
}

test('templates and one-off tasks may record time with an optional expected duration', async t => {
  const { child, asParent, template, todayTask, timer } = await fixture(t);
  for (const payload of [{ track_time: 'yes' }, { track_time: true, expected_minutes: 0 }, { track_time: true, expected_minutes: 601 }, { track_time: true, expected_minutes: 1.5 }]) {
    assert.equal((await template({ title: '无效', ...payload })).statusCode, 400, JSON.stringify(payload));
  }
  const timed = (await template({ title: '口算', track_time: true, expected_minutes: 20 })).json();
  assert.deepEqual([timed.track_time, timed.expected_minutes], [true, 20]);
  // Expected minutes only apply to timed tasks.
  const plain = (await template({ title: '整理书包', expected_minutes: 5 })).json();
  assert.deepEqual([plain.track_time, plain.expected_minutes], [false, null]);

  const task = await todayTask('口算');
  assert.deepEqual([task.track_time, task.expected_minutes, task.timer_running, task.timer_seconds], [true, 20, false, 0]);
  assert.equal((await timer((await todayTask('整理书包')).id, 'start')).statusCode, 409);

  const adhoc = (await asParent('POST', `/api/children/${child.id}/adhoc-tasks`, { title: '手抄报', subject: '其他', track_time: true, expected_minutes: 40 })).json();
  assert.deepEqual([adhoc.track_time, adhoc.expected_minutes], [true, 40]);
});

test('a timer pauses and resumes, and starting another task pauses the running one', async t => {
  const { ctx, template, todayTask, timer, runFor, near } = await fixture(t);
  await template({ title: '口算', track_time: true });
  await template({ title: '听写', subject: '语文', track_time: true });
  const oral = await todayTask('口算');
  const dictation = await todayTask('听写');

  assert.equal((await timer(oral.id, 'start')).json().timer_running, true);
  runFor('daily_tasks', oral.id, 600);
  const paused = (await timer(oral.id, 'pause')).json();
  assert.equal(paused.timer_running, false);
  near(paused.timer_seconds, 600);

  await timer(oral.id, 'start');
  runFor('daily_tasks', oral.id, 60);
  ctx.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 600 WHERE id = ?').run(oral.id);
  assert.equal((await timer(dictation.id, 'start')).json().timer_running, true);
  const switched = await todayTask('口算');
  assert.equal(switched.timer_running, false);
  near(switched.timer_seconds, 660);

  assert.equal((await timer(oral.id, 'reset')).json().timer_seconds, 0);
  assert.equal((await timer(oral.id, 'stop')).statusCode, 404);
});

test('done timed tasks record the timer, an entered duration or none; undoing keeps the timer', async t => {
  const { asChild, template, todayTask, timer, runFor, near } = await fixture(t);
  await template({ title: '口算', track_time: true });
  await template({ title: '听写', subject: '语文', track_time: true });
  await template({ title: '整理书包' });
  const oral = await todayTask('口算');
  const complete = (id, payload) => asChild('POST', `/api/daily-tasks/${id}/complete`, payload);

  await timer(oral.id, 'start');
  runFor('daily_tasks', oral.id, 1500);
  const done = (await complete(oral.id)).json().task;
  near(done.duration_seconds, 1500);
  assert.deepEqual([done.duration_source, done.timer_running], ['timer', false]);
  assert.equal((await timer(oral.id, 'start')).statusCode, 409);

  const undone = (await asChild('POST', `/api/daily-tasks/${oral.id}/uncomplete`)).json().task;
  assert.equal(undone.duration_seconds, null);
  near(undone.timer_seconds, 1500);
  for (const duration_seconds of [30, 13 * 3600, '600', 90.5]) {
    assert.equal((await complete(oral.id, { duration_seconds })).statusCode, 400, String(duration_seconds));
  }
  const entered = (await complete(oral.id, { duration_seconds: 1200 })).json().task;
  assert.deepEqual([entered.duration_seconds, entered.duration_source], [1200, 'manual']);

  // Without a timer, nothing is recorded unless entered; explicit null records none.
  const dictation = await todayTask('听写');
  assert.equal((await complete(dictation.id, { duration_seconds: null })).json().task.duration_seconds, null);
  // Tasks that do not record time ignore a duration.
  const bag = await todayTask('整理书包');
  assert.equal((await complete(bag.id, { duration_seconds: 600 })).json().task.duration_seconds, null);
});

test('durations can be corrected: by the child for today, by a parent for any day', async t => {
  const { ctx, child, asChild, asParent, template, todayTask, today } = await fixture(t);
  await template({ title: '口算', track_time: true });
  const oral = await todayTask('口算');
  const setDuration = (id, duration_seconds, as = asChild) => as('PUT', `/api/daily-tasks/${id}/duration`, { duration_seconds });

  assert.equal((await setDuration(oral.id, 600)).statusCode, 409);
  await asChild('POST', `/api/daily-tasks/${oral.id}/complete`);
  assert.deepEqual([(await setDuration(oral.id, 900)).json().task.duration_seconds, (await todayTask('口算')).duration_source], [900, 'manual']);
  assert.equal((await setDuration(oral.id, 20)).statusCode, 400);
  assert.equal((await setDuration(oral.id, null)).json().task.duration_seconds, null);

  const { tasksService } = ctx.app.services;
  const yesterday = tasksService.getDailyTasks(child.id, shiftDate(today, -1))[0];
  tasksService.completeDailyTask(yesterday.id);
  assert.equal((await setDuration(yesterday.id, 600)).statusCode, 403);
  assert.equal((await setDuration(yesterday.id, 600, asParent)).statusCode, 200);

  await asParent('POST', '/api/task-templates', { title: '整理书包', subject: '其他', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const bag = await todayTask('整理书包');
  await asChild('POST', `/api/daily-tasks/${bag.id}/complete`);
  assert.equal((await setDuration(bag.id, 600)).statusCode, 409);
});

test("editing a template's timing updates today's unfinished task; turning it off drops the timer", async t => {
  const { asParent, template, todayTask, timer } = await fixture(t);
  const created = (await template({ title: '口算' })).json();
  assert.equal((await todayTask('口算')).track_time, false);
  await asParent('PUT', `/api/task-templates/${created.id}`, { track_time: true, expected_minutes: 15 });
  const timed = await todayTask('口算');
  assert.deepEqual([timed.track_time, timed.expected_minutes], [true, 15]);
  await timer(timed.id, 'start');
  // Other edits keep the timing settings.
  assert.equal((await asParent('PUT', `/api/task-templates/${created.id}`, { points: 20 })).json().track_time, true);
  assert.equal((await todayTask('口算')).timer_running, true);
  await asParent('PUT', `/api/task-templates/${created.id}`, { track_time: false });
  const plain = await todayTask('口算');
  assert.deepEqual([plain.track_time, plain.expected_minutes, plain.timer_running, plain.timer_seconds], [false, null, false, 0]);
});

test('long-term tasks time each session: the entry keeps the duration and the timer starts over', async t => {
  const { child, createChild, loginAs, asChild, asParent, template, todayTask, timer, runFor, near } = await fixture(t);
  await template({ title: '口算', track_time: true });
  const addGoal = payload => asParent('POST', `/api/children/${child.id}/goals`, { title: '西游记', subject: '语文', mode: 'progress', unit: '页', total_amount: 100, ...payload });
  const book = (await addGoal({ track_time: true, expected_minutes: 30 })).json();
  assert.deepEqual([book.track_time, book.expected_minutes, book.timer_seconds], [true, 30, 0]);
  const log = payload => asChild('POST', `/api/period-tasks/${book.id}/logs`, payload);

  // Starting the book pauses the running homework timer.
  const oral = await todayTask('口算');
  await timer(oral.id, 'start');
  assert.equal((await timer(book.id, 'start', 'period-tasks')).json().timer_running, true);
  assert.equal((await todayTask('口算')).timer_running, false);

  runFor('period_tasks', book.id, 1800);
  const first = (await log({ amount: 10 })).json().task;
  near(first.logs[0].duration_seconds, 1800);
  assert.deepEqual([first.logs[0].duration_source, first.timer_running, first.timer_seconds], ['timer', false, 0]);

  const second = (await log({ amount: 5, duration_seconds: 900 })).json().task;
  assert.deepEqual([second.logs[0].duration_seconds, second.logs[0].duration_source], [900, 'manual']);
  assert.equal((await log({ amount: 5 })).json().task.logs[0].duration_seconds, null);

  const entry = second.logs[0];
  const fixed = await asChild('PUT', `/api/period-task-logs/${entry.id}/duration`, { duration_seconds: 1200 });
  assert.equal(fixed.json().task.logs.find(l => l.id === entry.id).duration_seconds, 1200);
  // Another child cannot touch this book.
  const other = await loginAs(await createChild('小红'));
  assert.equal((await asChild('POST', `/api/period-tasks/${book.id}/timer/start`, undefined, other)).statusCode, 403);
  assert.equal((await asChild('PUT', `/api/period-task-logs/${entry.id}/duration`, { duration_seconds: 60 }, other)).statusCode, 403);

  const untimed = (await addGoal({ title: '水浒传' })).json();
  assert.equal((await timer(untimed.id, 'start', 'period-tasks')).statusCode, 409);
  await asParent('PUT', `/api/period-tasks/${book.id}`, { track_time: false });
  assert.equal((await timer(book.id, 'start', 'period-tasks')).statusCode, 409);
});

test("children can only time their own tasks, and only today's", async t => {
  const { ctx, child, createChild, loginAs, asChild, template, timer, today } = await fixture(t);
  await template({ title: '口算', track_time: true });
  const sibling = await createChild('小红');
  const siblingTask = (await asChild('GET', `/api/daily-tasks?child_id=${sibling.id}`, undefined, await loginAs(sibling))).json()[0];
  assert.equal((await timer(siblingTask.id, 'start')).statusCode, 403);
  const yesterday = ctx.app.services.tasksService.getDailyTasks(child.id, shiftDate(today, -1))[0];
  assert.equal((await timer(yesterday.id, 'start')).statusCode, 409);
});

for (const approval of ['direct', 'approve', 'parent-settles-pending']) {
  test(`skipping a running task pauses and preserves its timer (${approval})`, async t => {
    const { ctx, asChild, asParent, template, todayTask, timer, runFor, near } = await fixture(t);
    await template({ title: '口算', track_time: true });
    const task = await todayTask('口算');
    await timer(task.id, 'start');
    ctx.db.prepare('UPDATE daily_tasks SET timer_elapsed_seconds = 600 WHERE id = ?').run(task.id);
    runFor('daily_tasks', task.id, 120);
    let request;
    if (approval !== 'direct') {
      request = (await asChild('POST', `/api/daily-tasks/${task.id}/skip`, { reason: '老师没布置' })).json().request;
      assert.equal((await todayTask('口算')).timer_running, true, 'a pending request must not pause the timer');
    }
    const skipped = approval === 'approve'
      ? await asParent('POST', `/api/skip-requests/${request.id}/approve`)
      : await asParent('POST', `/api/daily-tasks/${task.id}/skip`, { reason: '老师没布置' });
    assert.equal(skipped.statusCode, approval === 'approve' ? 200 : 201, skipped.body);
    assert.deepEqual([skipped.json().task.is_skipped, skipped.json().task.timer_running], [true, false]);
    const seconds = skipped.json().task.timer_seconds;
    near(seconds, 720);
    assert.equal((await timer(task.id, 'start')).statusCode, 409);

    // An hour spent skipped must not become homework time after taking the skip back.
    const later = Date.now() + 3600000;
    t.mock.method(Date, 'now', () => later);
    const restored = await asParent('POST', `/api/daily-tasks/${task.id}/unskip`);
    assert.deepEqual([restored.json().task.timer_running, restored.json().task.timer_seconds], [false, seconds]);
    const done = await asChild('POST', `/api/daily-tasks/${task.id}/complete`);
    assert.deepEqual([done.json().task.duration_seconds, done.json().task.duration_source], [seconds, 'timer']);
  });
}

test('backfilling progress leaves the current running or paused session alone', async t => {
  const { ctx, child, asChild, asParent, timer, runFor, near, today } = await fixture(t);
  const yesterday = shiftDate(today, -1);
  for (const running of [true, false]) {
    const goal = (await asParent('POST', `/api/children/${child.id}/goals`, {
      title: '西游记', subject: '语文', mode: 'progress', unit: '页', total_amount: 100,
      start_date: yesterday, track_time: true
    })).json();
    if (running) {
      await timer(goal.id, 'start', 'period-tasks');
      runFor('period_tasks', goal.id, 600);
    } else ctx.db.prepare('UPDATE period_tasks SET timer_elapsed_seconds = 600 WHERE id = ?').run(goal.id);
    const session = () => ctx.db.prepare('SELECT timer_started_at, timer_elapsed_seconds FROM period_tasks WHERE id = ?').get(goal.id);
    const before = session();
    for (const entered of [undefined, 900, null]) {
      const payload = { amount: 1, date: yesterday };
      if (entered !== undefined) payload.duration_seconds = entered;
      const result = await asParent('POST', `/api/period-tasks/${goal.id}/logs`, payload);
      assert.equal(result.statusCode, 201, result.body);
      const entry = result.json().task.logs.find(log => log.id === result.json().log_id);
      assert.deepEqual([entry.date, entry.duration_seconds, entry.duration_source],
        [yesterday, entered ?? null, entered === 900 ? 'manual' : null]);
      assert.deepEqual(session(), before, 'historical entries must not consume the current session');
    }
    const invalid = await asParent('POST', `/api/period-tasks/${goal.id}/logs`, { amount: 1, date: yesterday, duration_seconds: 30 });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(session(), before);

    // The preserved session still belongs to today's next progress entry.
    const current = (await asChild('POST', `/api/period-tasks/${goal.id}/logs`, { amount: 1 })).json();
    const entry = current.task.logs.find(log => log.id === current.log_id);
    near(entry.duration_seconds, 600);
    assert.deepEqual([entry.date, entry.duration_source, current.task.timer_running, current.task.timer_seconds], [today, 'timer', false, 0]);
  }
});

test("skipping a goal's daily log pauses its current session only for today", async t => {
  const { ctx, child, asChild, asParent, timer, runFor, near, today } = await fixture(t);
  const yesterday = shiftDate(today, -1);
  const goal = (await asParent('POST', `/api/children/${child.id}/goals`, {
    title: '西游记', subject: '语文', mode: 'progress', unit: '页', total_amount: 100,
    start_date: yesterday, track_time: true, daily_required: true
  })).json();
  const tasks = ctx.app.services.tasksService;
  const pastRow = tasks.getDailyTasks(child.id, yesterday).find(row => row.goal_id === goal.id);
  const todayRow = tasks.getDailyTasks(child.id, today).find(row => row.goal_id === goal.id);
  await timer(goal.id, 'start', 'period-tasks');
  runFor('period_tasks', goal.id, 600);
  await asParent('POST', `/api/daily-tasks/${pastRow.id}/skip`, { reason: '补记昨天请假' });
  assert.ok(ctx.db.prepare('SELECT timer_started_at FROM period_tasks WHERE id = ?').get(goal.id).timer_started_at);
  const asked = (await asChild('POST', `/api/daily-tasks/${todayRow.id}/skip`, { reason: '今天请假' })).json().request;
  const approved = await asParent('POST', `/api/skip-requests/${asked.id}/approve`);
  assert.equal(approved.statusCode, 200, approved.body);
  const book = (await asParent('GET', `/api/children/${child.id}/goals`)).json()[0];
  assert.equal(book.timer_running, false);
  near(book.timer_seconds, 600);
  await asParent('POST', `/api/daily-tasks/${todayRow.id}/unskip`);
  assert.equal(ctx.db.prepare('SELECT timer_started_at FROM period_tasks WHERE id = ?').get(goal.id).timer_started_at, null);
});

test('backfilling the final progress pauses the current session without assigning it to the past', async t => {
  const { child, asParent, timer, runFor, near, today } = await fixture(t);
  const yesterday = shiftDate(today, -1);
  const goal = (await asParent('POST', `/api/children/${child.id}/goals`, {
    title: '西游记', subject: '语文', mode: 'progress', unit: '页', total_amount: 1,
    start_date: yesterday, track_time: true
  })).json();
  await timer(goal.id, 'start', 'period-tasks');
  runFor('period_tasks', goal.id, 600);
  const result = (await asParent('POST', `/api/period-tasks/${goal.id}/logs`, { amount: 1, date: yesterday })).json();
  assert.deepEqual([result.task.status, result.task.timer_running, result.task.logs[0].duration_seconds], ['completed', false, null]);
  near(result.task.timer_seconds, 600);
  const undone = (await asParent('DELETE', `/api/period-task-logs/${result.log_id}`)).json().task;
  assert.deepEqual([undone.status, undone.timer_running], ['active', false]);
  near(undone.timer_seconds, 600);
});
