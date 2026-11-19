<template>
  <div class="space-y-3" data-english-senses-editor>
    <p class="text-xs text-slate-500 dark:text-slate-400">选择一个学习释义用于后续认读与默写，旧清单保持原释义。</p>
    <fieldset v-for="(sense, index) in modelValue.senses" :key="sense.id" :data-sense-id="sense.id"
      :disabled="disabled" class="min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 [overflow-wrap:anywhere]">
      <legend class="px-1 text-xs font-bold text-slate-700 dark:text-slate-200">义项 {{ index + 1 }}{{ isPrimary(sense) ? ' · 学习释义' : '' }}</legend>
      <p v-if="sense.source" class="text-xs text-slate-500 dark:text-slate-400">来源：{{ sense.source.name || sense.source.dict_id }} · {{ sense.source.headword }}</p>
      <label v-if="pronunciations.length || sense.audio_refs?.length" class="block text-xs font-bold text-slate-600 dark:text-slate-300">
        {{ isPrimary(sense) ? '学习发音' : `义项 ${index + 1} 学习发音` }}
        <select :value="audioSelection(sense)" class="sense-input" @change="chooseAudio(sense.id, $event.target.value)">
          <option value="">不保存学习发音</option>
          <option v-if="audioSelection(sense) === 'saved'" value="saved">保留已保存的发音</option>
          <option v-for="group in pronunciations" :key="group.id" :value="group.id">{{ pronunciationLabel(group) }}</option>
        </select>
      </label>
      <p v-if="pronunciations.length > 1" class="text-xs text-slate-500 dark:text-slate-400">请按此义项的词性和含义选择发音，不同读音分别保留。</p>
      <div v-if="sense.audio_refs?.length" class="flex flex-wrap gap-2">
        <button v-for="clip in audioClips(sense.audio_refs)" :key="clip.id" type="button" class="ui-button-secondary min-h-11" @click="previewAudio(clip.url)">试听{{ clip.label }}</button>
      </div>
      <p v-if="audioError" role="alert" class="text-xs text-amber-700 dark:text-amber-300">{{ audioError }}</p>
      <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
        {{ isPrimary(sense) ? '词性' : `义项 ${index + 1} 词性` }}
        <input :value="sense.pos" maxlength="60" placeholder="如 n. / v. / adj." class="sense-input" @input="update(sense.id, 'pos', $event.target.value)" />
      </label>
      <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
        {{ isPrimary(sense) ? '中文释义' : `义项 ${index + 1} 中文释义` }}
        <textarea :value="sense.definition_zh" maxlength="400" rows="2" placeholder="例如：n. 苹果" class="sense-input py-2" @input="update(sense.id, 'definition_zh', $event.target.value)" />
      </label>
      <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
        {{ isPrimary(sense) ? '英文释义' : `义项 ${index + 1} 英文释义` }}
        <input :value="sense.definition_en" maxlength="400" class="sense-input" @input="update(sense.id, 'definition_en', $event.target.value)" />
      </label>
      <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
        {{ isPrimary(sense) ? '例句（选填）' : `义项 ${index + 1} 例句（选填）` }}
        <textarea :value="sense.example" maxlength="600" rows="2" class="sense-input py-2" @input="update(sense.id, 'example', $event.target.value)" />
      </label>
      <div class="flex flex-wrap gap-2">
        <button v-if="!isPrimary(sense)" type="button" class="ui-button-secondary min-h-11" @click="select(sense.id)">设为学习释义</button>
        <button v-if="modelValue.senses.length > 1" type="button" class="ui-button-secondary min-h-11" @click="remove(sense.id)">移除义项 {{ index + 1 }}</button>
      </div>
    </fieldset>
    <button type="button" :disabled="disabled || modelValue.senses.length >= 30" class="ui-button-secondary min-h-11" @click="append(newEnglishSense())">＋ 手动新增义项</button>
    <details v-if="candidates.length" class="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <summary class="min-h-11 flex items-center cursor-pointer text-sm font-bold text-brand-700 dark:text-brand-300">选择收录词典义项（{{ candidates.length }}）</summary>
      <div v-for="(candidate, index) in candidates" :key="index" class="border-t border-slate-200 dark:border-slate-700 py-3 space-y-1 [overflow-wrap:anywhere]">
        <p class="text-xs text-slate-500 dark:text-slate-400">{{ candidate.source?.name || '词典释义' }} · {{ candidate.pos }}</p>
        <p class="text-sm text-slate-800 dark:text-slate-100">{{ candidate.definition_zh || candidate.definition_en }}</p>
        <button type="button" :disabled="disabled || hasCandidate(candidate) || modelValue.senses.length >= 30" class="ui-button-secondary min-h-11" @click="append(candidate)">
          {{ hasCandidate(candidate) ? `已收录义项 ${index + 1}` : `收录义项 ${index + 1}` }}
        </button>
      </div>
    </details>
  </div>
</template>

<script setup>
import { newEnglishSense, withEnglishSenses, sameEnglishSense } from '../utils/englishSenses';
import { ref, onBeforeUnmount } from 'vue';
import { audioClips, pronunciationLabel } from '../utils/englishAudio';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';
const props = defineProps({ modelValue: { type: Object, required: true }, candidates: { type: Array, default: () => [] }, pronunciations: { type: Array, default: () => [] }, disabled: Boolean });
const audioError = ref('');
let alive = true;
onBeforeUnmount(() => { alive = false; stopDictionaryAudio(); });
async function previewAudio(url) { audioError.value = ''; try { await playDictionaryAudio(url); } catch (err) { if (alive) audioError.value = err?.message || '发音播放失败'; } }
function audioSelection(sense) {
  if (!sense.audio_refs?.length) return '';
  return props.pronunciations.find(group => group.audio_refs.length === sense.audio_refs.length &&
    group.audio_refs.every((ref, i) => ref.entry_key === sense.audio_refs[i].entry_key && ref.sha256 === sense.audio_refs[i].sha256 && ref.file === sense.audio_refs[i].file && ref.dict_id === sense.audio_refs[i].dict_id))?.id || 'saved';
}
function chooseAudio(id, key) { if (key === 'saved') return; stopDictionaryAudio(); update(id, 'audio_refs', props.pronunciations.find(group => group.id === key)?.audio_refs.map(ref => ({ ...ref })) || []); }
const emit = defineEmits(['update:modelValue']);
const isPrimary = sense => sense.id === props.modelValue.primary_sense_id;
const hasCandidate = candidate => props.modelValue.senses.some(sense => sameEnglishSense(sense, candidate));
function commit(senses, primary = props.modelValue.primary_sense_id) { emit('update:modelValue', withEnglishSenses(props.modelValue, senses, primary)); }
function update(id, key, value) { commit(props.modelValue.senses.map(sense => sense.id === id ? { ...sense, [key]: value } : sense)); }
function select(id) { commit(props.modelValue.senses, id); }
function remove(id) { commit(props.modelValue.senses.filter(sense => sense.id !== id)); }
function append(candidate) {
  if (props.disabled || props.modelValue.senses.length >= 30) return;
  const { id, ...fields } = candidate;
  commit([...props.modelValue.senses, newEnglishSense(fields)]);
}
</script>

<style scoped>
.sense-input { @apply mt-1 w-full min-w-0 min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100; }
</style>
