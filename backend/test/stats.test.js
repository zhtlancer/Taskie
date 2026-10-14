const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Stats API (/api/children/:id/history & weekly-summary)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Query history and weekly summary', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    const child = JSON.parse(childRes.body);

    // Insert completed tasks for a few dates
    const dates = ['2026-10-12', '2026-10-13'];
    for (const d of dates) {
      const taskId = 'task-' + d;
      ctx.db.prepare(`
        INSERT INTO daily_tasks (id, child_id, template_id, title, subject, points, date, is_completed, completed_at)
        VALUES (?, ?, NULL, '语文练习', '语文', 15, ?, 1, ?)
      `).run(taskId, child.id, d, d + 'T09:00:00Z');
      ctx.db.prepare(`
        INSERT INTO point_logs (id, child_id, daily_task_id, points, earned_at)
        VALUES (?, ?, ?, 15, ?)
      `).run('log-' + d, child.id, taskId, d + 'T09:00:00Z');
    }

    // 1. History query
    const histRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}/history?from=2026-10-12&to=2026-10-13`
    });
    assert.equal(histRes.statusCode, 200);
    const history = JSON.parse(histRes.body);
    assert.equal(history.length, 2);
    assert.equal(history[0].date, '2026-10-12');
    assert.equal(history[0].completed_tasks, 1);
    assert.equal(history[0].points_earned, 15);
    assert.equal(history[1].date, '2026-10-13');
    assert.equal(history[1].completed_tasks, 1);

    // 2. Weekly summary query
    const weekRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}/weekly-summary?date=2026-10-13`
    });
    assert.equal(weekRes.statusCode, 200);
    const weekSummary = JSON.parse(weekRes.body);
    assert.ok(weekSummary.current_week);
    assert.ok(weekSummary.last_week);
    assert.equal(weekSummary.current_week.completed_tasks, 2);
    assert.equal(weekSummary.current_week.total_points, 30);
    assert.equal(weekSummary.current_week.daily_breakdown.length, 7);
  });

  test('History honours a days window ending today, and rejects invalid windows', async () => {
    ctx = createTestApp();
    const child = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '孩子' } })).json();
    const { getTodayDate, shiftDate } = require('../src/utils/date');
    const today = getTodayDate();

    const week = (await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/history?days=7` })).json();
    assert.deepEqual(week.map(d => d.date), Array.from({ length: 7 }, (_, i) => shiftDate(today, i - 6)));
    // Without days or from, the default 30-day window is unchanged.
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/history` })).json().length, 30);
    // An explicit from still wins over days.
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/history?days=7&from=${shiftDate(today, -1)}` })).json().length, 2);

    for (const days of ['0', '367', 'abc', '-3', '1.5']) {
      assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/history?days=${days}` })).statusCode, 400, days);
    }
  });
});
