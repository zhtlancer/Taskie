const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { initDb } = require('../src/db');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
  const child = await createChild('小明');
  const loginAs = async who => ({ authorization: `Bearer ${(await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: who.id } })).json().token}` });
  const headers = await loginAs(child);
  const addGoal = payload => ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/goals`, payload: { subject: '语文', mode: 'progress', unit: '页', ...payload } });
  const log = (id, payload, h = headers) => ctx.rawInject({ method: 'POST', url: `/api/period-tasks/${id}/logs`, headers: h, payload });
  const points = () => ctx.app.services.rewardsService.getTotalPoints(child.id);
  return { ctx, child, createChild, loginAs, headers, addGoal, log, points, today: getTodayDate() };
}

test('reading by page reached derives the amount, earns per page plus a bonus when finished, and can be undone', async t => {
  const { ctx, child, headers, addGoal, log, points, today } = await fixture(t);
  const created = await addGoal({ title: '西游记', total_amount: 200, input_mode: 'position', points: 1, completion_bonus: 50 });
  assert.equal(created.statusCode, 201);
  const book = created.json();
  assert.deepEqual([book.status, book.start_date, book.end_date, book.period_id, book.days_left], ['active', today, null, null, null]);

  const first = await log(book.id, { position: 20 });
  assert.equal(first.statusCode, 201);
  assert.deepEqual([first.json().points_earned, first.json().task.done_amount, first.json().task.logs[0].position], [20, 20, 20]);
  // 180 pages left at 20 a day, today already read: nine more days.
  assert.deepEqual([first.json().task.recent_daily_rate, first.json().task.estimated_finish_date], [20, shiftDate(today, 9)]);
  for (const position of [20, 15, 201, undefined]) assert.equal((await log(book.id, { position })).statusCode, 400, String(position));

  const finished = (await log(book.id, { position: 200 })).json();
  assert.deepEqual([finished.points_earned, finished.completion_bonus, finished.task.status, finished.task.completed_on], [230, 50, 'completed', today]);
  assert.equal(points(), 250);
  assert.equal((await log(book.id, { position: 200 })).statusCode, 409);
  const titles = (await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/point-logs` })).json().map(l => l.title).sort();
  assert.deepEqual(titles, ['西游记 完成奖励', '西游记 读到第 20 页', '西游记 读到第 200 页']);

  // Undoing the finishing entry reopens the task and takes back its pages and the bonus.
  const undone = await ctx.rawInject({ method: 'DELETE', url: `/api/period-task-logs/${finished.log_id}`, headers });
  assert.deepEqual([undone.json().task.status, undone.json().task.done_amount], ['active', 20]);
  assert.equal(points(), 20);
});

