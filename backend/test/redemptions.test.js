const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
  const childHeaders = async child => {
    const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
    return { authorization: `Bearer ${login.token}` };
  };
  // Earn points through real check-offs so balances match production paths.
  const earn = async (child, points) => {
    await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: `任务${points}`, subject: '数学', points, child_ids: [child.id] } });
    const task = (await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}` })).json().find(t => t.points === points && !t.is_completed);
    await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${task.id}/complete` });
    return task;
  };
  const stats = async child => (await ctx.app.inject({ method: 'GET', url: `/api/children/${child.id}/stats` })).json();
  return { ctx, createChild, childHeaders, earn, stats };
}

test('parents manage reward items; children only see rewards on offer', async t => {
  const { ctx, createChild, childHeaders } = await fixture(t);
  const headers = await childHeaders(await createChild('小明'));

  const tv = await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload: { title: ' 看30分钟动画 ', icon_emoji: '📺', cost: 100 } });
  assert.equal(tv.statusCode, 201);
  assert.deepEqual({ ...tv.json(), id: undefined, created_at: undefined }, { id: undefined, created_at: undefined, title: '看30分钟动画', icon_emoji: '📺', cost: 100, is_active: true });
  const toy = (await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload: { title: '小玩具', cost: 300 } })).json();
  assert.equal(toy.icon_emoji, '🎁');

  for (const payload of [{ title: '', cost: 10 }, { title: '奖励', cost: 0 }, { title: '奖励', cost: 1.5 }, { title: '奖励', cost: '10' }, { title: '奖励' }]) {
    assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload })).statusCode, 400, JSON.stringify(payload));
  }

  const updated = await ctx.app.inject({ method: 'PUT', url: `/api/reward-items/${toy.id}`, payload: { cost: 250, is_active: false } });
  assert.equal(updated.json().cost, 250);
  assert.equal(updated.json().title, '小玩具');
  assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/reward-items/${toy.id}`, payload: { is_active: 'no' } })).statusCode, 400);

  assert.deepEqual((await ctx.app.inject({ method: 'GET', url: '/api/reward-items' })).json().map(i => i.title), ['看30分钟动画', '小玩具']);
  assert.deepEqual((await ctx.rawInject({ method: 'GET', url: '/api/reward-items', headers })).json().map(i => i.title), ['看30分钟动画']);

  for (const [method, url] of [['POST', '/api/reward-items'], ['PUT', `/api/reward-items/${toy.id}`], ['DELETE', `/api/reward-items/${toy.id}`]]) {
    assert.equal((await ctx.rawInject({ method, url, headers, payload: { title: '偷偷加', cost: 1 } })).statusCode, 403, `${method} ${url}`);
  }
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/reward-items/${toy.id}` })).statusCode, 200);
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: `/api/reward-items/${toy.id}` })).statusCode, 404);
});

test('redemption holds points while pending; approval spends them and rejection or cancellation releases them', async t => {
  const { ctx, createChild, childHeaders, earn, stats } = await fixture(t);
  const child = await createChild('小明');
  const headers = await childHeaders(child);
  await earn(child, 150);
  const item = (await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload: { title: '看动画', cost: 100 } })).json();
  const redeem = () => ctx.rawInject({ method: 'POST', url: `/api/children/${child.id}/redemptions`, headers, payload: { reward_id: item.id } });

  const first = await redeem();
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().status, 'pending');
  assert.deepEqual([(await stats(child)).total_points, (await stats(child)).available_points], [150, 50]);

  // Pending points are held, so a second request cannot overdraw the balance.
  const second = await redeem();
  assert.equal(second.statusCode, 409);
  assert.match(second.json().error, /还差 50 分/);

  // Children may cancel their own pending request but not approve it.
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/redemptions/${first.json().id}/approve`, headers })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/redemptions/${first.json().id}/cancel`, headers })).json().status, 'cancelled');
  assert.equal((await stats(child)).available_points, 150);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/redemptions/${first.json().id}/cancel`, headers })).statusCode, 409);

  const rejected = (await redeem()).json();
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/redemptions/${rejected.id}/reject` })).json().status, 'rejected');
  assert.equal((await stats(child)).available_points, 150);

  const approved = (await redeem()).json();
  assert.deepEqual((await ctx.app.inject({ method: 'GET', url: '/api/redemptions?status=pending' })).json().map(r => [r.id, r.child_name]), [[approved.id, '小明']]);
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/redemptions/${approved.id}/approve` })).json().status, 'approved');
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/redemptions/${approved.id}/reject` })).statusCode, 409);
  assert.deepEqual([(await stats(child)).total_points, (await stats(child)).available_points], [150, 50]);

  // Editing or deleting the reward does not rewrite redemption history.
  await ctx.app.inject({ method: 'PUT', url: `/api/reward-items/${item.id}`, payload: { title: '改名了', cost: 1 } });
  await ctx.app.inject({ method: 'DELETE', url: `/api/reward-items/${item.id}` });
  const history = (await ctx.rawInject({ method: 'GET', url: `/api/children/${child.id}/redemptions`, headers })).json();
  assert.deepEqual(history.map(r => [r.title, r.cost, r.status]).sort(), [['看动画', 100, 'approved'], ['看动画', 100, 'cancelled'], ['看动画', 100, 'rejected']]);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/api/redemptions?status=bogus' })).statusCode, 400);
});

