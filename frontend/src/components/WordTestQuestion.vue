<template>
  <section
    data-word-test-question
    class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4 min-w-0"
    aria-label="当前自测题目"
  >
    <p class="text-sm text-slate-500 dark:text-slate-400">
      第 {{ item.position + 1 }} / {{ total }} 题 ·
      {{ language === 'en' && skill === 'write' ? '拼写由系统判分' : '揭晓后自行评定' }}
    </p>
    <p v-if="showText" class="text-center text-3xl font-black [overflow-wrap:anywhere]" data-test-word>
      {{ item.text }}
    </p>
    <template v-if="language === 'zh'">
      <p
        v-if="skill === 'write' || revealed || item.result"
        class="text-center text-xl text-brand-700 dark:text-brand-300"
      >
        {{ item.pinyin }}
      </p>
      <button type="button" :disabled="busy" class="ui-button-secondary" @click="speak">朗读字词</button>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        系统朗读可能与多音字拼音不同，请以本题拼音核对；没有声音也可纸上听写和自评。
      </p>
      <div v-if="skill === 'write' && (revealed || item.result)" class="flex flex-wrap justify-center gap-3">
        <HanziGrid
          v-for="(char, index) in Array.from(item.text)"
          :key="index"
          :character="char"
          :size="140"
          mode="static"
          :show-controls="false"
          :auto-play="false"
        />
      </div>
    </template>
    <template v-else>
      <p v-if="item.phonetic && !spelling" class="text-center font-mono">/{{ item.phonetic }}/</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="clip in clips"
          :key="clip.id"
          type="button"
          :disabled="busy"
          class="ui-button-secondary"
          @click="play(clip.url)"
        >
          播放{{ clip.label }}
        </button>
      </div>
      <p v-if="!clips.length" class="text-xs text-slate-500 dark:text-slate-400">
        {{
          item.audio_refs === null
            ? '本题未保存发音来源，不会自动换用当前词典读音；可继续文字练习。'
            : '本题未保存学习发音，可继续文字练习。'
        }}
      </p>
      <p v-if="spelling || revealed || item.result" class="text-lg [overflow-wrap:anywhere]">
        {{ item.meaning_zh || item.meaning_en }}
      </p>
      <p
        v-if="(spelling || revealed || item.result) && item.meaning_zh && item.meaning_en"
        class="text-sm text-slate-500 dark:text-slate-400 [overflow-wrap:anywhere]"
      >
        {{ item.meaning_en }}
      </p>
    </template>
    <p v-if="audioError" role="status" class="text-xs text-amber-700 dark:text-amber-300">
      {{ audioError }} 可继续文字练习。
    </p>
    <template v-if="!item.result">
      <template v-if="spelling">
        <label class="block text-sm font-bold"
          >输入拼写<input
            :value="typed"
            :disabled="busy || pending"
            maxlength="1000"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
            :spellcheck="false"
            class="ui-input block w-full mt-1"
            @input="$emit('update:typed', $event.target.value)"
        /></label>
        <p v-if="item.strict_case" class="text-xs text-amber-700 dark:text-amber-300">本题严格区分大小写。</p>
        <button
          type="button"
          :disabled="busy || pending"
          class="ui-button-primary w-full"
          @click="$emit('answer', null)"
        >
          确认拼写
        </button>
      </template>
      <template v-else>
        <button
          v-if="!revealed"
          type="button"
          :disabled="busy || pending"
          class="ui-button-primary w-full"
          @click="$emit('reveal')"
        >
          {{ language === 'zh' ? (skill === 'write' ? '核对字形' : '揭晓拼音') : '揭晓释义' }}
        </button>
        <div v-else class="grid grid-cols-2 gap-3">
          <button
            type="button"
            :disabled="busy || pending"
            class="ui-button-secondary"
            @click="$emit('answer', 'wrong')"
          >
            还不熟
          </button>
          <button
            type="button"
            :disabled="busy || pending"
            class="ui-button-primary"
            @click="$emit('answer', 'correct')"
          >
            记住了
          </button>
        </div>
      </template>
      <p class="text-xs text-slate-500 dark:text-slate-400">首次确认后不可修改答案。</p>
    </template>
    <div
      v-else
      role="status"
      class="rounded-xl p-3"
      :class="
        item.result === 'correct'
          ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
          : 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
      "
    >
      {{ item.result === 'correct' ? '本题正确' : '本题需复习' }}
      <p v-if="spelling" class="mt-1 [overflow-wrap:anywhere]">
        首次拼写：{{ item.typed_answer || '（空白）' }} · 正确拼写：{{ item.text }}
      </p>
    </div>
  </section>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import HanziGrid from './HanziGrid.vue';
import { audioClips } from '../utils/englishAudio';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';
import { speakWord } from '../utils/sound';
const props = defineProps({
  item: { type: Object, required: true },
  language: String,
  skill: String,
  total: Number,
  revealed: Boolean,
  typed: String,
  busy: Boolean,
  pending: Boolean,
});
defineEmits(['reveal', 'answer', 'update:typed']);
const spelling = computed(() => props.language === 'en' && props.skill === 'write');
const showText = computed(
  () =>
    Boolean(props.item.result) ||
    (props.language === 'zh' ? props.skill === 'recognize' || props.revealed : !spelling.value),
);
const clips = computed(() => audioClips(props.item.audio_refs || [])),
  audioError = ref('');
let serial = 0;
function stop() {
  serial++;
  stopDictionaryAudio();
  globalThis.speechSynthesis?.cancel();
  audioError.value = '';
}
async function play(url) {
  const request = ++serial;
  audioError.value = '';
  try {
    await playDictionaryAudio(url);
  } catch (err) {
    if (request === serial) audioError.value = err?.message || '发音播放失败。';
  }
}
function speak() {
  if (globalThis.speechSynthesis) speakWord(props.item.text);
  else audioError.value = '此浏览器没有可用朗读。';
}
watch(() => props.item.id, stop);
onBeforeUnmount(stop);
</script>
