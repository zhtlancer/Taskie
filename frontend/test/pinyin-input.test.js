import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayPinyin } from '../src/utils/pinyinInput.js';
test('numeric pinyin preview agrees with server tone and neutral vectors', () => {
  for (const [raw, expected] of [['zhang3', 'zhǎng'], [' YIN2  hang2 ', 'yín háng'], ['ba4 ba5', 'bà ba'], ['ba4 ba0', 'bà ba'], ['ba4 ba', 'bà ba'], ['lv4', 'lǜ'], ['lü4', 'lǜ'], ['lve4', 'lüè'], ['lüe4', 'lüè'], ['zhǎng'.normalize('NFD'), 'zhǎng']]) assert.equal(displayPinyin(raw), expected);
});
