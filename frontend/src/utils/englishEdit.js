import { sensesFromEntry, withEnglishSenses } from './englishSenses.js';

export function englishEditForm(word) {
  return withEnglishSenses({
    word: word.word, pos: word.pos || '', phonetic: word.phonetic || '', phonetic_uk: word.phonetic_uk || '',
    phonetic_us: word.phonetic_us || '', definition_zh: word.definition_zh || '',
    definition_en: word.definition_en || '', textbook: word.textbook || '',
    unit: word.unit || '', note: word.note || '', strict_case: Boolean(word.strict_case),
    confirmed_case_variants: []
  }, sensesFromEntry(word), word.primary_sense_id);
}

// Meanings and their derived legacy fields form one unit. Untouched fields adopt
// the latest server value; consciously retained edits remain the user's draft.
export function rebaseEnglishEdit(draft, base, latest) {
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const next = copy(latest);
  const meaningKeys = ['senses', 'primary_sense_id', 'pos', 'definition_zh', 'definition_en'];
  const changed = key => JSON.stringify(draft[key]) !== JSON.stringify(base[key]);
  for (const key of Object.keys(latest)) {
    if (key !== 'confirmed_case_variants' && !meaningKeys.includes(key) && changed(key)) next[key] = copy(draft[key]);
  }
  if (meaningKeys.some(changed)) for (const key of meaningKeys) next[key] = copy(draft[key]);
  next.confirmed_case_variants = [];
  return next;
}
