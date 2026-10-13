const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Auth API (/api/auth)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Parent login with default PIN (1234)', async () => {
    ctx = createTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/parent-login',
      payload: { pin: '1234' }
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.role, 'parent');
    assert.ok(body.token);
  });

  test('Parent login with incorrect PIN fails', async () => {
    ctx = createTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/parent-login',
      payload: { pin: '9999' }
    });

    assert.equal(res.statusCode, 401);
  });

  test('Update parent PIN and verify new PIN', async () => {
    ctx = createTestApp();
    // Update PIN
    const updateRes = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/parent-pin',
      payload: { old_pin: '1234', new_pin: '8888' }
    });
    assert.equal(updateRes.statusCode, 200);

    // Old PIN fails
    const oldRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/parent-login',
      payload: { pin: '1234' }
    });
    assert.equal(oldRes.statusCode, 401);

    // New PIN succeeds
    const newRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/parent-login',
      payload: { pin: '8888' }
    });
    assert.equal(newRes.statusCode, 200);
  });

  test('Child login with and without PIN', async () => {
    ctx = createTestApp();

    // Create child with PIN
    const childWithPinRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明', avatar_emoji: '🐱', pin: '0000' }
    });
    const childWithPin = JSON.parse(childWithPinRes.body);

    // Create child without PIN
    const childNoPinRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小红', avatar_emoji: '🐰' }
    });
    const childNoPin = JSON.parse(childNoPinRes.body);

    // Login child with correct PIN
    const loginOk = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/child-login',
      payload: { child_id: childWithPin.id, pin: '0000' }
    });
    assert.equal(loginOk.statusCode, 200);
    const loginBody = JSON.parse(loginOk.body);
    assert.equal(loginBody.success, true);
    assert.equal(loginBody.child.name, '小明');
    assert.ok(loginBody.token);

    // Login child with wrong PIN fails
    const loginWrong = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/child-login',
      payload: { child_id: childWithPin.id, pin: '1111' }
    });
    assert.equal(loginWrong.statusCode, 401);

    // Login child without PIN succeeds directly
    const loginNoPin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/child-login',
      payload: { child_id: childNoPin.id }
    });
    assert.equal(loginNoPin.statusCode, 200);
    assert.equal(JSON.parse(loginNoPin.body).child.name, '小红');
  });

  test('Logout returns success', async () => {
    ctx = createTestApp();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout'
    });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).success, true);
  });
});
