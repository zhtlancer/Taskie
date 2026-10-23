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
  const storage = memoryStorage(), receipts = memoryStorage();
  const action = { kind, role: kind === 'backfill' ? 'parent' : 'child', child_id: 'child-1', task_id: 'task-1', title: '测试任务',
    payload: kind === 'redemption' ? { reward_id: 'task-1' } : { date: '2026-10-22', amount: 5, duration_seconds: 120 } };
  const first = pendingWrites(storage, receipts).prepare(action);
  action.payload.amount = 99;
  const reloaded = pendingWrites(storage, receipts);
  assert.deepEqual(reloaded.list(), [first], 'persisted body is independent of later form edits');
  assert.deepEqual(reloaded.prepare({ ...first, payload: { ...first.payload } }), first);
  assert.equal(reloaded.list()[0].request_id, first.request_id);
  assert.notEqual(reloaded.prepare({ ...first, child_id: 'child-2' }).request_id, first.request_id, 'children do not share an operation');
  assert.throws(() => reloaded.prepare({ ...first, payload: { amount: 9 } }), /请先.*待确认请求/, 'editing an uncertain operation must not create another id');
  assert.ok(reloaded.list().some(entry => entry.request_id === first.request_id));
  reloaded.done(first.request_id);
  assert.notEqual(reloaded.prepare(first).request_id, first.request_id, 'success permits a new operation');
});

test('payload key order does not change identity; storage failure prevents creating a write', () => {
  const store = pendingWrites(memoryStorage(), memoryStorage());
  const action = { kind: 'progress', role: 'child', child_id: 'c', task_id: 't', payload: { date: '2026-10-22', amount: 2 } };
  const first = store.prepare(action);
  assert.equal(store.prepare({ ...action, payload: { amount: 2, date: '2026-10-22' } }).request_id, first.request_id);
  assert.throws(() => pendingWrites({ length: 0, setItem() { throw new Error('quota'); } }, memoryStorage()).prepare(action), /quota/);
});

for (const kind of ['progress', 'backfill', 'redemption']) test(`${kind}: copied sessions reconcile confirmed ids and give new actions fresh ids`, () => {
  const original = memoryStorage(), copied = memoryStorage(), receipts = memoryStorage();
  const action = { kind, role: 'child', child_id: 'c', task_id: 't', payload: { amount: 1 } };
  const attempt = {};
  const a = pendingWrites(original, receipts), b = pendingWrites(copied, receipts);
  const first = a.prepare(action, attempt);
  const key = original.key(0), snapshot = original.getItem(key);
  copied.setItem(key, snapshot);
  b.done(first.request_id);
  assert.deepEqual(a.list(), [], 'reconcile even when a storage event was missed');
  original.setItem(key, snapshot);
  assert.deepEqual(a.list(), [], 'restoring a stale session cannot resurrect the request');
  assert.throws(() => a.prepare(action, attempt), /原操作已确认/, 'a failed form is still the original operation');
  const next = a.prepare(action, {});
  assert.notEqual(next.request_id, first.request_id, 'identical new operation uses a fresh id');
  assert.equal(receipts.length, 1);
  assert.equal(receipts.getItem(receipts.key(0)), '1', 'receipt contains no child or request data');
});

test('an edited form cannot change progress, date, position or duration before confirmation', () => {
  for (const payload of [{ amount: 3 }, { position: 4 }, { date: '2026-10-23' }, { duration_seconds: 180 }]) {
    const store = pendingWrites(memoryStorage(), memoryStorage());
    const action = { kind: 'progress', role: 'child', child_id: 'c', task_id: 't', payload: { amount: 1, position: 1, date: '2026-10-22', duration_seconds: 120 } };
    const first = store.prepare(action);
    assert.throws(() => store.prepare({ ...action, payload: { ...action.payload, ...payload } }), /尚未提交/);
    assert.deepEqual(store.list(), [first]);
  }
});

test('confirmation storage failure keeps the original request available for an exact replay', () => {
  const session = memoryStorage(), receipts = memoryStorage();
  const store = pendingWrites(session, receipts);
  const action = { kind: 'progress', role: 'child', child_id: 'c', task_id: 't', payload: { amount: 1 } };
  const first = store.prepare(action);
  receipts.setItem = () => { throw new Error('quota'); };
  assert.throws(() => store.done(first.request_id), /quota/);
  assert.deepEqual(store.list(), [first]);
  assert.deepEqual(store.prepare(action), first);
});

test('a changed form encountering an existing uncertain request stays bound to that attempt', () => {
  const store = pendingWrites(memoryStorage(), memoryStorage());
  const action = { kind: 'backfill', role: 'parent', child_id: 'c', task_id: 't', payload: { amount: 1 } };
  const first = store.prepare(action);
  const attempt = {}, edited = { ...action, payload: { amount: 3 } };
  assert.throws(() => store.prepare(edited, attempt), /尚未提交/);
  store.done(first.request_id);
  assert.throws(() => store.prepare(edited, attempt), /原操作已确认/);
  assert.deepEqual(store.list(), []);
});
