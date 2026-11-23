import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordTestDraftStore, wordTestScope, WORD_TEST_DRAFT_PREFIX } from '../src/utils/wordTestDrafts.js';
const memory = () => {
  const data = new Map();
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i],
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
};
const token = (role = 'parent', child_id = 'a', epoch = 'family') =>
  `a.${Buffer.from(JSON.stringify({ role, child_id, epoch })).toString('base64url')}.sig`;
const scope = (child = 'a', kind = 'answer', record = 'test/item', role = 'parent', generation = 'initial') =>
  wordTestScope(token(role, child), generation, child, kind, record);
test('self-test drafts isolate owners, languages, tests, items, generations and roles without storing tokens', () => {
  const storage = memory(),
    store = wordTestDraftStore(storage),
    target = scope();
  store.save(target, { typed: 'draft', revealed: false });
  for (const other of [
    scope('b'),
    scope('a', 'create', 'en'),
    scope('a', 'answer', 'other/item'),
    scope('a', 'answer', 'test/other'),
    scope('a', 'answer', 'test/item', 'child'),
    scope('a', 'answer', 'test/item', 'parent', 'restored'),
  ])
    assert.equal(store.read(other), null);
  assert.equal(wordTestScope(token('child', 'a'), 'initial', 'b', 'answer', 'x'), null);
  assert.equal(store.read(target).payload.typed, 'draft');
  assert.ok(!storage.getItem(storage.key(0)).includes('.sig'));
});
test('uncertain submissions retain the exact body and key after a new store instance, corruption and expiry cannot become submissions', () => {
  const storage = memory();
  let now = 1000;
  const store = wordTestDraftStore(storage, () => now),
    target = scope();
  const attempt = {
    request_id: 'answer_fixed_key',
    target: { test_id: 'test', item_id: 'item' },
    body: { request_id: 'answer_fixed_key', typed_answer: 'May' },
  };
  store.save(target, { typed: 'May', revealed: false }, attempt);
  assert.deepEqual(wordTestDraftStore(storage, () => now).read(target).attempt, attempt);
  now += 86400000;
  assert.equal(store.read(target), null);
  store.save(target, { typed: 'text' }, { ...attempt, body: { request_id: 'changed' } });
  assert.equal(store.read(target), null);
  storage.setItem(WORD_TEST_DRAFT_PREFIX + JSON.stringify(target), 'broken');
  store.clearAll();
  assert.equal(storage.length, 0);
});
test('capacity and storage errors preserve live pending requests and unrelated settings', () => {
  const storage = memory(),
    store = wordTestDraftStore(storage);
  storage.setItem('keep', 'yes');
  for (let i = 0; i < 100; i++) store.save(scope('a', 'answer', String(i)), { typed: String(i) });
  assert.throws(() => store.save(scope('b'), { typed: 'new' }), /已满/);
  assert.equal(store.read(scope('a', 'answer', '0')).payload.typed, '0');
  store.clearAll();
  assert.equal(storage.length, 1);
  storage.setItem = () => {
    throw new Error('quota');
  };
  assert.throws(() => store.save(scope(), { typed: 'keep this' }), /quota/);
});
test('explicit session clearing also removes self-test drafts from other pages', async () => {
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = memory();
  try {
    const store = wordTestDraftStore();
    store.save(scope(), { typed: 'secret' });
    const { clearTokens } = await import('../src/utils/session.js');
    clearTokens();
    assert.equal(store.read(scope()), null);
  } finally {
    if (previous) globalThis.sessionStorage = previous;
    else delete globalThis.sessionStorage;
  }
});
