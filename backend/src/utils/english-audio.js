const { identityKey } = require('./english-word');

function normalizeAudioRefs(value) {
  const invalid = () => { throw { status: 400, message: '学习发音引用无效，请重新选择词典发音' }; };
  if (!Array.isArray(value) || value.length > 4) invalid();
  const seen = new Set();
  return value.map(ref => {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) ||
      !['oald8', 'mw11'].includes(ref.dict_id) || !['uk', 'us', 'mw', 'other'].includes(ref.accent) ||
      typeof ref.file !== 'string' || !/^[a-z0-9._-]{1,255}$/i.test(ref.file) || ref.file === '.' || ref.file === '..' ||
      typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256) ||
      typeof ref.entry_key !== 'string' || !/^[a-f0-9]{64}$/.test(ref.entry_key) ||
      typeof ref.headword !== 'string' || !ref.headword.trim() || ref.headword.length > 80 ||
      (ref.phonetic != null && (typeof ref.phonetic !== 'string' || ref.phonetic.length > 80))) invalid();
    if ((ref.dict_id === 'mw11') !== (ref.accent === 'mw')) invalid();
    const key = `${ref.dict_id}:${ref.file.toLowerCase()}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    return { dict_id: ref.dict_id, file: ref.file, sha256: ref.sha256, entry_key: ref.entry_key,
      headword: identityKey(ref.headword), accent: ref.accent, phonetic: ref.phonetic || null };
  });
}

function audioUrl(ref) {
  return `/api/dictionary/audio/${encodeURIComponent(ref.dict_id)}/${encodeURIComponent(ref.file)}?sha256=${ref.sha256}`;
}

function keepWordAudio(senses, word) {
  for (const sense of senses) if (sense.audio_refs?.some(ref => ref.headword !== identityKey(word))) sense.audio_refs = [];
}

module.exports = { normalizeAudioRefs, audioUrl, keepWordAudio };
