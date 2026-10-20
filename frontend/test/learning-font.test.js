import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEARNING_FONT_URL, loadLearningFont } from '../src/utils/learningFont.js';

test('the learning font stylesheet is added once, however many pages ask for it', () => {
  const added = [];
  const doc = {
    head: { appendChild: el => added.push(el) },
    createElement: () => ({}),
    getElementById: id => added.find(el => el.id === id) || null
  };
  loadLearningFont(doc);
  loadLearningFont(doc);
  assert.equal(added.length, 1);
  assert.deepEqual({ ...added[0] }, { id: 'learning-font', rel: 'stylesheet', href: LEARNING_FONT_URL });
});
