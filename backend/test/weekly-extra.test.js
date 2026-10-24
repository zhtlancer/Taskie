const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, shiftDate, getWeekRange } = require('../src/utils/date');
const { WEEKLY_EXTRA_COLUMNS, initDb } = require('../src/db');

async function fixture(t, policy = {}) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, tasksService: tasks, statsService: stats, rewardsService: rewards } = ctx.app.services;
  const child = childrenService.createChild({ name: '额外挑战同学' });
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(monday, n);
  ctx.db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run(familyInstant(day(-7)), child.id);
  const template = tasks.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 2,
    points: 10, allow_extra: true, extra_points: 3, extra_reward_limit: 2, ...policy });
  ctx.db.prepare('UPDATE task_templates SET created_at = ? WHERE id = ?').run(familyInstant(day(-7)), template.id);
  const rows = Array.from({ length: 7 }, (_, n) => tasks.getDailyTasks(child.id, day(n)).find(row => row.template_id === template.id));
  const post = (n, action = 'backfill', payload = {}) => ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${rows[n].id}/${action}`, payload });
  const row = n => tasks.describeTask(ctx.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(rows[n].id));
  return { ...ctx, tasks, stats, rewards, child, template, day, rows, row, post };
}

test('weekly extras have a separate capped award, are idempotent and stay once per day', async t => {
  const ctx = await fixture(t);
  for (const [n, expected] of [10, 10, 3, 3, 0, 0].entries()) {
    assert.equal(ctx.row(n).award_points, expected);
    const response = await ctx.post(n);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().points_earned, expected);
    assert.equal(response.json().task.is_extra, n >= 2);
    assert.equal(ctx.row(n).earned_points, expected);
    assert.equal((await ctx.post(n)).json().points_earned, 0);
  }
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 26);
  assert.equal(ctx.row(6).weekly_completed_times, 6);
  assert.equal(ctx.row(6).weekly_target_completed_times, 2);
  assert.equal(ctx.row(6).weekly_extra_completed_times, 4);
  assert.equal(ctx.row(6).weekly_extra_rewarded_times, 2);
  assert.ok(ctx.tasks.getDailyTasks(ctx.child.id, ctx.day(6)).some(row => row.id === ctx.rows[6].id));
  const duplicate = ctx.tasks.createAdhocTask(ctx.child.id, { title: '阅读', subject: '语文', date: ctx.day(2) });
  ctx.db.prepare(`UPDATE daily_tasks SET schedule_type = 'weekly_times', source_template_id = ?,
    weekly_target_times = 2, allow_extra = 1 WHERE id = ?`).run(ctx.template.id, duplicate.id);
  const rejected = await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${duplicate.id}/backfill` });
  assert.equal(rejected.statusCode, 409);
  assert.match(rejected.body, /每天最多/);
});

test('disabled extras keep the previous cap; enabling updates today but preserves historical policy', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-16', '20:00:00')) });
  const ctx = await fixture(t, { allow_extra: false });
  await ctx.post(0); await ctx.post(1);
  assert.equal((await ctx.post(2)).statusCode, 409);
  assert.ok(!ctx.tasks.getDailyTasks(ctx.child.id, ctx.day(2)).some(row => row.id === ctx.rows[2].id));
  const currentPending = ctx.tasks.getDailyTasks(ctx.child.id)[0];
  const monday = getWeekRange(getTodayDate()).startDate;
  for (const date of [monday, shiftDate(monday, 1)]) {
    const task = ctx.tasks.getDailyTasks(ctx.child.id, date)[0];
    ctx.tasks.completeDailyTask(task.id);
  }
  assert.ok(!ctx.tasks.getDailyTasks(ctx.child.id).some(task => task.id === currentPending.id));
  ctx.tasks.updateTemplate(ctx.template.id, { allow_extra: true, extra_points: 5, extra_reward_limit: 1 });
  const challenge = ctx.tasks.getDailyTasks(ctx.child.id).find(task => task.id === currentPending.id);
  assert.equal(challenge.allow_extra, true);
  assert.equal(challenge.is_extra, true);
  assert.equal(challenge.award_points, 5);
  assert.equal(ctx.row(2).allow_extra, false, 'historical pending rows retain their policy');
});

