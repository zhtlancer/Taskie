import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEnglishBatchPreview } from '../src/utils/englishBatchPreview.js';
import { dictionaryLookupNotice, dictionaryErrorMessage, isDictionaryAbort } from '../src/utils/dictionaryState.js';

test('requery preserves corrected meanings, primary choice, phonetics, strict rules and unchecked rows', () => {
  const first = mergeEnglishBatchPreview([], [{ word: 'book', status: 'manual', definition_zh: '书', phonetic: '' }]);
  first[0].senses[0].definition_zh = '用户更正';
  first[0].strict_case = true;
  first[0].include = false;
  first[0].phonetic_uk = 'user phonetic';
  first[0].confirmed_case_variants = ['BOOK'];
  const dictionary = { id: 'dict-book', definition_en: 'a book', source: { dict_id: 'oald8', headword: 'book' } };
  const retried = mergeEnglishBatchPreview(first, [{ word: 'book', status: 'matched', phonetic_uk: 'dictionary phonetic', senses: [dictionary],
    primary_sense_id: 'dict-book', existing_case_variants: ['BOOK', 'Book'] }]);
  assert.equal(retried[0].definition_zh, '用户更正');
  assert.equal(retried[0].primary_sense_id, first[0].primary_sense_id);
  assert.equal(retried[0].include, false);
  assert.equal(retried[0].strict_case, true);
  assert.equal(retried[0].phonetic_uk, 'user phonetic');
  assert.deepEqual(retried[0].confirmed_case_variants, ['BOOK']);
  assert.deepEqual(retried[0].existing_case_variants, ['BOOK', 'Book']);
  assert.equal(retried[0].dictionary_candidates[0].definition_en, 'a book');
  retried[0].senses[0].definition_zh = '再次编辑';
  assert.equal(first[0].senses[0].definition_zh, '用户更正', 'merging does not mutate the previous preview');
});

test('duplicate validation wins over an old preview; failed retries keep selected dictionary provenance', () => {
  const previous = mergeEnglishBatchPreview([], [{ word: 'May', status: 'matched', senses: [
    { id: 's1', definition_zh: '五月', source: { dict_id: 'bgl', headword: 'May' } }
  ] }]);
  const failed = mergeEnglishBatchPreview(previous, [{ word: 'May', status: 'manual', definition_zh: '', dictionary_notice: { code: 'DICTIONARY_INVALID' } }]);
  assert.equal(failed[0].definition_zh, '五月');
  assert.equal(failed[0].senses[0].source.dict_id, 'bgl');
  assert.equal(failed[0].dictionary_candidates.length, 0);
  const duplicate = mergeEnglishBatchPreview(previous, [{ word: 'May', status: 'duplicate', existing_id: 'new-id' }]);
  assert.equal(duplicate[0].include, false);
  assert.equal(duplicate[0].status, 'duplicate');
  assert.equal(duplicate[0].existing_id, 'new-id');
});

test('dictionary read states distinguish missing resources, unready indexes, misses and missing audio', () => {
  assert.equal(dictionaryLookupNotice({ available: false }, null).code, 'DICTIONARY_UNCONFIGURED');
  assert.equal(dictionaryLookupNotice({ available: true, index_ready: false }, null).code, 'DICTIONARY_NOT_READY');
  assert.equal(dictionaryLookupNotice({ available: true, index_ready: true }, null).code, 'DICTIONARY_NOT_FOUND');
  assert.equal(dictionaryLookupNotice({ available: true }, { audio: [] }).code, 'DICTIONARY_NO_AUDIO');
  assert.equal(dictionaryLookupNotice({ available: true }, { audio: [{ id: 'one' }] }), null);
  assert.equal(dictionaryErrorMessage({ message: '词典损坏' }), '词典损坏');
  assert.equal(dictionaryErrorMessage(null), '词典查询失败，请稍后重试。');
  assert.equal(isDictionaryAbort({ code: 'ERR_CANCELED' }), true);
  assert.equal(isDictionaryAbort({ name: 'AbortError' }), true);
  assert.equal(isDictionaryAbort({ code: 'DICTIONARY_INVALID' }), false);
});
