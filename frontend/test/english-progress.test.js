import { test } from 'node:test';
import assert from 'node:assert/strict';
import { englishProgress, matchesEnglishProgress, englishStudyLink } from '../src/utils/englishProgress.js';

test('progress filters keep independent skills and manual mastery separate', () => {
  const word = { is_mastered: true, study_progress: {
    recognize: { status: 'due', last_review_date: '2026-11-15', next_due_date: '2026-11-16' },
    write: { status: 'unlearned', last_review_date: null, next_due_date: null }
  } };
  assert.equal(englishProgress(word, 'recognize').label, '今日待复习');
  assert.equal(matchesEnglishProgress(word, 'any', 'due'), true);
  assert.equal(matchesEnglishProgress(word, 'any', 'unlearned'), true);
  assert.equal(matchesEnglishProgress(word, 'recognize', 'unlearned'), false);
  assert.equal(matchesEnglishProgress(word, 'write', 'due'), false);
  assert.equal(matchesEnglishProgress(word, 'write', 'unlearned'), true);
  assert.equal(matchesEnglishProgress(word, 'recognize', 'all'), true);
  assert.equal(englishProgress(word, 'recognize').last_review_date, '2026-11-15');
});

test('missing progress stays unknown instead of becoming a fabricated unlearned state', () => {
  assert.equal(englishProgress({}, 'write').label, '进度未读取');
  assert.equal(matchesEnglishProgress({}, 'any', 'unlearned'), false);
  assert.equal(matchesEnglishProgress({}, 'any', 'due'), false);
  assert.equal(matchesEnglishProgress({}, 'any', 'all'), true);
  assert.equal(englishProgress({ study_progress: { write: { status: 'learning' } } }, 'write').label, '复习中');
  assert.deepEqual(englishStudyLink('child-a', 'write'), {
    path: '/child/child-a/word-study', query: { language: 'en', skill: 'write' }
  });
});
