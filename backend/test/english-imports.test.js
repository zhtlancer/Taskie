const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { validateWordImports } = require('../src/db/word-import-constraints');
const parent = { role: 'parent' };
const classroomWords = `to （用于动词、名词或形容词后，使意思完整）；向，到，往
school 学校
hi 嘿，喂，你好
I 我
be 是
am 是
is 是
are 是
what 什么
you 你的；你们的
name 名字
hello 喂，哈啰，你好
my 我的
goodbye 再见
have 有，拥有
a 一（个）
an 一（个）
nice 令人愉快的
day 一天
good 好的
morning 早晨，上午
Ms 女士
stand 站立
stand up 站起来
sit 坐
sit down 坐下
open 打开
book 书
close 合上
point 指
say 说
read 阅读
listen 听
write 写`;
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

test('classroom paste imports all 34 space-separated rows, preserving phrases, meanings and case defaults', async t => {
  const c = await fixture(t);
  const preview = await c.call('batch-preview', { text: classroomWords, use_dictionary: false });
  assert.equal(preview.statusCode, 200, preview.body);
  const rows = preview.json().items;
  assert.equal(rows.length, 34);
  assert.ok(rows.every(row => row.status === 'manual'));
  assert.equal(rows.find(row => row.word === 'to').definition_zh, '（用于动词、名词或形容词后，使意思完整）；向，到，往');
  assert.equal(rows.find(row => row.word === 'hi').definition_zh, '嘿，喂，你好');
  assert.equal(rows.find(row => row.word === 'stand up').definition_zh, '站起来');
  assert.equal(rows.find(row => row.word === 'sit down').definition_zh, '坐下');
  assert.deepEqual(rows.filter(row => row.strict_case).map(row => row.word), ['I', 'Ms']);
  const saved = await c.call('batch', { request_id: 'space-classroom-import-0001', book_meta: { name: '课堂单词' }, items: rows });
  assert.equal(saved.statusCode, 201, saved.body);
  assert.equal(saved.json().added_count, 34);
  const words = c.app.services.englishWordsService.listWords({ child_id: c.child.id });
  assert.deepEqual(words.filter(word => word.strict_case).map(word => word.word).sort(), ['I', 'Ms']);
});

test('space import preserves explicit TSV columns and mixed punctuation while invalid rows stay whole', async t => {
  const c = await fixture(t);
  const dictionaryService = { lookup: async () => ({ exact_matches: [{ definition_zh: '词典释义' }] }) };
  const text = "\n  look   after　　照顾,照料；看护\r\nstand　up   （站起来）；起立\rcat\t猫，宠物;教材释义\nread\tto read, study; learn\npear,book；desk、chair\napple,苹果\n\t缺英文\ndog\t狗\t多余列\ndon’t  不要";
  const { items } = await c.app.services.englishWordsService.batchPreview(c.child.id, text, { dictionaryService });
  assert.equal(items.find(row => row.word === 'look after').definition_zh, '照顾,照料；看护');
  assert.equal(items.find(row => row.word === 'stand up').definition_zh, '（站起来）；起立');
  assert.equal(items.find(row => row.word === 'read').definition_zh, 'to read, study; learn');
  assert.equal(items.find(row => row.word === 'cat').definition_zh, '猫，宠物;教材释义');
  assert.equal(items.find(row => row.word === "don't").definition_zh, '不要');
  assert.ok(items.filter(row => row.status !== 'invalid').every(row => row.status === 'matched'));
  for (const word of ['pear', 'book', 'desk', 'chair']) assert.ok(items.some(row => row.word === word));
  assert.deepEqual(items.filter(row => row.status === 'invalid').map(row => [row.raw, row.line_number]), [
    ['apple,苹果', 7], ['\t缺英文', 8], ['dog\t狗\t多余列', 9]
  ]);
  assert.equal(items.some(row => row.word === 'apple'), false, 'mixed invalid rows must not silently import their English fragment');
  const tooMany = await c.call('batch-preview', { text: Array.from({ length: 101 }, (_, i) => `word${i} 中文释义`).join('\n'), use_dictionary: false });
  assert.equal(tooMany.statusCode, 400);
});

test('batch case defaults apply only to new imports and respect explicit true or false', async t => {
  const c = await fixture(t), existing = c.word({ word: 'I', definition_zh: '我', strict_case: false });
  const saved = await c.call('batch', { request_id: 'default-import-case-0001', book_meta: { name: '大小写默认值' }, items: [
    { word: 'I', existing_id: existing.id, existing_only: true },
    { word: 'Ms' }, { word: 'iPhone' }, { word: 'USA', strict_case: false }, { word: 'book', strict_case: true }, { word: 'school' }
  ] });
  assert.equal(saved.statusCode, 201, saved.body);
  const words = c.app.services.englishWordsService.listWords({ child_id: c.child.id });
  for (const [word, expected] of [['I', false], ['Ms', true], ['iPhone', true], ['USA', false], ['book', true], ['school', false]]) {
    assert.equal(words.find(row => row.word === word).strict_case, expected, word);
  }
});
