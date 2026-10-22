import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRequestId, pendingWrites } from '../src/utils/requestId.js';

test('request ids satisfy the server format with or without crypto.randomUUID', () => {
  assert.match(newRequestId(), /^[a-zA-Z0-9_-]{8,100}$/);
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  try { assert.match(newRequestId(), /^[a-zA-Z0-9_-]{8,100}$/); }
  finally { Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true }); }
});

const memoryStorage = () => {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
};

for (const kind of ['progress', 'redemption', 'backfill']) test(`${kind}: reload preserves the complete operation and id until a confirmed response`, () => {
  const storage = memoryStorage();
  const action = { kind, role: kind === 'backfill' ? 'parent' : 'child', child_id: 'child-1', task_id: 'task-1', title: '测试任务',
    payload: kind === 'redemption' ? { reward_id: 'task-1' } : { date: '2026-10-22', amount: 5, duration_seconds: 120 } };
  const first = pendingWrites(storage).prepare(action);
  action.payload.amount = 99;
  const reloaded = pendingWrites(storage);
  assert.deepEqual(reloaded.list(), [first], 'persisted body is independent of later form edits');
  assert.deepEqual(reloaded.prepare({ ...first, payload: { ...first.payload } }), first);
  assert.equal(reloaded.list()[0].request_id, first.request_id);
  assert.notEqual(reloaded.prepare({ ...first, child_id: 'child-2' }).request_id, first.request_id, 'children do not share an operation');
  assert.notEqual(reloaded.prepare({ ...first, payload: { amount: 9 } }).request_id, first.request_id, 'different input has its own identity and preserves the original request');
  assert.ok(reloaded.list().some(entry => entry.request_id === first.request_id));
  reloaded.done(first.request_id);
  assert.notEqual(reloaded.prepare(first).request_id, first.request_id, 'success permits a new operation');
});

test('payload key order does not change identity; storage failure prevents creating a write', () => {
  const store = pendingWrites(memoryStorage());
  const action = { kind: 'progress', role: 'child', child_id: 'c', task_id: 't', payload: { date: '2026-10-22', amount: 2 } };
  const first = store.prepare(action);
  assert.equal(store.prepare({ ...action, payload: { amount: 2, date: '2026-10-22' } }).request_id, first.request_id);
  assert.throws(() => pendingWrites({ length: 0, setItem() { throw new Error('quota'); } }).prepare(action), /quota/);
});
