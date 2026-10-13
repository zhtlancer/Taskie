<template>
  <button
    type="button"
    @click="handleCardClick"
    class="group relative flex flex-col items-center justify-center p-6 bg-white rounded-3xl border-2 border-transparent hover:border-brand-400 active:scale-95 transition-all duration-200 shadow-card hover:shadow-card-hover w-56 h-64 focus:outline-none focus:ring-4 focus:ring-brand-200"
  >
    <!-- Avatar Circle -->
    <div
      class="w-28 h-28 rounded-full bg-gradient-to-tr from-brand-100 to-brand-50 flex items-center justify-center text-6xl shadow-inner group-hover:scale-105 transition-transform duration-300"
    >
      {{ child.avatar_emoji || '🐱' }}
    </div>

    <!-- Child Name -->
    <h3 class="mt-4 text-2xl font-bold text-slate-800 tracking-wide group-hover:text-brand-500 transition-colors">
      {{ child.name }}
    </h3>

    <!-- Sub badge / Lock status -->
    <div class="mt-2 flex items-center gap-1.5 text-sm font-semibold">
      <span
        v-if="child.has_pin"
        class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500"
      >
        <span>🔒</span>
        <span>PIN 保护</span>
      </span>
      <span
        v-else
        class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600"
      >
        <span>⚡</span>
        <span>免密进入</span>
      </span>
    </div>

    <!-- Decorative cute dot indicator -->
    <div class="absolute top-4 right-4 w-3 h-3 rounded-full bg-brand-400 opacity-60 group-hover:scale-125 transition-transform"></div>
  </button>
</template>

<script setup>
import { playClick } from '../utils/sound';

const props = defineProps({
  child: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['select']);

function handleCardClick() {
  playClick();
  emit('select', props.child);
}
</script>
