import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEntry, entryChars, isWord, toggleCategory } from '../src/utils/wordBook.js';
import { getCharPinyin } from '../src/utils/hanzi.js';

test('entries keep only the Chinese characters typed, up to 8', () => {
  assert.equal(cleanEntry(' 银行abc '), '银行');
  assert.equal(cleanEntry('一二三四五六七八九十'), '一二三四五六七八');
  assert.equal(cleanEntry('abc'), '');
  assert.deepEqual(entryChars('春天'), ['春', '天']);
  assert.deepEqual([isWord('春'), isWord('春天')], [false, true]);
});

test('children may add categories but only parents remove them', () => {
  assert.deepEqual(toggleCategory(['error_prone'], 'recognize', 'child'), { categories: ['recognize', 'error_prone'], blocked: false });
  assert.deepEqual(toggleCategory(['fix_strokes'], 'fix_strokes', 'child'), { categories: ['fix_strokes'], blocked: true });
  assert.deepEqual(toggleCategory(['fix_strokes', 'write'], 'fix_strokes', 'parent'), { categories: ['write'], blocked: false });
});

test('words are read as a whole, so polyphonic characters follow the word', () => {
  assert.equal(getCharPinyin('银行'), 'yín háng');
  assert.equal(getCharPinyin('行'), 'xíng');
});
