const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTestApp, cleanupTestApp } = require('./helper');
const { dictionaryFailure } = require('../src/services/dictionary/issues');

test('a genuinely damaged dictionary yields a safe diagnostic and an importable manual preview', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-damaged-dict-'));
  const dictDir = path.join(root, 'private-dictionaries');
  fs.mkdirSync(dictDir);
  fs.writeFileSync(path.join(dictDir, 'test-bgl.BGL'), 'not a BGL dictionary');
  const ctx = createTestApp({ dictDir, dictCacheDir: path.join(root, 'cache') });
  t.after(() => { cleanupTestApp(ctx); fs.rmSync(root, { recursive: true, force: true }); });
  await ctx.app.ready();
  const { childrenService, englishWordsService: book, dictionaryService: dictionary } = ctx.app.services;
  const child = childrenService.createChild({ name: '损坏词典回退' });
  const sibling = childrenService.createChild({ name: '权限检查' });
  const existing = book.createWord({ child_id: child.id, word: 'book', definition_zh: '旧释义' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() })}` };
  let calls = 0;
  const original = dictionary.lookup.bind(dictionary);
  dictionary.lookup = async word => { calls++; return original(word); };
  const preview = await ctx.app.inject({ method: 'POST', url: '/api/english-words/batch-preview', headers,
    payload: { child_id: child.id, text: 'book\t不覆盖\napple\t苹果，水果；教材更正\npear\n123\nUS\nus' } });
  assert.equal(preview.statusCode, 200);
  assert.equal(calls, 1, 'one broken source must not be rebuilt for every word');
  const result = preview.json();
  assert.equal(result.dictionary_warnings[0].code, 'DICTIONARY_INVALID');
  assert.equal(result.items.find(item => item.word === 'book').status, 'duplicate');
  assert.equal(result.items.find(item => item.word === 'apple').definition_zh, '苹果，水果；教材更正');
  assert.equal(result.items.find(item => item.word === 'pear').dictionary_notice.code, 'DICTIONARY_INVALID');
  assert.equal(result.items.find(item => item.word === '123').status, 'invalid');
  assert.deepEqual(result.items.find(item => item.word === 'US').case_variants, ['us']);
  assert.equal(book.listWords({ child_id: child.id }).length, 1, 'preview remains read-only');

  const lookup = await ctx.app.inject({ method: 'GET', url: '/api/dictionary/lookup?word=apple', headers });
  assert.equal(lookup.statusCode, 503);
  assert.equal(lookup.json().code, 'DICTIONARY_INVALID');
  assert.match(lookup.json().error, /损坏/);
  assert.equal(lookup.body.includes(root), false, 'native error paths are private');

  const selected = result.items.filter(item => ['apple', 'pear'].includes(item.word));
  selected.find(item => item.word === 'pear').definition_zh = '手工补填：梨';
  const saved = await ctx.app.inject({ method: 'POST', url: '/api/english-words/batch', headers,
    payload: { child_id: child.id, items: selected } });
  assert.equal(saved.statusCode, 201);
  assert.equal(saved.json().added.find(item => item.word === 'pear').definition_zh, '手工补填：梨');
  assert.equal(book.getWord(existing.id).definition_zh, '旧释义');
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/english-words/batch-preview', headers,
    payload: { child_id: sibling.id, text: 'tree', use_dictionary: false } })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/dictionary/lookup?word=apple' })).statusCode, 401);
});

test('individual lookup failures retain successful matches and supplied definitions; manual mode never queries', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const { childrenService, englishWordsService: book } = ctx.app.services;
  const child = childrenService.createChild({ name: '部分查询失败' });
  const calls = [];
  const dictionaryService = { lookup: async word => {
    calls.push(word);
    if (word === 'bad') throw new Error('private dictionary internals');
    return { available: true, index_ready: true,
      exact_matches: word === 'unknown' ? [] : [{ word, definition_zh: `词典 ${word}` }], suggestions: [] };
  } };
  const result = await book.batchPreview(child.id, 'apple\nbad\t用户更正\npear\nunknown', { dictionaryService });
  assert.deepEqual(calls, ['apple', 'bad', 'pear', 'unknown']);
  assert.deepEqual(result.items.map(item => item.status), ['matched', 'manual', 'matched', 'manual']);
  assert.equal(result.items[1].definition_zh, '用户更正');
  assert.equal(result.items[1].dictionary_notice.code, 'DICTIONARY_LOOKUP_FAILED');
  assert.equal(result.items[3].dictionary_notice.code, 'DICTIONARY_NOT_FOUND');
  assert.deepEqual(result.dictionary_warnings.map(issue => issue.code), ['DICTIONARY_LOOKUP_FAILED']);
  const manual = await book.batchPreview(child.id, 'apple\t手填；标点保留\nbad', { dictionaryService, useDictionary: false });
  assert.equal(calls.length, 4);
  assert.equal(manual.items[0].definition_zh, '手填；标点保留');
  assert.equal(manual.items[0].dictionary_notice.code, 'DICTIONARY_MANUAL');
  await assert.rejects(() => book.batchPreview(child.id, 'apple', { useDictionary: 'false' }), error => error.status === 400);
  await assert.rejects(() => book.batchPreview(child.id, 'apple', { dictionaryService: { lookup: async () => { throw { status: 403, message: '拒绝访问' }; } } }), error => error.status === 403);
});

test('unconfigured, unready and malformed dictionary responses are distinguished without blocking manual work', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const { childrenService, englishWordsService: book } = ctx.app.services;
  const child = childrenService.createChild({ name: '词典状态' });
  for (const [response, expected] of [
    [{ available: false, exact_matches: [] }, 'DICTIONARY_UNCONFIGURED'],
    [{ available: true, index_ready: false, exact_matches: [] }, 'DICTIONARY_NOT_READY'],
    [{}, 'DICTIONARY_LOOKUP_FAILED'],
    [{ exact_matches: [{ word: 'apple', senses: [{ id: 'bad id' }] }] }, 'DICTIONARY_ENTRY_INVALID']
  ]) {
    const result = await book.batchPreview(child.id, 'apple\t苹果\nbook', { dictionaryService: { lookup: async () => response } });
    assert.equal(result.items[0].status, 'manual');
    assert.equal(result.items[0].definition_zh, '苹果');
    assert.equal(result.items[0].dictionary_notice.code, expected);
  }
});

test('public dictionary diagnostics distinguish file failures and preserve validation status', () => {
  for (const [error, expected] of [
    [{ code: 'ENOENT' }, 'DICTIONARY_MISSING'], [{ code: 'EACCES' }, 'DICTIONARY_UNREADABLE'],
    [{ code: 'Z_DATA_ERROR' }, 'DICTIONARY_INVALID'], [{ code: 'SQLITE_CORRUPT' }, 'DICTIONARY_INVALID'],
    [new Error('Unsupported ZIP compression method: 99'), 'DICTIONARY_UNSUPPORTED'],
    [new Error('arbitrary private path /dicts/file'), 'DICTIONARY_LOOKUP_FAILED']
  ]) assert.equal(dictionaryFailure(error).code, expected);
  assert.equal(dictionaryFailure({ status: 400, message: '音频文件名无效' }).status, 400);
  assert.equal(dictionaryFailure({ status: 404, message: '发音文件不存在' }).message, '发音文件不存在');
});