test('extra completions never change assessment totals, all-done counts, streaks or finish times', async t => {
  const ctx = await fixture(t, { weekly_target_times: 1 });
  await ctx.post(0);
  const before = ctx.stats.getWeeklyCompletion(ctx.child.id, ctx.day(0), ctx.day(6), ctx.day(6));
  const streak = ctx.rewards.getCurrentStreak(ctx.child.id, ctx.day(6));
  const allDone = ctx.rewards.getAllDoneDaysCount(ctx.child.id);
  await ctx.post(1); await ctx.post(2);
  const after = ctx.stats.getWeeklyCompletion(ctx.child.id, ctx.day(0), ctx.day(6), ctx.day(6));
  assert.deepEqual([after.total_units, after.completed_units, after.completion_rate], [before.total_units, before.completed_units, before.completion_rate]);
  assert.equal(after.items[0].actual_completed, 3);
  assert.equal(after.items[0].extra_completed, 2);
  assert.equal(after.items[0].extra_points_earned, 6);
  assert.equal(after.items[0].target_points_earned, 10);
  assert.equal(ctx.rewards.getCurrentStreak(ctx.child.id, ctx.day(6)), streak);
  assert.equal(ctx.rewards.getAllDoneDaysCount(ctx.child.id), allDone);
  const history = ctx.stats.getHistory(ctx.child.id, ctx.day(1), ctx.day(1))[0];
  assert.deepEqual([history.total_tasks, history.completed_tasks, history.all_done, history.points_earned], [0, 0, false, 3]);
  assert.equal(history.tasks[0].is_extra, true);
  ctx.db.prepare('UPDATE daily_tasks SET completion_source = NULL, completed_at = ? WHERE id = ?').run(familyInstant(ctx.day(1), '18:00:00'), ctx.rows[1].id);
  assert.equal(ctx.app.services.timeStatsService.finishTimes(ctx.child.id, ctx.day(1), ctx.day(1)).size, 0);
});

test('undo refunds only actual awards, releases reward quota and does not reclassify existing extras', async t => {
  const ctx = await fixture(t, { weekly_target_times: 1, extra_reward_limit: 1 });
  await ctx.post(0); await ctx.post(1); await ctx.post(2);
  assert.equal((await ctx.post(1, 'undo-backfill')).statusCode, 200);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 10);
  const events = ctx.tasks.getBackfillTasks(ctx.child.id, ctx.day(1)).events;
  assert.equal(events[0].points, -3);
  assert.equal(ctx.row(2).earned_points, 0, 'free completions do not gain points retroactively');
  assert.equal(ctx.row(3).award_points, 3);
  await ctx.post(3);
  await ctx.post(0, 'undo-backfill');
  assert.equal(ctx.row(3).is_extra_completion, true);
  assert.equal(ctx.row(3).earned_points, 3);
  assert.equal(ctx.row(4).is_extra, false, 'undoing a target completion reopens the target');
  assert.equal(ctx.row(4).award_points, 10);
  await ctx.post(4);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 13);
});

test('skips count towards the target, while voluntary challenges cannot be skipped', async t => {
  const ctx = await fixture(t);
  ctx.app.services.skipsService.requestSkip(ctx.rows[0].id, '今天没有布置', { role: 'parent' });
  await ctx.post(1);
  assert.equal(ctx.row(2).weekly_remaining_times, 0);
  assert.equal(ctx.row(2).is_extra, true);
  const response = await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${ctx.rows[2].id}/skip`, payload: { reason: '不做额外挑战' } });
  assert.equal(response.statusCode, 409);
  await ctx.post(2);
  assert.equal(ctx.row(2).earned_points, 3);
  ctx.app.services.skipsService.unskip(ctx.rows[0].id);
  assert.equal(ctx.row(3).is_extra, false);
});

test('policy edits preserve past snapshots and frozen rewards; zero-point extras can be undone with negative balance', async t => {
  const ctx = await fixture(t, { weekly_target_times: 1, extra_points: 0 });
  await ctx.post(0); await ctx.post(1);
  ctx.tasks.updateTemplate(ctx.template.id, { allow_extra: true, extra_points: 50, extra_reward_limit: 7, points: 100, weekly_target_times: 4 });
  assert.deepEqual([ctx.row(0).earned_points, ctx.row(1).earned_points, ctx.row(2).extra_points, ctx.row(1).weekly_target_times], [10, 0, 0, 1]);
  const redemptions = ctx.app.services.redemptionsService;
  const reward = redemptions.createItem({ title: '贴纸', cost: 10 });
  redemptions.requestRedemption(ctx.child.id, reward.id);
  await ctx.post(0, 'undo-backfill');
  assert.equal(ctx.rewards.getAvailablePoints(ctx.child.id), -10);
  assert.doesNotThrow(() => ctx.tasks.uncompleteDailyTask(ctx.rows[1].id));
});

test('extra policy validation, default-free rewards, new week and child permissions', async t => {
  const ctx = await fixture(t, { extra_points: 0 });
  for (const data of [{ allow_extra: 1 }, { extra_points: -1 }, { extra_points: 1.2 }, { extra_reward_limit: 8 }, { extra_reward_limit: null }]) {
    assert.throws(() => ctx.tasks.updateTemplate(ctx.template.id, data), error => error.status === 400);
  }
  await ctx.post(0); await ctx.post(1); await ctx.post(2);
  assert.equal(ctx.row(2).earned_points, 0);
  const nextWeek = ctx.tasks.getDailyTasks(ctx.child.id, shiftDate(ctx.day(0), 7)).find(row => row.template_id === ctx.template.id);
  assert.equal(nextWeek.is_extra, false);
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: ctx.child.id, epoch: ctx.app.sessionEpoch() })}` };
  assert.equal((await ctx.rawInject({ method: 'PUT', url: `/api/task-templates/${ctx.template.id}`, headers, payload: { extra_points: 100 } })).statusCode, 403);
});

