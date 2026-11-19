const { generateId } = require('./crypto');
const { normalizeOptionalText } = require('./english-word');
const { normalizeAudioRefs } = require('./english-audio');

const LIMIT = 30;
const fields = { pos: 60, definition_zh: 400, definition_en: 400, example: 600 };
const invalid = () => { throw { status: 400, message: '义项格式无效，请检查释义和主要义项' }; };

function normalizeSenses(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > LIMIT) invalid();
  const ids = new Set();
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    const id = value.id === undefined ? generateId() : value.id;
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || ids.has(id)) invalid();
    ids.add(id);
    const sense = { id };
    for (const [key, max] of Object.entries(fields)) {
      if (value[key] != null && (typeof value[key] !== 'string' || value[key].length > max)) invalid();
      sense[key] = normalizeOptionalText(value[key], max);
    }
    sense.source = null;
    if (value.audio_refs !== undefined) sense.audio_refs = normalizeAudioRefs(value.audio_refs);
    if (value.source != null) {
      if (typeof value.source !== 'object' || Array.isArray(value.source)) invalid();
      sense.source = {};
      for (const [key, max] of Object.entries({ dict_id: 60, name: 100, headword: 80 })) {
        const text = value.source[key];
        if (text != null && (typeof text !== 'string' || text.length > max)) invalid();
        sense.source[key] = normalizeOptionalText(text, max);
      }
    }
    return sense;
  });
}

// Compatibility fields always mirror the chosen sense, so existing study generation
// continues to snapshot only that meaning. Legacy clients edit this sense in place.
function resolveSenses(payload, existing) {
  const senses = payload.senses !== undefined ? normalizeSenses(payload.senses)
    : existing ? normalizeSenses(existing.senses)
      : normalizeSenses([{ ...payload, id: 'legacy' }]);
  const primary = payload.primary_sense_id !== undefined ? payload.primary_sense_id
    : (existing?.primary_sense_id || senses[0].id);
  const selected = senses.find(sense => sense.id === primary);
  if (!selected) invalid();
  if (payload.senses === undefined && existing) {
    for (const [key, max] of Object.entries(fields)) {
      if (payload[key] !== undefined) {
        if (payload[key] != null && (typeof payload[key] !== 'string' || payload[key].length > max)) invalid();
        selected[key] = normalizeOptionalText(payload[key], max);
      }
    }
  }
  return { senses, primary_sense_id: primary, pos: selected.pos,
    definition_zh: selected.definition_zh, definition_en: selected.definition_en };
}

function validateStoredSenses(row) {
  const parsed = JSON.parse(row.senses);
  const normalized = normalizeSenses(parsed);
  if (parsed.some((sense, i) => sense.id !== normalized[i].id)) invalid();
  if (row.word && normalized.some(sense => sense.audio_refs?.some(ref => ref.headword !== row.word))) invalid();
  const selected = normalized.find(sense => sense.id === row.primary_sense_id);
  if (!selected || ['pos', 'definition_zh', 'definition_en'].some(key => selected[key] !== row[key])) invalid();
}

module.exports = { resolveSenses, validateStoredSenses };
