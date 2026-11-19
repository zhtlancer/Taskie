import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newEnglishSense, sensesFromEntry, withEnglishSenses, sameEnglishSense } from '../src/utils/englishSenses.js';

test('changing or removing the primary sense updates compatibility fields without modifying other meanings', () => {
  const first = newEnglishSense({ definition_zh: '银行', pos: 'n.', source: { dict_id: 'bgl', headword: 'bank' } });
  const second = newEnglishSense({ definition_zh: '河岸' });
  const entry = withEnglishSenses({ word: 'bank', note: '保留笔记', strict_case: true }, [first, second], first.id);
  const editing = sensesFromEntry(entry);
  editing[0].source.headword = 'changed';
  assert.equal(first.source.headword, 'bank', 'editing must not mutate stored provenance');
  const selected = withEnglishSenses(entry, entry.senses, second.id);
  assert.equal(selected.definition_zh, '河岸');
  assert.equal(selected.definition_en, '');
  assert.equal(selected.pos, '');
  assert.equal(selected.note, '保留笔记');
  assert.equal(selected.strict_case, true);
  assert.equal(selected.senses[0].definition_zh, '银行');
  const removed = withEnglishSenses(selected, [first], second.id);
  assert.equal(removed.primary_sense_id, first.id);
  assert.equal(removed.definition_zh, '银行');
});

test('legacy entries get one editable sense; dictionary duplicates respect source and manual corrections', () => {
  const legacy = sensesFromEntry({ definition_zh: '书', pos: 'n.' });
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].definition_zh, '书');
  assert.equal(legacy[0].source, null);
  const candidate = newEnglishSense({ definition_en: 'a book', source: { dict_id: 'oald8', headword: 'book' } });
  assert.equal(sameEnglishSense(candidate, { ...candidate, id: 'different' }), true);
  assert.equal(sameEnglishSense(candidate, { ...candidate, definition_en: 'a corrected book' }), false);
  assert.equal(sameEnglishSense(candidate, { ...candidate, source: { dict_id: 'mw11', headword: 'book' } }), false);
});
