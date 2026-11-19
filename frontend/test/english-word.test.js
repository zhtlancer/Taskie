import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  normalizeWordDisplay,
  identityKey,
  canonicalKey,
  isValidEnglishWord,
  compareSpellingAnswer,
  englishCaseVariants,
  toggleEnglishCategory,
  hasEnglishDefinition
} from '../src/utils/englishWord.js';

const require = createRequire(import.meta.url);
const backendUtil = require('../../backend/src/utils/english-word.js');

test('frontend and backend english-word normalization stay consistent', () => {
  const samples = ['  May ', 'may', 'don’t', 'look   after', 'a.m.', 'x-ray'];
  for (const s of samples) {
    assert.equal(normalizeWordDisplay(s), backendUtil.normalizeWordDisplay(s));
    assert.equal(identityKey(s), backendUtil.identityKey(s));
    assert.equal(canonicalKey(s), backendUtil.canonicalKey(s));
  }
  assert.equal(identityKey('May') !== identityKey('may'), true);
  assert.equal(identityKey('don’t'), "don't");
  assert.equal(isValidEnglishWord('look after'), true);
  assert.equal(isValidEnglishWord('12345'), false);

  assert.deepEqual(compareSpellingAnswer("don’t", "don't"), backendUtil.compareSpellingAnswer("don’t", "don't"));
  assert.equal(compareSpellingAnswer('Apple', 'apple').is_correct, true);
  assert.equal(compareSpellingAnswer('Apple', 'apple').exact_case, false);
  assert.equal(compareSpellingAnswer('aple', 'apple').is_correct, false);

  assert.equal(hasEnglishDefinition({ definition_zh: '苹果', definition_en: '' }), true);
  assert.equal(hasEnglishDefinition({ definition_zh: ' ', definition_en: '' }), false);
});

test('category permissions match backend: child can add, parent-only remove', () => {
  assert.deepEqual(toggleEnglishCategory(['recognize'], 'write', 'child'), {
    categories: ['recognize', 'write'],
    blocked: false
  });
  assert.deepEqual(toggleEnglishCategory(['recognize'], 'recognize', 'child'), {
    categories: ['recognize'],
    blocked: true
  });
  assert.deepEqual(toggleEnglishCategory(['recognize', 'write'], 'recognize', 'parent'), {
    categories: ['write'],
    blocked: false
  });
});

test('strict spelling respects case while retaining whitespace and smart-apostrophe normalization', () => {
  for (const [typed, expected, strict, correct] of [
    ['may', 'May', false, true], ['may', 'May', true, false], ['May', 'May', true, true],
    ['usa', 'USA', true, false], [' USA ', 'USA', true, true],
    ['don’t', "don't", true, true], [' look   after ', 'look after', true, true],
    ['apples', 'apple', false, false], ['', '', true, false]
  ]) {
    assert.equal(compareSpellingAnswer(typed, expected, strict).is_correct, correct);
    assert.deepEqual(compareSpellingAnswer(typed, expected, strict), backendUtil.compareSpellingAnswer(typed, expected, strict));
  }
  assert.deepEqual(englishCaseVariants('may', ['May', 'may', 'MAY', 'May', 'maybe']), ['MAY', 'May']);
  assert.deepEqual(englishCaseVariants('don’t', ["don't", 'DON’T']), ['DON’T']);
});
