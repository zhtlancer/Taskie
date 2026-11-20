import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupQuery } from '../src/utils/lookupQuery.js';

test('lookup classifies complete Chinese words and English phrases while preserving case and normalizing punctuation', () => {
  assert.deepEqual(lookupQuery(' 春 天 '), { language: 'zh', text: '春天', error: '' });
  for (const word of ['学', '一心一意', '𠀀']) assert.equal(lookupQuery(word).language, 'zh');
  for (const word of ['apple', 'May', 'look after', 'A320', 'mother-in-law']) assert.deepEqual(lookupQuery(word), { language: 'en', text: word, error: '' });
  assert.equal(lookupQuery('  don’t  ').text, "don't");
  assert.equal(lookupQuery('look   after').text, 'look after');
});

test('lookup rejects mixed scripts, punctuation/numbers alone and overlong inputs instead of extracting a partial word', () => {
  for (const value of ['', '   ', null, '1234', '!!!', 'école', '学apple', '春天abc', 'a'.repeat(81), '春'.repeat(9)]) {
    const result = lookupQuery(value); assert.equal(result.language, '', String(value)); assert.ok(result.error);
  }
  assert.match(lookupQuery('学apple').error, /中英混合/);
  assert.match(lookupQuery('春'.repeat(9)).error, /最多 8/);
  assert.equal(lookupQuery('春'.repeat(8)).language, 'zh');
  assert.equal(lookupQuery('a'.repeat(80)).language, 'en');
});