test('a deadline paces what is left; amounts are logged as increments; edits are guarded', async t => {
  const { ctx, child, createChild, loginAs, addGoal, log, today } = await fixture(t);
  for (const payload of [{ title: '' }, { title: '口算', input_mode: 'pages' }, { title: '口算', total_amount: 10, start_date: today, end_date: shiftDate(today, -1) },
    { title: '口算', total_amount: 10, completion_bonus: -1 }, { title: '口算', total_amount: 10, daily_required: 'yes' }]) {
    assert.equal((await addGoal(payload)).statusCode, 400, JSON.stringify(payload));
  }
  const workbook = (await addGoal({ title: '口算练习册', total_amount: 50, unit: '页', end_date: shiftDate(today, 4), points: 2 })).json();
  assert.deepEqual([workbook.days_left, workbook.suggested_today], [5, 10]);
  assert.equal((await log(workbook.id, { amount: 4 })).json().task.suggested_today, 6);

  const update = payload => ctx.app.inject({ method: 'PUT', url: `/api/period-tasks/${workbook.id}`, payload });
  assert.equal((await update({ mode: 'check' })).statusCode, 409);
  assert.equal((await update({ total_amount: 3 })).statusCode, 400);
  assert.equal((await update({ input_mode: 'position', end_date: null })).json().end_date, null);

  // Only the parent creates goals; another child cannot log on them.
  const ownHeaders = await loginAs(child);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/children/${child.id}/goals`, headers: ownHeaders, payload: { title: '偷加', subject: '语文' } })).statusCode, 403);
  const sister = await createChild('小红');
  assert.equal((await log(workbook.id, { position: 10 }, await loginAs(sister))).statusCode, 403);
  assert.deepEqual((await ctx.rawInject({ method: 'GET', url: `/api/children/${child.id}/goals`, headers: ownHeaders })).json().map(g => g.title), ['口算练习册']);
});

test('a daily-required goal adds a required task each day that only logging progress completes', async t => {
  const { ctx, child, headers, addGoal, log } = await fixture(t);
  const book = (await addGoal({ title: '每天读书', total_amount: 100, input_mode: 'position', daily_required: true })).json();
  const today = () => ctx.rawInject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}`, headers }).then(r => r.json());
  const row = (await today()).find(task => task.goal_id === book.id);
  assert.deepEqual([row.origin, row.is_optional, row.is_completed, row.points], ['goal', false, false, 0]);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${row.id}/complete`, headers })).statusCode, 409);

  const entry = (await log(book.id, { position: 12 })).json();
  assert.ok(entry.new_badges.some(b => b.key === 'all_done_once'));
  assert.equal((await today()).find(task => task.goal_id === book.id).is_completed, true);
  await ctx.rawInject({ method: 'DELETE', url: `/api/period-task-logs/${entry.log_id}`, headers });
  assert.equal((await today()).find(task => task.goal_id === book.id).is_completed, false);

  // Turning it off drops today's pending row; deleting the goal keeps logged days in history.
  await ctx.app.inject({ method: 'PUT', url: `/api/period-tasks/${book.id}`, payload: { daily_required: false } });
  assert.equal((await today()).some(task => task.goal_id === book.id), false);
});

test('daily-required goals count in weekly completion and streaks, including unopened days', async t => {
  const { ctx, child, addGoal } = await fixture(t);
  const { statsService, rewardsService } = ctx.app.services;
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  ctx.db.prepare('UPDATE children SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  const book = (await addGoal({ title: '每天读书', total_amount: 300, input_mode: 'position', daily_required: true, start_date: day(0) })).json();
  const backfill = (position, date) => ctx.app.inject({ method: 'POST', url: `/api/period-tasks/${book.id}/logs`, payload: { position, date } });
  for (const [position, n] of [[10, 0], [20, 1], [30, 3]]) assert.equal((await backfill(position, day(n))).statusCode, 201);

  const completion = statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6));
  assert.deepEqual(completion.items.map(i => [i.title, i.completed, i.total]), [['每天读书', 3, 7]]);
  // Wednesday required reading and had none, so Thursday's streak starts again.
  assert.equal(rewardsService.getCurrentStreak(child.id, day(3)), 1);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(1)), 2);
});

test('holiday tasks are long-term tasks that follow their period; deleting a goal keeps logged days', async t => {
  const { ctx, child, addGoal, today } = await fixture(t);
  const period = (await ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/periods`, payload: { name: '寒假', start_date: today, end_date: shiftDate(today, 9) } })).json();
  const homework = (await ctx.app.inject({ method: 'POST', url: `/api/periods/${period.id}/tasks`, payload: { title: '寒假作业', subject: '语文', mode: 'progress', total_amount: 40, unit: '页' } })).json();
  assert.deepEqual([homework.child_id, homework.start_date, homework.end_date], [child.id, today, shiftDate(today, 9)]);
  await ctx.app.inject({ method: 'PUT', url: `/api/periods/${period.id}`, payload: { end_date: shiftDate(today, 19) } });
  const goals = (await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/goals` })).json();
  assert.deepEqual(goals.map(g => [g.title, g.period_name, g.end_date]), [['寒假作业', '寒假', shiftDate(today, 19)]]);
  // Its dates are the period's, whatever the edit says.
  assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/period-tasks/${homework.id}`, payload: { end_date: null } })).json().end_date, shiftDate(today, 19));

  const book = (await addGoal({ title: '每天读书', total_amount: 100, daily_required: true, start_date: shiftDate(today, -1) })).json();
  await ctx.app.inject({ method: 'POST', url: `/api/period-tasks/${book.id}/logs`, payload: { amount: 5, date: shiftDate(today, -1) } });
  ctx.app.services.tasksService.getDailyTasks(child.id);
  await ctx.app.inject({ method: 'DELETE', url: `/api/period-tasks/${book.id}` });
  assert.deepEqual(ctx.db.prepare('SELECT date, is_completed FROM daily_tasks WHERE goal_id = ?').all(book.id), [{ date: shiftDate(today, -1), is_completed: 1 }]);
});

