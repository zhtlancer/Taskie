import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  normalizeWordDisplay,
  identityKey,
  canonicalKey,
  isValidEnglishWord,
  compareSpellingAnswer,
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
