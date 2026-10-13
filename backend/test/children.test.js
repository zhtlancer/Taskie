const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Children API (/api/children)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Create, list, update, and delete children', async () => {
    ctx = createTestApp();

    // 1. Create child
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明', avatar_emoji: '🦁', pin: '1234' }
    });
    assert.equal(createRes.statusCode, 201);
    const child = JSON.parse(createRes.body);
    assert.equal(child.name, '小明');
    assert.equal(child.avatar_emoji, '🦁');
    assert.equal(child.has_pin, true);
    assert.ok(child.id);

    // 2. List children
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/children'
    });
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, child.id);

    // 3. Get child by ID
    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}`
    });
    assert.equal(getRes.statusCode, 200);
    assert.equal(JSON.parse(getRes.body).name, '小明');

    // 4. Update child
    const updateRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/children/${child.id}`,
      payload: { name: '大明', avatar_emoji: '🐯', pin: '' }
    });
    assert.equal(updateRes.statusCode, 200);
    const updated = JSON.parse(updateRes.body);
    assert.equal(updated.name, '大明');
    assert.equal(updated.avatar_emoji, '🐯');
    assert.equal(updated.has_pin, false); // PIN cleared

    // 5. Delete child
    const deleteRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/children/${child.id}`
    });
    assert.equal(deleteRes.statusCode, 200);

    const getAfterDelete = await ctx.app.inject({
      method: 'GET',
      url: `/api/children/${child.id}`
    });
    assert.equal(getAfterDelete.statusCode, 404);
  });

  test('Validates child creation requirements', async () => {
    ctx = createTestApp();
    const emptyNameRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '   ' }
    });
    assert.equal(emptyNameRes.statusCode, 400);
  });
});
