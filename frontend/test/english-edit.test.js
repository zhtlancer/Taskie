import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { englishEditForm, rebaseEnglishEdit } from '../src/utils/englishEdit.js';

const entry = () => ({ word: 'bank', textbook: '旧教材', note: '旧笔记', senses: [
  { id: 'finance', pos: 'n.', definition_zh: '银行', example: 'A bank.', audio_refs: [] }
], primary_sense_id: 'finance' });

test('rebasing a reactive draft keeps only user changes and adopts untouched latest fields and meanings', () => {
  const base = englishEditForm(entry());
  const draft = reactive(englishEditForm(entry())); draft.note = '我的笔记';
  draft.confirmed_case_variants = ['BANK'];
  const latest = englishEditForm({ ...entry(), word: 'banks', textbook: '新教材', note: '远端笔记', phonetic: 'bæŋks',
    senses: [{ id: 'finance', definition_zh: '多家银行', example: 'Two banks.', audio_refs: [] }] });
  const result = rebaseEnglishEdit(draft, base, latest);
  assert.equal(result.note, '我的笔记'); assert.equal(result.word, 'banks');
  assert.equal(result.textbook, '新教材'); assert.equal(result.definition_zh, '多家银行');
  assert.equal(result.phonetic, 'bæŋks', 'generic phonetics from another device are preserved when editing a note');
  assert.equal(result.senses[0].example, 'Two banks.');
  assert.deepEqual(result.confirmed_case_variants, []);
  assert.equal(base.note, '旧笔记'); assert.equal(latest.note, '远端笔记');
});

test('a changed meaning retains its complete draft including primary and derived fields without aliasing', () => {
  const base = englishEditForm(entry()), draft = englishEditForm(entry());
  draft.senses[0].example = 'My example.'; draft.definition_zh = '我的释义';
  const latest = englishEditForm({ ...entry(), strict_case: true, senses: [{ id: 'river', definition_zh: '河岸' }], primary_sense_id: 'river' });
  const result = rebaseEnglishEdit(draft, base, latest);
  assert.equal(result.primary_sense_id, 'finance'); assert.equal(result.definition_zh, '我的释义');
  assert.equal(result.senses[0].example, 'My example.'); assert.equal(result.strict_case, true);
  result.senses[0].example = 'changed'; assert.equal(draft.senses[0].example, 'My example.');
});
