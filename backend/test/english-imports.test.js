const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { validateWordImports } = require('../src/db/word-import-constraints');
const parent = { role: 'parent' };
async function fixture(t) {
  const c = createTestApp({ dictDir: null }); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const child = c.app.services.childrenService.createChild({ name: '英语批量甲' }), other = c.app.services.childrenService.createChild({ name: '英语批量乙' });
  const call = (path, payload, actor = parent) => c.app.inject({ method: 'POST', url: `/api/english-words/${path}`, payload: { child_id: child.id, ...payload }, headers: { authorization: `Bearer ${c.app.jwt.sign({ ...actor, epoch: c.app.sessionEpoch() })}` } });
  const book = (name = '英语', language = 'en', childId = child.id) => c.app.services.wordBooksService.create({ child_id: childId, language, name }, parent);
  const word = data => c.app.services.englishWordsService.createWord({ child_id: child.id, ...data }, parent);
  return { ...c, child, other, call, book, word };
}
test('English preview distinguishes link-only, already-in-book and legacy duplicate without writing', async t => {
  const c = await fixture(t), b = c.book(), may = c.word({ word: 'May', definition_zh: '五月' }), apple = c.word({ word: 'apple', definition_zh: '苹果' });
  c.app.services.wordBooksService.add(b.id, { english_word_id: apple.id }, parent);
  for (const target of [{ book_id: b.id }, { book_meta: { name: '新本' } }, {}]) {
    const response = await c.call('batch-preview', { text: 'May\napple\nmay\t可以', use_dictionary: false, ...target });
    assert.equal(response.statusCode, 200, response.body);
    const rows = response.json().items;
    assert.equal(rows[0].status, Object.keys(target).length ? 'link' : 'duplicate');
    assert.equal(rows[0].existing_id, may.id);
    assert.equal(rows[1].status, target.book_id ? 'in_book' : target.book_meta ? 'link' : 'duplicate');
    assert.equal(rows[2].status, 'manual'); assert.deepEqual(rows[2].existing_case_variants, ['May']);
  }
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM word_books').get().n, 1);
});
test('modern batch preserves senses, strict case and audio while existing rows only gain membership', async t => {
  const c = await fixture(t), may = c.word({ word: 'May', definition_zh: '五月', strict_case: true, categories: ['error_prone'] });
  const before = c.db.prepare('SELECT * FROM english_words WHERE id = ?').get(may.id);
  const payload = { request_id: 'english-book-import-0001', book_meta: { name: '合并导入', source: 'PEP', unit: 'U1' }, categories: ['write'], items: [
    { word: 'May', existing_id: may.id, existing_only: true },
    { word: 'may', strict_case: true, confirmed_case_variants: ['May'], senses: [{ id: 'manual', definition_zh: '可以', definition_en: 'be possible', audio_refs: [] }, { id: 'other', definition_zh: '也许' }], primary_sense_id: 'other' }
  ] };
  const response = await c.call('batch', payload); assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().added_count, 1); assert.equal(response.json().linked_count, 1);
  assert.deepEqual(c.db.prepare('SELECT * FROM english_words WHERE id = ?').get(may.id), before);
  const added = c.app.services.englishWordsService.getWord(response.json().items.find(item => item.text === 'may').id);
  assert.equal(added.strict_case, true); assert.equal(added.senses.length, 2); assert.equal(added.primary_sense_id, 'other'); assert.deepEqual(added.senses[0].audio_refs, []);
  assert.deepEqual(added.categories, ['write']);
  assert.deepEqual((await c.call('batch', payload)).json(), response.json());
  for (const table of ['word_study_states', 'word_study_days', 'daily_tasks', 'point_logs']) assert.equal(c.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  validateWordImports(c.db);
});
test('case confirmation, stale preview and invalid new content roll back whole batches and books', async t => {
  const c = await fixture(t), may = c.word({ word: 'May', definition_zh: '五月' });
  const base = { request_id: 'invalid-english-import-0001', book_meta: { name: '不能残留' } };
  const conflict = await c.call('batch', { ...base, items: [{ word: 'may', definition_zh: '可能' }] });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().code, 'ENGLISH_CASE_CONFIRMATION_REQUIRED');
  for (const items of [[{ word: 'river', definition_zh: '河' }, { word: 'water', strict_case: 'invalid' }], [{ word: 'May', existing_only: true, existing_id: 'other-child-id' }]]) assert.equal((await c.call('batch', { ...base, items })).statusCode >= 400, true);
  c.db.prepare('DELETE FROM english_words WHERE id = ?').run(may.id);
  const stale = await c.call('batch', { ...base, items: [{ word: 'May', existing_only: true, existing_id: may.id }] });
  assert.equal(stale.statusCode, 409);
  for (const table of ['english_words', 'word_books', 'word_import_receipts']) assert.equal(c.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});
test('English targets and item metadata enforce family scope, child scattered-only imports and 100-word limit', async t => {
  const c = await fixture(t), own = { role: 'child', child_id: c.child.id }, item = { word: 'river', definition_zh: '河' };
  for (const path of ['batch-preview', 'batch']) {
    const base = path === 'batch' ? { request_id: 'child-en-import-0001', items: [item] } : { text: 'river', use_dictionary: false };
    assert.equal((await c.call(path, { ...base, child_id: c.other.id }, own)).statusCode, 403);
    for (const key of ['book_id', 'book_meta', 'source', 'unit', 'textbook']) {
      assert.equal((await c.call(path, { ...base, [key]: '' }, own)).statusCode, 403);
      assert.equal((await c.call(path, { ...base, items: [{ ...item, [key]: '' }] }, own)).statusCode, 403);
    }
  }
  const added = await c.call('batch', { request_id: 'child-en-import-0002', items: [{ ...item, note: '自己的笔记' }] }, own);
  assert.equal(added.statusCode, 201, added.body);
  assert.equal((await c.call('batch', { items: [{ word: 'water', book_id: 'forbidden' }] }, own)).statusCode, 403, 'legacy shape also rejects nested management fields');
  assert.equal((await c.call('batch', { request_id: 'too-many-en-import-0001', items: Array(101).fill(item) })).statusCode, 400);
  for (const [bookId, status] of [[c.book('语文', 'zh').id, 400], [c.book('别人英语', 'en', c.other.id).id, 403], ['missing', 404]]) assert.equal((await c.call('batch', { request_id: 'bad-en-target-0001', book_id: bookId, items: [item] })).statusCode, status);
});
test('deleted targets cannot be resurrected and legacy request/response remains compatible', async t => {
  const c = await fixture(t), b = c.book(), payload = { request_id: 'en-replay-target-0001', book_id: b.id, items: [{ word: 'river' }] };
  const saved = await c.call('batch', payload); assert.equal(saved.statusCode, 201, saved.body);
  c.db.prepare('DELETE FROM english_words WHERE id = ?').run(saved.json().items[0].id);
  assert.deepEqual((await c.call('batch', payload)).json(), saved.json());
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM english_words').get().n, 0);
  c.db.prepare('DELETE FROM word_books WHERE id = ?').run(b.id);
  assert.equal((await c.call('batch', payload)).json().code, 'WORD_IMPORT_GONE');
  const legacy = await c.call('batch', { textbook: '旧客户端', unit: 'U2', items: [{ word: 'book', definition_zh: '书' }] });
  assert.equal(legacy.statusCode, 201); assert.equal(legacy.json().added.length, 1); assert.deepEqual(legacy.json().skipped, []);
  assert.equal(c.app.services.englishWordsService.getWord(legacy.json().added[0].id).books[0].source, '旧客户端');
  validateWordImports(c.db);
});
