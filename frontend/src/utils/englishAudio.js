export function audioClips(refs = []) {
  return refs.map(ref => ({ ...ref, id: `${ref.dict_id}:${ref.file}:${ref.sha256}`,
    label: ref.accent === 'uk' ? '英音' : ref.accent === 'us' ? '美音' : '朗读',
    url: `/api/dictionary/audio/${encodeURIComponent(ref.dict_id)}/${encodeURIComponent(ref.file)}?sha256=${ref.sha256}` }));
}

export function pronunciationLabel(group) {
  return [group.name, group.pos, group.phonetic && `/${group.phonetic}/`, group.description?.slice(0, 70)].filter(Boolean).join(' · ');
}

export function learningPhonetic(word, accent) {
  const refs = word.senses?.find(sense => sense.id === word.primary_sense_id)?.audio_refs || [];
  return refs.find(ref => ref.accent === accent)?.phonetic || (!accent && refs[0]?.phonetic) || '';
}