test('children cannot redeem for, view or cancel another child, nor redeem unlisted rewards', async t => {
  const { ctx, createChild, childHeaders, earn } = await fixture(t);
  const a = await createChild('A'), b = await createChild('B');
  const headersA = await childHeaders(a);
  await earn(b, 50);
  const item = (await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload: { title: '贴纸', cost: 10 } })).json();
  const bRequest = (await ctx.app.inject({ method: 'POST', url: `/api/children/${b.id}/redemptions`, payload: { reward_id: item.id } })).json();

  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/children/${b.id}/redemptions`, headers: headersA, payload: { reward_id: item.id } })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/children/${b.id}/redemptions`, headers: headersA })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/redemptions/${bRequest.id}/cancel`, headers: headersA })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/redemptions', headers: headersA })).statusCode, 403);

  await ctx.app.inject({ method: 'PUT', url: `/api/reward-items/${item.id}`, payload: { is_active: false } });
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/children/${b.id}/redemptions`, payload: { reward_id: item.id } })).statusCode, 404);
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/children/${b.id}/redemptions`, payload: {} })).statusCode, 404);
});

test('spent points cannot be refunded by a child undoing a check-off, but parents can still correct it', async t => {
  const { ctx, createChild, childHeaders, earn, stats } = await fixture(t);
  const child = await createChild('小明');
  const headers = await childHeaders(child);
  const task = await earn(child, 100);
  const item = (await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload: { title: '看动画', cost: 80 } })).json();
  await ctx.rawInject({ method: 'POST', url: `/api/children/${child.id}/redemptions`, headers, payload: { reward_id: item.id } });

  const undo = await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${task.id}/uncomplete`, headers });
  assert.equal(undo.statusCode, 409);
  assert.equal((await stats(child)).available_points, 20);

  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${task.id}/uncomplete` })).statusCode, 200);
  assert.deepEqual([(await stats(child)).total_points, (await stats(child)).available_points], [0, -80]);
});

test('encoded routes enforce parent privileges and decoded child ownership', async t => {
  const { ctx, createChild, childHeaders, earn } = await fixture(t);
  const a = await createChild('A'), b = await createChild('B');
  const headers = await childHeaders(a);
  await earn(a, 100); await earn(b, 100);
  const service = ctx.app.services.redemptionsService;
  const item = service.createItem({ title: '贴纸', cost: 10 });
  const own = service.requestRedemption(a.id, item.id), other = service.requestRedemption(b.id, item.id);
  const encodedId = `%${a.id.charCodeAt(0).toString(16)}${a.id.slice(1)}`;
  const send = (method, url, payload) => ctx.rawInject({ method, url, headers, ...(payload ? { payload } : {}) });
  for (const prefix of ['/api/redemptions', '/api/%72edemptions', '/%61pi/redemptions']) {
    assert.equal((await send('GET', prefix)).statusCode, 403, prefix);
    for (const action of ['approve', '%61pprove', 'appr%6fve', 'reject', '%72eject']) {
      assert.equal((await send('POST', `${prefix}/${own.id}/${action}`)).statusCode, 403, `${prefix}/${action}`);
    }
    assert.equal((await send('POST', `${prefix}/${other.id}/%63ancel`)).statusCode, 403, prefix);
  }
  for (const prefix of ['/api/reward-items', '/api/reward%2Ditems', '/api/%72eward-items', '/%61pi/reward-items']) {
    for (const [method, url] of [['POST', prefix], ['PUT', `${prefix}/${item.id}`], ['DELETE', `${prefix}/${item.id}`]]) {
      assert.equal((await send(method, url, { title: '偷改奖励', cost: 1 })).statusCode, 403, `${method} ${url}`);
    }
    assert.equal((await ctx.rawInject({ method: 'POST', url: prefix, payload: { title: '未登录', cost: 1 } })).statusCode, 401, prefix);
  }
  assert.equal((await send('GET', `/api/%63hildren/${encodedId}/redemptions`)).statusCode, 200);
  assert.equal((await send('GET', `/api/%63hildren/${b.id}/redemptions`)).statusCode, 403);
  assert.equal((await send('POST', `/api/%63hildren/${b.id}/redemptions`, { reward_id: item.id })).statusCode, 403);
  assert.equal(service.getRedemption(own.id).status, 'pending');
  assert.equal(service.getRedemption(other.id).status, 'pending');
  assert.equal(service.getItem(item.id).cost, 10);
  assert.equal(service.listItems().length, 1);
  assert.equal((await send('POST', `/api/%72edemptions/${own.id}/%63ancel`)).statusCode, 200);
  // Encoding is allowed for authorized operations; it must not change who can act.
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/%72edemptions/${other.id}/%61pprove` })).statusCode, 200);
});

