import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPinia, setActivePinia } from 'pinia';
import * as session from '../src/utils/session.js';
import { pendingWriteStore as pending } from '../src/utils/requestId.js';

const memoryStorage = () => {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
};
function storage(t) {
  for (const key of ['sessionStorage', 'localStorage']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: memoryStorage(), configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
}
const token = (role, child_id, nonce = 1) => `header.${Buffer.from(JSON.stringify({ role, child_id, nonce, exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`;
const action = (role, child_id = 'a') => ({ kind: 'progress', role, child_id, task_id: 'task', payload: { amount: 1 } });

// Load the real store actions with only HTTP replaced. These cases never issue a request.
async function loadStore(name) {
  const url = new URL(`../src/stores/${name}.js`, import.meta.url);
  const source = (await readFile(url, 'utf8'))
    .replace(/import api from [^;]+;/, 'const api = {};')
    .replace(/from 'pinia'/, `from '${new URL('../node_modules/pinia/dist/pinia.mjs', import.meta.url)}'`)
    .replace(/from '(\.\.[^']+)'/g, (_, path) => `from '${new URL(path, url)}'`);
  setActivePinia(createPinia());
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

for (const role of ['child', 'parent']) test(`${role}: 401 and same-identity login preserve the exact operation and receipts`, t => {
  storage(t);
  session.saveToken(role, token(role, 'a'));
  const attempt = {}, first = pending.prepare(action(role), attempt);
  pending.done('receipt-to-keep');
  session.clearTokens(); // The non-login 401 interceptor uses this operation.
  assert.equal(session.getToken(), null);
  assert.equal(sessionStorage.getItem('parent_auth'), null);
  assert.deepEqual(pending.list(), [first]);
  session.saveToken(role, token(role, 'a', 2));
  assert.deepEqual(pending.list(), [first]);
  assert.deepEqual(pending.prepare(action(role), attempt), first, 'retry keeps the original id and payload');
  assert.equal(localStorage.length, 1);
});

test('replacing a token without expiry retains the same identity', t => {
  storage(t);
  session.saveToken('child', token('child', 'a'));
  const first = pending.prepare(action('child'));
  session.saveToken('child', token('child', 'a', 2));
  assert.deepEqual(pending.list(), [first]);
});

for (const [role, childId] of [['child', 'a'], ['child', 'b'], ['parent', undefined]]) {
  test(`login ${role}:${childId || ''} deletes only requests from other identities`, t => {
    storage(t);
    const entries = [pending.prepare(action('child', 'a')), pending.prepare(action('child', 'b')),
      pending.prepare(action('parent', 'a')), pending.prepare(action('parent', 'b'))];
    pending.done('receipt-to-keep');
    session.saveToken(role, token(role, childId));
    const expected = entries.filter(entry => entry.role === role && (role === 'parent' || entry.child_id === childId));
    assert.deepEqual(pending.list(), expected, 'parent child_id is the target, never the owner');
    assert.equal(localStorage.length, 1);
  });
}

test('parent login takes over a child session; child login removes the parent credential', t => {
  storage(t);
  session.saveToken('child', token('child', 'a'));
  session.saveToken('parent', token('parent'));
  assert.equal(session.getToken('child'), null);
  const first = pending.prepare(action('parent'));
  session.saveToken('child', token('child', 'a'));
  assert.equal(session.getToken('parent'), null);
  assert.equal(session.currentRole(), 'child');
  assert.ok(!pending.list().some(entry => entry.request_id === first.request_id));
});

test('parent explicit logout clears requests, credentials and stale forms, but keeps receipts', async t => {
  storage(t);
  const { useParentStore } = await loadStore('parent');
  session.saveToken('parent', token('parent'));
  const attempt = {}; pending.prepare(action('parent'), attempt); pending.done('receipt-to-keep');
  useParentStore().logout();
  assert.equal(session.getToken(), null);
  assert.deepEqual(pending.list(), []);
  assert.equal(localStorage.length, 1);
  assert.throws(() => pending.prepare(action('parent'), attempt), /会话已结束/);
});

test('PIN-change session reset preserves parent requests for reauthentication', async t => {
  storage(t);
  const { useParentStore } = await loadStore('parent');
  session.saveToken('parent', token('parent'));
  const first = pending.prepare(action('parent'));
  const parent = useParentStore();
  parent.resetSession();
  assert.equal(parent.isAuthenticated, false);
  assert.equal(session.getToken(), null);
  session.saveToken('parent', token('parent', undefined, 2));
  assert.deepEqual(pending.list(), [first]);
});

test('successful backup restore ends the session and clears pending requests', t => {
  storage(t);
  session.saveToken('parent', token('parent'));
  pending.prepare(action('parent')); pending.done('receipt-to-keep');
  session.endSession();
  assert.equal(session.getToken(), null);
  assert.deepEqual(pending.list(), []);
  assert.equal(localStorage.length, 1);
});

for (const role of ['child', 'parent']) test(`${role}: account switch clears child requests but preserves a browsing parent's requests`, async t => {
  storage(t);
  const { useChildStore } = await loadStore('child');
  session.saveToken(role, token(role, 'a'));
  const first = pending.prepare(action(role));
  const child = useChildStore();
  child.switchAccount();
  assert.deepEqual(pending.list(), role === 'parent' ? [first] : []);
  assert.equal(Boolean(session.getToken()), role === 'parent');
  assert.equal(sessionStorage.getItem('current_child'), null);
});