test('v7 holiday tasks migrate to long-term tasks with their progress, child and dates', () => {
  const db = new Database(':memory:');
  try {
    // Start from a current database, then rebuild the v7 shape of the holiday-task tables.
    db.exec(fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8'));
    initDb(db);
    db.exec(`DROP INDEX idx_daily_tasks_goal; ALTER TABLE daily_tasks DROP COLUMN goal_id;
      DROP TABLE period_task_logs; DROP TABLE period_tasks;
      CREATE TABLE period_tasks (id TEXT PRIMARY KEY, period_id TEXT NOT NULL, title TEXT NOT NULL, subject TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'check', total_amount INTEGER NOT NULL DEFAULT 1, unit TEXT, points INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, FOREIGN KEY (period_id) REFERENCES periods(id) ON DELETE CASCADE);
      CREATE TABLE period_task_logs (id TEXT PRIMARY KEY, period_task_id TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT NOT NULL,
        created_at TEXT NOT NULL, FOREIGN KEY (period_task_id) REFERENCES period_tasks(id) ON DELETE CASCADE);`);
    db.pragma('user_version = 7');
    db.prepare("INSERT INTO children (id, name, created_at) VALUES ('c', '小明', '2026-01-01')").run();
    db.prepare("INSERT INTO periods (id, child_id, name, start_date, end_date, created_at) VALUES ('p', 'c', '寒假', '2026-01-20', '2026-02-25', 'x')").run();
    db.prepare("INSERT INTO period_tasks VALUES ('open', 'p', '寒假作业', '语文', 'progress', 40, '页', 2, '2026-01-20T00:00:00Z')").run();
    db.prepare("INSERT INTO period_tasks VALUES ('done', 'p', '读完一本书', '语文', 'check', 1, NULL, 30, '2026-01-20T00:00:00Z')").run();
    db.prepare("INSERT INTO period_task_logs VALUES ('l1', 'open', 5, '2026-01-21', '2026-01-21T10:00:00Z'), ('l2', 'done', 1, '2026-01-22', '2026-01-22T10:00:00Z')").run();
    db.pragma('foreign_keys = ON');

    initDb(db);
    initDb(db);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.prepare('SELECT id, period_id, child_id, start_date, end_date, input_mode, completed_at FROM period_tasks ORDER BY id').all(), [
      { id: 'done', period_id: 'p', child_id: 'c', start_date: '2026-01-20', end_date: '2026-02-25', input_mode: 'increment', completed_at: '2026-01-22T10:00:00Z' },
      { id: 'open', period_id: 'p', child_id: 'c', start_date: '2026-01-20', end_date: '2026-02-25', input_mode: 'increment', completed_at: null }
    ]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM period_task_logs').get().n, 2);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    // Deleting the period still cascades to its tasks and their logs.
    db.prepare("DELETE FROM periods WHERE id = 'p'").run();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM period_task_logs').get().n, 0);
  } finally {
    db.close();
  }
});
