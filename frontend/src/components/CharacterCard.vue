<template>
  <div
    class="relative bg-white rounded-3xl p-4 border border-slate-200/90 shadow-card hover:shadow-card-hover transition-all duration-300 flex flex-col justify-between select-none cursor-pointer group active:scale-[0.98]"
    @click="$emit('select', character)"
  >
    <!-- Top Row: Mastery Status & Quick Speech Button -->
    <div class="flex items-center justify-between gap-2 mb-2" @click.stop>
      <!-- Mastery Status Tag (Clickable to switch state) -->
      <button
        type="button"
        @click.stop="onToggleMaster"
        class="px-2.5 py-1 rounded-full text-xs font-black transition-all flex items-center gap-1 active:scale-95"
        :class="[
          character.is_mastered
            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100'
            : 'bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100'
        ]"
        :title="character.is_mastered ? '点击切换为学习中' : '点击标记为已掌握'"
      >
        <span>{{ character.is_mastered ? '✅ 已掌握' : '🌱 学习中' }}</span>
      </button>

      <!-- Speak Audio Button -->
      <button
        type="button"
        @click.stop="onSpeak"
        class="w-8 h-8 rounded-full bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-500 flex items-center justify-center text-sm transition-all active:scale-90"
        title="听发音"
      >
        🔊
      </button>
    </div>

    <!-- Pinyin Display & Mask Toggle -->
    <div class="h-8 flex items-center justify-center mb-1" @click.stop>
      <!-- Revealed Pinyin -->
      <div
        v-if="isRevealed"
        class="flex items-center gap-1 px-3 py-0.5 rounded-full bg-brand-50 text-brand-700 font-black text-sm tracking-wide animate-pop-in"
        @click="isRevealed = false"
        title="点击遮罩拼音"
      >
        <span>{{ displayPinyin }}</span>
        <span class="text-xs text-brand-400 opacity-60 ml-0.5">👁️</span>
      </div>

      <!-- Masked Button (Default State) -->
      <button
        v-else
        type="button"
        @click="revealPinyin"
        class="px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold text-xs flex items-center gap-1.5 transition-all active:scale-95 border border-dashed border-slate-300"
        title="点击查看拼音"
      >
        <span>🙈</span>
        <span>拼音</span>
      </button>
    </div>

    <!-- Center Calligraphy Tian-Zi-Ge (田字格大字); a word gets one smaller box per character -->
    <div class="flex flex-wrap justify-center gap-1 my-1 min-h-[8rem] content-center mx-auto" :class="box.row">
      <div
        v-for="(ch, index) in chars"
        :key="index"
        class="relative rounded-xl bg-[#FFFDF9] border-2 border-red-300/80 shadow-inner flex items-center justify-center overflow-hidden"
        :class="box.size"
      >
        <!-- Tian-Zi-Ge Grid Lines (SVG background) -->
        <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 128 128">
          <line x1="0" y1="64" x2="128" y2="64" stroke="#F87171" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.5" />
          <line x1="64" y1="0" x2="64" y2="128" stroke="#F87171" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.5" />
          <line x1="0" y1="0" x2="128" y2="128" stroke="#FECDD3" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.3" />
          <line x1="0" y1="128" x2="128" y2="0" stroke="#FECDD3" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.3" />
        </svg>
        <!-- Big Calligraphy Hanzi (霞鹜文楷 font-kai) -->
        <span class="relative z-10 font-kai text-slate-800 leading-none group-hover:scale-105 transition-transform duration-300" :class="box.text">
          {{ ch }}
        </span>
      </div>
    </div>

    <!-- Categories -->
    <div v-if="categories.length" class="flex flex-wrap justify-center gap-1 mt-1">
      <span v-for="category in categories" :key="category.key" class="px-1.5 py-0.5 rounded-md border text-[10px] font-black" :class="category.chip">
        {{ category.label }}
      </span>
    </div>

    <!-- Bottom Meta Information (Strokes & Radical; words show their length) -->
    <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-400">
      <template v-if="chars.length > 1">
        <span class="text-slate-500">词语</span>
        <span class="text-slate-500">{{ chars.length }} 个字</span>
      </template>
      <template v-else>
        <span class="text-slate-500">部首：{{ character.radical || '—' }}</span>
        <span class="text-slate-500">{{ character.strokes || '—' }} 画</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { getCharPinyin, speakHanzi } from '../utils/hanzi';
import { playClick } from '../utils/sound';
import { categoryInfo, entryChars } from '../utils/wordBook';

const props = defineProps({
  character: {
    type: Object,
    required: true,
  },
  forceShowPinyin: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['select', 'toggle-master']);

const localRevealed = ref(false);

const chars = computed(() => entryChars(props.character.char));
const categories = computed(() => (props.character.categories || []).map(categoryInfo).filter(Boolean));
// Box size by word length: one big box, two medium, then small boxes; from tablet width up the
// row is capped at four boxes (an idiom on one line, eight characters on two).
const box = computed(() => {
  const n = chars.value.length;
  if (n === 1) return { size: 'w-32 h-32', text: 'text-6xl', row: '' };
  if (n === 2) return { size: 'w-16 h-16', text: 'text-4xl', row: '' };
  return { size: 'w-12 h-12 sm:w-10 sm:h-10', text: 'text-2xl sm:text-xl', row: 'sm:max-w-[10.75rem]' };
});

const isRevealed = computed(() => {
  return props.forceShowPinyin || localRevealed.value;
});

const displayPinyin = computed(() => {
  return props.character.pinyin || getCharPinyin(props.character.char) || '—';
});

function revealPinyin() {
  playClick();
  localRevealed.value = true;
}

function onSpeak() {
  playClick();
  speakHanzi(props.character.char);
}

function onToggleMaster() {
  playClick();
  emit('toggle-master', props.character.id);
}

watch(
  () => props.forceShowPinyin,
  (val) => {
    if (!val) {
      localRevealed.value = false;
    }
  }
);
</script>
