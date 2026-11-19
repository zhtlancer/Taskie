export function newEnglishSense(value = {}) {
  return {
    id: `sense-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    pos: '', definition_zh: '', definition_en: '', example: '', source: null,
    ...value
  };
}

export function withEnglishSenses(form, senses, primaryId = senses[0]?.id) {
  const selected = senses.find(sense => sense.id === primaryId) || senses[0];
  return { ...form, senses, primary_sense_id: selected?.id,
    pos: selected?.pos || '', definition_zh: selected?.definition_zh || '', definition_en: selected?.definition_en || '' };
}

export function sensesFromEntry(entry = {}) {
  return entry.senses?.length ? entry.senses.map(sense => ({ ...sense, ...(sense.audio_refs ? { audio_refs: sense.audio_refs.map(ref => ({ ...ref })) } : {}), source: sense.source ? { ...sense.source } : null }))
    : [newEnglishSense({ pos: entry.pos || '', definition_zh: entry.definition_zh || '', definition_en: entry.definition_en || '' })];
}

export function sameEnglishSense(a, b) {
  return ['pos', 'definition_zh', 'definition_en', 'example'].every(key => (a[key] || '') === (b[key] || ''))
    && (a.source?.dict_id || '') === (b.source?.dict_id || '')
    && (a.source?.headword || '') === (b.source?.headword || '');
}
