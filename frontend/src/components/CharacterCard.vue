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

    <!-- Center Calligraphy Tian-Zi-Ge (田字格大字) -->
    <div class="relative w-32 h-32 mx-auto rounded-2xl bg-[#FFFDF9] border-2 border-red-300/80 shadow-inner flex items-center justify-center my-1 overflow-hidden">
      <!-- Tian-Zi-Ge Grid Lines (SVG background) -->
      <svg class="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 128 128">
        <!-- Horizontal center line -->
        <line x1="0" y1="64" x2="128" y2="64" stroke="#F87171" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.5" />
        <!-- Vertical center line -->
        <line x1="64" y1="0" x2="64" y2="128" stroke="#F87171" stroke-width="1.2" stroke-dasharray="4,3" opacity="0.5" />
        <!-- Diagonal lines for subtle Mi-zi-ge assistance -->
        <line x1="0" y1="0" x2="128" y2="128" stroke="#FECDD3" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.3" />
        <line x1="0" y1="128" x2="128" y2="0" stroke="#FECDD3" stroke-width="0.8" stroke-dasharray="3,3" opacity="0.3" />
      </svg>

      <!-- Big Calligraphy Hanzi (霞鹜文楷 font-kai) -->
      <span class="relative z-10 font-kai text-6xl text-slate-800 leading-none group-hover:scale-105 transition-transform duration-300">
        {{ character.char }}
      </span>
    </div>

    <!-- Bottom Meta Information (Strokes & Radical) -->
    <div class="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-400">
      <span class="text-slate-500">部首：{{ character.radical || '—' }}</span>
      <span class="text-slate-500">{{ character.strokes || '—' }} 画</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { getCharPinyin, speakHanzi } from '../utils/hanzi';
import { playClick } from '../utils/sound';

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
