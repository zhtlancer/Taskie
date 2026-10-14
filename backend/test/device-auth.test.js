const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createTestApp, cleanupTestApp } = require('./helper');
const { hashToken } = require('../src/device-auth');

async function fixture(t) {
  const ctx = createTestApp({ authenticated: false, deviceAuth: true });
  const file = ctx.app.deviceRegistry.file;
  t.after(() => { cleanupTestApp(ctx); fs.rmSync(file, { force: true }); });
  await ctx.app.ready();
  const call = (method, url, { cookie, payload, headers = {} } = {}) =>
    ctx.rawInject({ method, url, payload, headers: { ...headers, ...(cookie ? { cookie: `taskie_device=${cookie}` } : {}) } });
  const tokenFrom = res => /taskie_device=([^;]+)/.exec(res.headers['set-cookie'] || '')?.[1];
  // Pairs a new device and authorizes it directly, returning its token.
  const authorize = (label = '测试设备') => {
    const token = 'x'.repeat(10) + Math.random().toString(36).slice(2) + 'y'.repeat(30);
    ctx.app.deviceRegistry.add(hashToken(token), label);
    return token;
  };
  const parentToken = async cookie => (await call('POST', '/api/auth/parent-login', { cookie, payload: { pin: '1234' } })).json().token;
  return { ctx, file, call, tokenFrom, authorize, parentToken };
}

test('without an authorized device only the pairing page, pairing API and health check respond', async t => {
  const { call } = await fixture(t);
  for (const [method, url] of [['GET', '/api/children'], ['POST', '/api/auth/parent-login'], ['GET', '/uploads/x.jpg'], ['GET', '/api/auth/setup']]) {
    const res = await call(method, url, { payload: {} });
    assert.equal(res.statusCode, 401, url);
    assert.equal(res.json().code, 'DEVICE_NOT_AUTHORIZED', url);
  }
  // Page navigations get the pairing page instead of the app.
  const page = await call('GET', '/parent/dashboard', { headers: { accept: 'text/html' } });
  assert.equal(page.statusCode, 401);
  assert.match(page.body, /这台设备还没有授权/);
  assert.equal((await call('GET', '/api/health')).statusCode, 200);
  assert.match((await call('GET', '/api/device/page')).body, /配对码/);
  // A forged or unknown cookie is no better than none.
  assert.equal((await call('GET', '/api/children', { cookie: 'forged-token-value-that-is-long-enough' })).statusCode, 401);
});

test('a new device gets a token cookie and a pairing code that a parent approves', async t => {
  const { ctx, file, call, tokenFrom, authorize, parentToken } = await fixture(t);
  const first = await call('POST', '/api/device/pair');
  const token = tokenFrom(first);
  assert.ok(token && token.length >= 43);
  assert.match(first.headers['set-cookie'], /HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(first.headers['set-cookie'], /Secure/);
  const { code, expires_at } = first.json();
  assert.match(code, /^\d{6}$/);
  assert.ok(Date.parse(expires_at) > Date.now());
  // Asking again keeps the same code; status reports it.
  assert.equal((await call('POST', '/api/device/pair', { cookie: token })).json().code, code);
  assert.deepEqual((await call('GET', '/api/device/status', { cookie: token })).json(), { authorized: false, code, expires_at });
  // Behind an HTTPS proxy the cookie is Secure.
  assert.match((await call('POST', '/api/device/pair', { headers: { 'x-forwarded-proto': 'https' } })).headers['set-cookie'], /; Secure/);

  // The parent approves from an authorized device.
  const parentDevice = authorize('家长手机');
  const parent = await parentToken(parentDevice);
  const approve = payload => call('POST', '/api/devices/approve', { cookie: parentDevice, payload, headers: { authorization: `Bearer ${parent}` } });
  assert.equal((await approve({ code: '12345' })).statusCode, 400);
  assert.equal((await approve({ code: code === '000000' ? '000001' : '000000' })).statusCode, 404);
  const approved = await approve({ code: `${code.slice(0, 3)} ${code.slice(3)}`, label: '小红的平板' });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.deepEqual([approved.json().label, approved.json().current], ['小红的平板', false]);

  assert.deepEqual((await call('GET', '/api/device/status', { cookie: token })).json(), { authorized: true });
  assert.equal((await call('GET', '/api/children', { cookie: token })).statusCode, 200);
  // The code is used up, and only hashes are written to the file.
  assert.equal((await approve({ code })).statusCode, 404);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(hashToken(token)) && !text.includes(token));
  assert.match(text, /小红的平板/);
  // Opening the app refreshes the cookie.
  assert.match((await call('GET', '/', { cookie: token, headers: { accept: 'text/html' } })).headers['set-cookie'] || '', /taskie_device=/);
  assert.ok(ctx.app.deviceRegistry.list().every(device => device.id.length === 16));
});

