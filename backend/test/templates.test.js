const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Task Templates API (/api/task-templates)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Create, list, update, and delete task templates', async () => {
    ctx = createTestApp();

    // 1. Create template
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: {
        title: '数学口算',
        subject: '数学',
        days_of_week: [1, 2, 3, 4, 5],
        points: 15
      }
    });
    assert.equal(createRes.statusCode, 201);
    const tmpl = JSON.parse(createRes.body);
    assert.equal(tmpl.title, '数学口算');
    assert.equal(tmpl.subject, '数学');
    assert.deepEqual(tmpl.days_of_week, [1, 2, 3, 4, 5]);
    assert.equal(tmpl.points, 15);
    assert.ok(tmpl.id);

    // 2. List templates
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/task-templates'
    });
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, tmpl.id);

    // 3. Update template
    const updateRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/task-templates/${tmpl.id}`,
      payload: {
        title: '数学口算打卡',
        points: 20,
        days_of_week: [0, 1, 2, 3, 4, 5, 6]
      }
    });
    assert.equal(updateRes.statusCode, 200);
    const updated = JSON.parse(updateRes.body);
    assert.equal(updated.title, '数学口算打卡');
    assert.equal(updated.points, 20);
    assert.deepEqual(updated.days_of_week, [0, 1, 2, 3, 4, 5, 6]);

    // 4. Delete template
    const deleteRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/task-templates/${tmpl.id}`
    });
    assert.equal(deleteRes.statusCode, 200);

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/task-templates/${tmpl.id}`
    });
    assert.equal(getRes.statusCode, 404);
  });
});