test('pending requests remain discoverable beyond 200 newer history records and paginate without gaps', async t => {
  const { ctx, createChild, childHeaders, earn } = await fixture(t);
  const a = await createChild('A'), b = await createChild('B');
  const headers = await childHeaders(a);
  await earn(a, 1000);
  const item = ctx.app.services.redemptionsService.createItem({ title: '贴纸', cost: 1 });
  const insert = ctx.db.prepare(`INSERT INTO reward_redemptions
    (id, child_id, reward_id, title, icon_emoji, cost, status, requested_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
  ctx.db.transaction(() => {
    for (let i = 0; i < 201; i++) insert.run(`pending-${String(i).padStart(3, '0')}`, a.id, item.id, '贴纸', '🎁', 'pending', '2020-01-01T00:00:00.000Z');
    for (let i = 0; i < 200; i++) insert.run(`history-${String(i).padStart(3, '0')}`, a.id, item.id, '贴纸', '🎁', 'rejected', '2026-01-01T00:00:00.000Z');
    insert.run('other-pending', b.id, item.id, '贴纸', '🎁', 'pending', '2020-01-01T00:00:00.000Z');
  })();
  const get = async url => {
    const res = await ctx.app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  };
  const first = await get('/api/redemptions?status=pending&limit=200');
  const next = await get('/api/redemptions?status=pending&limit=200&offset=200');
  assert.equal(first.length, 200); assert.equal(next.length, 2);
  assert.equal(new Set([...first, ...next].map(r => r.id)).size, 202);
  assert.ok([...first, ...next].every(r => r.status === 'pending'));
  const history1 = await get('/api/redemptions?status=history&limit=15');
  const history2 = await get('/api/redemptions?status=history&limit=15&offset=15');
  assert.equal(history1.length, 15); assert.equal(history2.length, 15);
  assert.equal(new Set([...history1, ...history2].map(r => r.id)).size, 30);
  assert.ok([...history1, ...history2].every(r => r.status !== 'pending'));
  assert.deepEqual((await get('/api/redemptions?status=history&limit=15&offset=200')), []);
  const scoped = await ctx.rawInject({ method: 'GET', url: `/api/children/${a.id}/redemptions?status=pending&offset=200`, headers });
  assert.equal(scoped.statusCode, 200);
  assert.equal(scoped.json().length, 1);
  assert.equal(scoped.json()[0].child_id, a.id);
  for (const query of ['limit=0', 'limit=201', 'limit=1.5', 'limit=abc', 'limit=', 'limit=1&limit=2', 'offset=-1', 'offset=1.5', 'offset=9007199254740992']) {
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/redemptions?${query}` })).statusCode, 400, query);
  }
  // Resolving an old request still releases its held point.
  const available = ctx.app.services.rewardsService.getAvailablePoints(a.id);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/redemptions/pending-000/reject' })).statusCode, 200);
  assert.equal(ctx.app.services.rewardsService.getAvailablePoints(a.id), available + 1);
});

test('retrying a redemption with the same request id holds the points once', async t => {
  const { ctx, createChild, childHeaders, earn, stats } = await fixture(t);
  const child = await createChild('小明');
  const headers = await childHeaders(child);
  await earn(child, 100);
  const reward = (await ctx.app.inject({ method: 'POST', url: '/api/reward-items', payload: { title: '贴纸', cost: 10 } })).json();
  const redeem = (payload, h = headers) => ctx.rawInject({ method: 'POST', url: `/api/children/${child.id}/redemptions`, headers: h, payload });

  const first = await redeem({ reward_id: reward.id, request_id: 'redeem-request-1' });
  const retry = await redeem({ reward_id: reward.id, request_id: 'redeem-request-1' });
  assert.deepEqual([first.statusCode, retry.statusCode], [201, 201]);
  assert.equal(retry.json().id, first.json().id);
  assert.equal((await stats(child)).available_points, 90);
  assert.equal((await redeem({ reward_id: reward.id, request_id: 'redeem-request-2' })).statusCode, 201, 'a new id is a new redemption');
  assert.equal((await stats(child)).available_points, 80);

  const sister = await createChild('小红');
  await earn(sister, 50);
  const replayAsSister = await ctx.rawInject({ method: 'POST', url: `/api/children/${sister.id}/redemptions`, headers: await childHeaders(sister), payload: { reward_id: reward.id, request_id: 'redeem-request-1' } });
  assert.equal(replayAsSister.statusCode, 409);
  assert.equal((await redeem({ reward_id: reward.id, request_id: '短' })).statusCode, 400);
});
