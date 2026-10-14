const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { initDb } = require('../src/db');

async function fixture(t) {
  const ctx = createTestApp({ defaultParentPin: true });
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const call = (method, url, { token, payload } = {}) =>
    ctx.rawInject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const login = async pin => (await call('POST', '/api/auth/parent-login', { payload: { pin } })).json();
  return { ctx, call, login };
}

test('a fresh install must replace the default parent PIN before using the console', async t => {
  const { ctx, call, login } = await fixture(t);
  assert.deepEqual((await call('GET', '/api/auth/setup')).json(), { parent_pin_is_default: true });

  const first = await login('1234');
  assert.equal(first.must_change_pin, true);
  for (const [method, url] of [['GET', '/api/task-templates'], ['GET', '/api/backups'], ['POST', '/api/children']]) {
    const res = await call(method, url, { token: first.token, payload: { name: '小明' } });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
    assert.equal(res.json().code, 'PARENT_PIN_CHANGE_REQUIRED');
  }

  const change = newPin => call('PUT', '/api/auth/parent-pin', { token: first.token, payload: { old_pin: '1234', new_pin: newPin } });
  assert.match((await change('1234')).json().error, /默认 PIN/);
  assert.equal((await change('12345')).statusCode, 400);
  assert.equal((await change('5678')).statusCode, 200);

  // Changing the PIN ends the old session; the new PIN opens the console normally.
  assert.equal((await call('GET', '/api/task-templates', { token: first.token })).statusCode, 401);
  assert.deepEqual((await call('GET', '/api/auth/setup')).json(), { parent_pin_is_default: false });
  assert.equal((await login('1234')).success, undefined);
  const second = await login('5678');
  assert.equal(second.must_change_pin, false);
  assert.equal((await call('GET', '/api/task-templates', { token: second.token })).statusCode, 200);
  assert.equal(ctx.app.services.authService.updateParentPin('5678', '5678').status, 400);
});

test('children keep using the app while the parent PIN is still the default', async t => {
  const { ctx, call } = await fixture(t);
  const child = ctx.app.services.childrenService.createChild({ name: '小明' });
  const { token } = (await call('POST', '/api/auth/child-login', { payload: { child_id: child.id } })).json();
  assert.equal((await call('GET', `/api/daily-tasks?child_id=${child.id}`, { token })).statusCode, 200);
  assert.equal((await call('GET', `/api/children/${child.id}/stats`, { token })).statusCode, 200);
});

test('databases from before the flag derive it from whether their PIN is still the default', async t => {
  const { ctx } = await fixture(t);
  const flag = () => ctx.db.prepare("SELECT value FROM settings WHERE key = 'parent_pin_is_default'").get()?.value;
  const forget = () => ctx.db.prepare("DELETE FROM settings WHERE key = 'parent_pin_is_default'").run();

  forget();
  initDb(ctx.db);
  assert.equal(flag(), '1');

  ctx.app.services.authService.updateParentPin('1234', '2468');
  forget();
  initDb(ctx.db);
  assert.equal(flag(), '0');
  // Re-running initialization keeps the stored value.
  initDb(ctx.db);
  assert.equal(flag(), '0');
});
