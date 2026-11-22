<template>
  <div
    role="button"
    tabindex="0"
    :data-english-word-card="word.word"
    class="group relative bg-white dark:bg-slate-900 rounded-2xl border p-3.5 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col justify-between gap-2.5 text-left"
    :class="word.is_mastered
      ? 'border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/20 dark:bg-emerald-950/10'
      : 'border-slate-200/90 dark:border-slate-700/90 hover:border-brand-300 dark:hover:border-brand-700'"
    @click="$emit('select', word)"
    @keydown.enter.self.prevent="$emit('select', word)"
    @keydown.space.self.prevent="$emit('select', word)"
  >
    <div class="space-y-1.5 min-w-0">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="text-lg font-black text-slate-900 dark:text-slate-100 leading-snug break-words [overflow-wrap:anywhere]">
            {{ word.word }}
          </h3>
          <p v-if="learningPhonetic(word) || word.phonetic_uk || word.phonetic" class="text-xs font-mono text-cyan-700 dark:text-cyan-300 truncate">
            /{{ learningPhonetic(word) || word.phonetic_uk || word.phonetic }}/
          </p>
        </div>

        <button
          type="button"
          class="w-11 h-11 shrink-0 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-base transition-all active:scale-95"
          title="播放发音"
          aria-label="播放发音"
          @click.stop="speakWord"
        >
          {{ speaking ? '🔉' : '🔊' }}
        </button>
      </div>

      <!-- Meaning preview (respects global self-check toggle unless card peeked) -->
      <div class="min-h-[2.25rem] flex items-center">
        <p
          v-if="showMeaning"
          class="text-xs font-bold text-slate-600 dark:text-slate-300 line-clamp-2 break-words [overflow-wrap:anywhere]"
        >
          {{ word.definition_zh || word.definition_en || '（暂无释义）' }}
        </p>
        <button
          v-else
          type="button"
          class="min-h-11 min-w-11 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-300"
          @click.stop="peek = !peek"
        >
          🙈 点击查看释义
        </button>
      </div>
    </div>

    <EnglishStudyProgress :word="word" :disabled="busy" />
    <WordBookTags :books="word.books" />

    <div class="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
      <div v-if="word.unit || word.categories?.length" class="flex flex-wrap items-center gap-1">
        <span
          v-if="word.unit"
          class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300"
        >
          {{ word.unit }}
        </span>
        <span
          v-for="cat in word.categories"
          :key="cat"
          class="px-1.5 py-0.5 rounded-md text-[11px] font-bold border"
          :class="englishCategoryInfo(cat)?.chip"
        >
          {{ englishCategoryInfo(cat)?.icon }} {{ englishCategoryInfo(cat)?.label }}
        </span>
      </div>

      <button
        type="button"
        :disabled="busy"
        class="w-full min-h-11 px-3 py-1.5 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-50"
        :class="word.is_mastered
          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300'"
        @click.stop="$emit('toggle-master', word.id)"
      >
        {{ busy ? '保存中…' : word.is_mastered ? '✅ 已掌握' : '🌱 标记已掌握' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';
import { audioClips, learningPhonetic } from '../utils/englishAudio';
import { useAsyncScope } from '../composables/useAsyncScope';
import { englishCategoryInfo } from '../utils/englishWord';
import EnglishStudyProgress from './EnglishStudyProgress.vue';
import WordBookTags from './WordBookTags.vue';

const props = defineProps({
  word: { type: Object, required: true },
  forceShowMeaning: Boolean,
  busy: Boolean
});

const emit = defineEmits(['select', 'toggle-master', 'audio-error']);

const peek = ref(false);
const speaking = ref(false);
const showMeaning = computed(() => props.forceShowMeaning || peek.value);
const { capture } = useAsyncScope(() => [props.word], () => { if (speaking.value) stopDictionaryAudio(); speaking.value = false; });
onBeforeUnmount(() => { if (speaking.value) stopDictionaryAudio(); });

watch(() => props.forceShowMeaning, () => { peek.value = false; });

async function speakWord() {
  if (speaking.value) return;
  speaking.value = true;
  const current = capture();
  try {
    const selected = props.word.senses?.find(sense => sense.id === props.word.primary_sense_id);
    const clip = audioClips(selected?.audio_refs || [])[0];
    if (!clip?.url) {
      emit('audio-error', `“${props.word.word}”未保存学习发音，请打开词条选择对应的词典发音`);
      return;
    }
    await playDictionaryAudio(clip.url);
  } catch (err) {
    if (current()) emit('audio-error', err?.message || '发音播放失败');
  } finally {
    if (current()) speaking.value = false;
  }
}
</script>