test('parents list and revoke devices; children and unauthorized requests cannot manage them', async t => {
  const { ctx, file, call, authorize, parentToken } = await fixture(t);
  const phone = authorize('爸爸的 iPhone');
  const tablet = authorize('客厅 iPad');
  const parent = await parentToken(phone);
  const headers = { authorization: `Bearer ${parent}` };
  const devices = (await call('GET', '/api/devices', { cookie: phone, headers })).json();
  assert.deepEqual(devices.map(d => [d.label, d.current]), [['爸爸的 iPhone', true], ['客厅 iPad', false]]);
  assert.ok(devices[0].last_seen_at);

  const child = ctx.app.services.childrenService.createChild({ name: '小明' });
  const childToken = (await call('POST', '/api/auth/child-login', { cookie: tablet, payload: { child_id: child.id } })).json().token;
  assert.equal((await call('GET', '/api/devices', { cookie: tablet, headers: { authorization: `Bearer ${childToken}` } })).statusCode, 403);

  const tabletId = devices[1].id;
  assert.equal((await call('DELETE', `/api/devices/${tabletId}`, { cookie: phone, headers })).statusCode, 200);
  assert.equal((await call('GET', '/api/children', { cookie: tablet })).statusCode, 401);
  assert.equal((await call('DELETE', `/api/devices/${tabletId}`, { cookie: phone, headers })).statusCode, 404);
  assert.equal((await call('DELETE', '/api/devices/not-an-id', { cookie: phone, headers })).statusCode, 400);

  // Hand edits take effect without a restart: removing the phone's line revokes it too.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter(line => !line.includes('爸爸')).join('\n'));
  assert.equal((await call('GET', '/api/children', { cookie: phone })).statusCode, 401);
});

test('pairing requests are capped and expire', async t => {
  const { ctx, call } = await fixture(t);
  for (let i = 0; i < 30; i++) assert.equal((await call('POST', '/api/device/pair')).statusCode, 200);
  assert.equal((await call('POST', '/api/device/pair')).statusCode, 429);
  ctx.db.prepare("UPDATE device_pairings SET expires_at = '2000-01-01T00:00:00.000Z'").run();
  assert.equal((await call('POST', '/api/device/pair')).statusCode, 200);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM device_pairings').get().n, 1);
});

test('the server command approves, lists and revokes devices', t => {
  const dir = fs.mkdtempSync(path.join(__dirname, '../uploads/cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, DATABASE_PATH: path.join(dir, 'data.sqlite'), UPLOAD_DIR: path.join(dir, 'uploads') };
  const cli = (...args) => execFileSync(process.execPath, [path.join(__dirname, '../src/cli.js'), ...args], { env, encoding: 'utf8' });
  // A device asks for a code through the same database the server uses.
  const { getDb } = require('../src/db');
  const { DeviceRegistry } = require('../src/device-auth');
  const db = getDb(env.DATABASE_PATH);
  const registry = new DeviceRegistry(db, path.join(dir, 'authorized_tokens'));
  const { code } = registry.startPairing('a-device-token-that-is-long-enough-to-use');
  db.close();

  assert.match(cli('approve-device', code, '爸爸的', 'iPhone'), /已授权设备「爸爸的 iPhone」/);
  assert.ok(registry.isAuthorized('a-device-token-that-is-long-enough-to-use'));
  const id = /^([0-9a-f]{16})/.exec(cli('list-devices'))[1];
  assert.match(cli('revoke-device', id), /已撤销/);
  assert.match(cli('list-devices'), /还没有已授权的设备/);
  assert.throws(() => cli('approve-device', '000000'), /配对码无效/);
});

test('other websites cannot read the API through an authorized device (no CORS)', async t => {
  const { call, authorize } = await fixture(t);
  const device = authorize();
  const res = await call('GET', '/api/children', { cookie: device, headers: { origin: 'https://evil.example' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(res.headers['access-control-allow-credentials'], undefined);
  const preflight = await call('OPTIONS', '/api/children', { cookie: device, headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);
});
