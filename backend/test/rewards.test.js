const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');

describe('Rewards & Gamification API', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('List badge definitions', async () => {
    ctx = createTestApp();
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/badge-definitions'
    });
    assert.equal(res.statusCode, 200);
    const badges = JSON.parse(res.body);
    assert.ok(badges.length >= 8);
    const keys = badges.map(b => b.key);
    assert.ok(keys.includes('first_complete'));
    assert.ok(keys.includes('streak_3'));
    assert.ok(keys.includes('streak_7'));
    assert.ok(keys.includes('points_100'));
    assert.ok(keys.includes('all_done_once'));
  });

  test('Triggers first_complete badge and all_done_once badge on completing daily tasks', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    const child = JSON.parse(childRes.body);

    await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: { title: '朗读', subject: '语文', days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 20 }
    });

    const tasksRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/daily-tasks?child_id=${child.id}&date=2026-10-13`
    });
    const tasks = JSON.parse(tasksRes.body);
    assert.equal(tasks.length, 1);

    // Complete task
    const completeRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/daily-tasks/${tasks[0].id}/complete`
    });
    const completeBody = JSON.parse(completeRes.body);

    // Should have unlocked 'first_complete' and 'all_done_once' badges!
    assert.ok(completeBody.new_badges.length >= 2);
    const badgeKeys = completeBody.new_badges.map(b => b.key);
    assert.ok(badgeKeys.includes('first_complete'));
    assert.ok(badgeKeys.includes('all_done_once'));

    // Check /api/children/:id/badges
    const badgesRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}/badges`
    });
    const childBadges = JSON.parse(badgesRes.body);
    assert.equal(childBadges.length, completeBody.new_badges.length);

    // Completing another task on another day shouldn't re-grant 'first_complete'
    await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: { title: '写字', subject: '语文', days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 20 }
    });
    const nextDayRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/daily-tasks?child_id=${child.id}&date=2026-10-14`
    });
    const nextDayTasks = JSON.parse(nextDayRes.body);
    const complete2 = await ctx.app.inject({
      method: 'POST',
      url: `/api/daily-tasks/${nextDayTasks[0].id}/complete`
    });
    const complete2Body = JSON.parse(complete2.body);
    const newBadgeKeys2 = complete2Body.new_badges.map(b => b.key);
    assert.ok(!newBadgeKeys2.includes('first_complete')); // already unlocked
  });

  test('Streak calculation across consecutive days', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小华' }
    });
    const child = JSON.parse(childRes.body);

    const rewardsService = ctx.app.services.rewardsService;

    // Simulate 3 consecutive days completed
    const days = ['2026-10-11', '2026-10-12', '2026-10-13'];
    for (const d of days) {
      const taskId = 'task-' + d;
      ctx.db.prepare(`
        INSERT INTO daily_tasks (id, child_id, template_id, title, subject, points, date, is_completed, completed_at)
        VALUES (?, ?, NULL, '任务', '综合', 10, ?, 1, ?)
      `).run(taskId, child.id, d, familyInstant(d, '18:00:00'));
      ctx.db.prepare(`
        INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at)
        VALUES (?, ?, ?, 10, ?)
      `).run('log-' + d, child.id, taskId, familyInstant(d, '18:00:00'));
    }

    const streak = rewardsService.getCurrentStreak(child.id, '2026-10-13');
    assert.equal(streak, 3);

    // If today is 2026-10-14 and child hasn't done tasks yet, streak from yesterday should still be 3
    const streakNextMorning = rewardsService.getCurrentStreak(child.id, '2026-10-14');
    assert.equal(streakNextMorning, 3);

    // If day is 2026-10-15 and nothing was done on a scheduled 2026-10-14, the streak breaks to 0
    const { tasksService } = ctx.app.services;
    const template = tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
    ctx.db.prepare("UPDATE task_templates SET created_at = ?").run(familyInstant('2026-10-01', '08:00:00'));
    ctx.db.prepare("UPDATE children SET created_at = ?").run(familyInstant('2026-10-01', '08:00:00'));
    const streakBroken = rewardsService.getCurrentStreak(child.id, '2026-10-15');
    assert.equal(streakBroken, 0);

    // A day with nothing scheduled (2026-10-14 is a Wednesday) is a rest day: it neither counts nor breaks
    tasksService.updateTemplate(template.id, { days_of_week: [0, 1, 2, 4, 5, 6] });
    assert.equal(rewardsService.getCurrentStreak(child.id, '2026-10-15'), 3);
  });
});