test('stale reward previews and concurrent retries never exceed the weekly reward quota', async t => {
  const ctx = await fixture(t, { weekly_target_times: 1, extra_reward_limit: 1 });
  await ctx.post(0);
  assert.deepEqual([ctx.row(1).award_points, ctx.row(2).award_points], [3, 3]);
  const responses = await Promise.all([ctx.post(1), ctx.post(2), ctx.post(1)]);
  assert.ok(responses.every(response => response.statusCode === 200));
  assert.equal(responses.reduce((sum, response) => sum + response.json().points_earned, 0), 3);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 13);
  assert.equal(ctx.row(3).weekly_extra_rewarded_times, 1);
});

test('children complete today’s extra challenge through the normal endpoint with server-owned awards', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-16', '20:00:00')) });
  const ctx = await fixture(t, { weekly_target_times: 1 });
  const monday = getWeekRange(getTodayDate()).startDate;
  const target = ctx.tasks.getDailyTasks(ctx.child.id, monday)[0];
  ctx.tasks.completeDailyTask(target.id);
  const today = ctx.tasks.getDailyTasks(ctx.child.id)[0];
  assert.equal(today.is_extra, true);
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: ctx.child.id, epoch: ctx.app.sessionEpoch() })}` };
  const response = await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${today.id}/complete`, headers,
    payload: { points: 10000, earned_points: 10000, is_extra_completion: false } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().task.is_extra_completion, true);
  assert.equal(response.json().points_earned, 3);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${today.id}/uncomplete`, headers })).statusCode, 200);
  assert.equal(ctx.tasks.describeTask(ctx.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(today.id)).award_points, 3);
});

test('v16 backup preserves policy, classification and awards; v15 upgrades and damaged v16 is rejected', async t => {
  const ctx = await fixture(t, { weekly_target_times: 1 });
  await ctx.post(0); await ctx.post(1);
  const backup = ctx.app.backupService;
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  await ctx.post(1, 'undo-backfill');
  await backup.restore(archive);
  assert.equal(ctx.row(1).earned_points, 3);
  assert.equal(ctx.row(1).is_extra_completion, true);
  assert.equal(ctx.tasks.getTemplate(ctx.template.id).allow_extra, true);
  const data = JSON.parse(gunzipSync(archive));
  const db = new Database(Buffer.from(data.database, 'base64'));
  db.exec('ALTER TABLE daily_tasks DROP COLUMN earned_points');
  const damaged = gzipSync(JSON.stringify({ ...data, database: db.serialize().toString('base64') }));
  await assert.rejects(() => backup.restore(damaged), /额外完成/);
  db.close();
  const old = new Database(Buffer.from(data.database, 'base64'));
  for (const [table, columns] of Object.entries(WEEKLY_EXTRA_COLUMNS)) for (const column of Object.keys(columns)) old.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  old.pragma('user_version = 15');
  const legacy = gzipSync(JSON.stringify({ ...data, database: old.serialize().toString('base64') }));
  await backup.restore(legacy);
  assert.equal(ctx.row(0).earned_points, 10);
  assert.equal(ctx.tasks.getTemplate(ctx.template.id).allow_extra, false);
  initDb(old);
  assert.equal(old.pragma('user_version', { simple: true }), 30);
  assert.equal(old.prepare('SELECT earned_points FROM daily_tasks WHERE id = ?').get(ctx.rows[0].id).earned_points, 10);
  assert.equal(old.prepare('SELECT earned_points FROM daily_tasks WHERE id = ?').get(ctx.rows[1].id).earned_points, 3);
  assert.equal(old.prepare('SELECT allow_extra FROM task_templates WHERE id = ?').get(ctx.template.id).allow_extra, 0);
  old.close();
});
