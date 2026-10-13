const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Daily Tasks API (/api/daily-tasks)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Daily tasks auto-generate based on days_of_week and isolate between children', async () => {
    ctx = createTestApp();

    // Create 2 children: A and B
    const childARes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '孩子A', avatar_emoji: '🐱' }
    });
    const childA = JSON.parse(childARes.body);

    const childBRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '孩子B', avatar_emoji: '🐶' }
    });
    const childB = JSON.parse(childBRes.body);

    // Create templates:
    // 2026-10-13 is Tuesday (day 2)
    // 2026-10-18 is Sunday (day 0)
    await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: { title: '周二专有任务', subject: '语文', days_of_week: [2], points: 10 }
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: { title: '工作日任务', subject: '数学', days_of_week: [1, 2, 3, 4, 5], points: 15 }
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: { title: '周末专有任务', subject: '其他', days_of_week: [0, 6], points: 20 }
    });

    // Check DB before GET: daily_tasks table should be completely empty!
    // ("当天没有 GET 请求不应提前生成")
    const countBefore = ctx.db.prepare('SELECT COUNT(*) as count FROM daily_tasks').get().count;
    assert.equal(countBefore, 0);

    // GET daily tasks for child A on 2026-10-13 (Tuesday)
    const getResA = await ctx.app.inject({
      method: 'GET',
      url: `/api/daily-tasks?child_id=${childA.id}&date=2026-10-13`
    });
    assert.equal(getResA.statusCode, 200);
    const tasksA = JSON.parse(getResA.body);

    // Should generate '周二专有任务' and '工作日任务', but NOT '周末专有任务'
    assert.equal(tasksA.length, 2);
    const titlesA = tasksA.map(t => t.title);
    assert.ok(titlesA.includes('周二专有任务'));
    assert.ok(titlesA.includes('工作日任务'));
    assert.ok(!titlesA.includes('周末专有任务'));

    // Child B still has NO daily tasks generated yet! (Strict isolation)
    const countBInDb = ctx.db.prepare('SELECT COUNT(*) as count FROM daily_tasks WHERE child_id = ?').get(childB.id).count;
    assert.equal(countBInDb, 0);

    // GET daily tasks for child B
    const getResB = await ctx.app.inject({
      method: 'GET',
      url: `/api/daily-tasks?child_id=${childB.id}&date=2026-10-13`
    });
    assert.equal(getResB.statusCode, 200);
    const tasksB = JSON.parse(getResB.body);
    assert.equal(tasksB.length, 2);
    assert.notEqual(tasksA[0].id, tasksB[0].id); // completely distinct IDs and instances
  });

  test('Complete and uncomplete daily tasks, points update correctly', async () => {
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
      payload: { title: '背诵课文', subject: '语文', days_of_week: [2], points: 25 }
    });

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/daily-tasks?child_id=${child.id}&date=2026-10-13`
    });
    const tasks = JSON.parse(getRes.body);
    assert.equal(tasks.length, 1);
    const taskId = tasks[0].id;
    assert.equal(tasks[0].is_completed, false);

    // Complete task
    const completeRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/daily-tasks/${taskId}/complete`
    });
    assert.equal(completeRes.statusCode, 200);
    const completeBody = JSON.parse(completeRes.body);
    assert.equal(completeBody.success, true);
    assert.equal(completeBody.task.is_completed, true);
    assert.equal(completeBody.points_earned, 25);

    // Check stats: total_points should be 25
    const statsRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}/stats`
    });
    const stats = JSON.parse(statsRes.body);
    assert.equal(stats.total_points, 25);
    assert.equal(stats.today_completed_tasks, 1);
    assert.equal(stats.today_completion_rate, 1);

    // Uncomplete task
    const uncompleteRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/daily-tasks/${taskId}/uncomplete`
    });
    assert.equal(uncompleteRes.statusCode, 200);
    const uncompleteBody = JSON.parse(uncompleteRes.body);
    assert.equal(uncompleteBody.task.is_completed, false);

    // Check stats again: points should revert to 0
    const statsRevertedRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}/stats`
    });
    const statsReverted = JSON.parse(statsRevertedRes.body);
    assert.equal(statsReverted.total_points, 0);
    assert.equal(statsReverted.today_completed_tasks, 0);
  });
});
