import { identityKey } from './englishWord.js';
import { withEnglishSenses, sensesFromEntry } from './englishSenses.js';

// Retrying enrichment only changes dictionary candidates and validation metadata.
// Editing the raw text explicitly clears the preview in the modal instead.
export function mergeEnglishBatchPreview(previous, incoming) {
  const byWord = new Map(previous.map(item => [identityKey(item.word), item]));
  return incoming.map(item => {
    const row = {
      ...withEnglishSenses(item, sensesFromEntry(item), item.primary_sense_id),
      strict_case: false, confirmed_case_variants: [], server_case_variants: [],
      dictionary_candidates: item.status === 'matched' ? (item.senses || []).filter(sense => sense.source) : [],
      include: ['matched', 'manual', 'link'].includes(item.status)
    };
    const old = byWord.get(identityKey(item.word));
    if (old?.status === 'link' && row.status === 'link') row.include = old.include;
    if (!old || !['matched', 'manual'].includes(old.status) || !['matched', 'manual'].includes(row.status)) return row;
    return {
      ...row,
      ...withEnglishSenses({}, sensesFromEntry(old), old.primary_sense_id),
      phonetic: old.phonetic, phonetic_uk: old.phonetic_uk, phonetic_us: old.phonetic_us,
      strict_case: Boolean(old.strict_case), confirmed_case_variants: [...(old.confirmed_case_variants || [])],
      include: old.include
    };
  });
}
