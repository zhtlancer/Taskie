import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
const { mockStore } = await import('../src/api/mockStore.js');
const { getPendingRedemptions } = await import('../src/api/redemptions.js');

beforeEach(() => {
  storage.clear();
  mockStore.state = {
    children: [{ id: 'a', name: '小明', avatar_emoji: '🐱' }],
    task_templates: [], child_badges: [], badge_definitions: [],
    daily_tasks: [{ id: 'task', child_id: 'a', date: '2026-10-14', points: 100, is_completed: true }],
    point_logs: [{ id: 'log', child_id: 'a', daily_task_id: 'task', points: 100, earned_at: new Date().toISOString() }],
    reward_items: [{ id: 'tv', title: '看动画', icon_emoji: '📺', cost: 80, is_active: true }],
    reward_redemptions: []
  };
});

test('demo redemption holds points while pending and releases them when rejected', () => {
  const request = mockStore.requestRedemption('a', 'tv');
  assert.equal(request.status, 'pending');
  assert.equal(mockStore.getAvailablePoints('a'), 20);
  assert.throws(() => mockStore.requestRedemption('a', 'tv'), /还差 60 分/);
  assert.equal(mockStore.getRedemptions({ status: 'pending' })[0].child_name, '小明');

  mockStore.resolveRedemption(request.id, 'rejected');
  assert.equal(mockStore.getAvailablePoints('a'), 100);
  assert.throws(() => mockStore.resolveRedemption(request.id, 'approved'), /已处理/);
});

test('demo check-off cannot be undone once its points are spent', () => {
  mockStore.resolveRedemption(mockStore.requestRedemption('a', 'tv').id, 'approved');
  assert.throws(() => mockStore.uncompleteTask('task'), /已用于兑换/);
  assert.equal(mockStore.state.point_logs.length, 1);
});

test('demo shop works with saved states from before rewards existed', () => {
  delete mockStore.state.reward_items;
  delete mockStore.state.reward_redemptions;
  assert.deepEqual(mockStore.getRewardItems(), []);
  assert.equal(mockStore.getAvailablePoints('a'), 100);
  assert.equal(mockStore.createRewardItem({ title: '贴纸', cost: 10 }).title, '贴纸');
  assert.equal(mockStore.requestRedemption('a', mockStore.getRewardItems()[0].id).cost, 10);
});

test('pending requests are loaded across every page independently of newer history', async () => {
  mockStore.state.reward_redemptions = [
    ...Array.from({ length: 201 }, (_, i) => ({ id: `pending-${String(i).padStart(3, '0')}`, child_id: 'a', status: 'pending', requested_at: '2020-01-01' })),
    ...Array.from({ length: 200 }, (_, i) => ({ id: `history-${String(i).padStart(3, '0')}`, child_id: 'a', status: 'approved', requested_at: '2026-01-01' })),
    { id: 'other', child_id: 'b', status: 'pending', requested_at: '2020-01-01' }
  ];
  const calls = [];
  const pending = await getPendingRedemptions(params => {
    calls.push(params);
    return Promise.resolve(mockStore.getRedemptions(params));
  });
  assert.equal(pending.length, 202);
  assert.equal(new Set(pending.map(r => r.id)).size, 202);
  assert.deepEqual(calls.map(c => c.offset), [0, 200]);
  const own = await getPendingRedemptions(params => Promise.resolve(mockStore.getRedemptions({ ...params, childId: 'a' })));
  assert.equal(own.length, 201);
  const first = mockStore.getRedemptions({ status: 'history', limit: 15 });
  const next = mockStore.getRedemptions({ status: 'history', limit: 15, offset: 15 });
  assert.equal(new Set([...first, ...next].map(r => r.id)).size, 30);
  assert.ok([...first, ...next].every(r => r.status === 'approved'));
  assert.deepEqual(mockStore.getRedemptions({ status: 'history', offset: 200 }), []);
});

test('empty pending lists finish after one request and failed pages do not return partial results', async () => {
  let calls = 0;
  assert.deepEqual(await getPendingRedemptions(async () => { calls++; return []; }), []);
  assert.equal(calls, 1);
  await assert.rejects(() => getPendingRedemptions(async ({ offset }) => {
    if (offset) throw new Error('network failed');
    return Array.from({ length: 200 }, (_, i) => ({ id: i }));
  }), /network failed/);
});
