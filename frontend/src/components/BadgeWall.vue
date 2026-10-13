<template>
  <div class="w-full">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div
        v-for="badge in badges"
        :key="badge.id || badge.key"
        @click="openBadgeModal(badge)"
        class="group relative flex flex-col items-center p-5 rounded-2xl border-2 transition-all duration-200 cursor-pointer select-none"
        :class="[
          badge.is_unlocked
            ? 'bg-gradient-to-b from-amber-50/70 to-white border-amber-300 shadow-md shadow-amber-100/50 hover:shadow-lg hover:scale-105'
            : 'bg-slate-50 border-slate-200 opacity-60 hover:opacity-80'
        ]"
      >
        <!-- Icon Circle -->
        <div
          class="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mb-3 transition-transform duration-300 group-hover:scale-110"
          :class="[
            badge.is_unlocked
              ? 'bg-gradient-to-tr from-amber-400 to-amber-200 shadow-md shadow-amber-200/50'
              : 'bg-slate-200 grayscale'
          ]"
        >
          <span>{{ badge.icon_emoji || '🏅' }}</span>
        </div>

        <!-- Badge Title -->
        <h4
          class="text-base font-bold text-center transition-colors"
          :class="badge.is_unlocked ? 'text-amber-900' : 'text-slate-500'"
        >
          {{ badge.name }}
        </h4>

        <!-- Description -->
        <p class="text-xs text-slate-500 text-center mt-1 line-clamp-1">
          {{ badge.description }}
        </p>

        <!-- Status Tag -->
        <div class="mt-2.5">
          <span
            v-if="badge.is_unlocked"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-black"
          >
            <span>✓</span>
            <span>已获得</span>
          </span>
          <span
            v-else
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-semibold"
          >
            <span>🔒</span>
            <span>未解锁</span>
          </span>
        </div>

        <!-- Unlock date tag if available -->
        <span
          v-if="badge.is_unlocked && badge.unlocked_at"
          class="text-[10px] text-amber-700/70 mt-1"
        >
          {{ formatDate(badge.unlocked_at) }}
        </span>
      </div>
    </div>

    <!-- Badge Detail Modal -->
    <div
      v-if="selectedBadge"
      class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      @click.self="selectedBadge = null"
    >
      <div class="bg-white rounded-3xl p-6 max-w-sm w-full text-center shadow-2xl animate-pop-in border-2 border-brand-100">
        <div
          class="w-24 h-24 mx-auto rounded-3xl flex items-center justify-center text-5xl mb-4"
          :class="selectedBadge.is_unlocked ? 'bg-amber-100 shadow-inner' : 'bg-slate-100 grayscale'"
        >
          {{ selectedBadge.icon_emoji || '🏅' }}
        </div>
        <h3 class="text-2xl font-black text-slate-800 mb-1">
          {{ selectedBadge.name }}
        </h3>
        <p class="text-sm text-slate-600 mb-4 font-medium">
          {{ selectedBadge.description }}
        </p>

        <div
          class="py-2.5 px-4 rounded-xl text-xs font-bold mb-6"
          :class="selectedBadge.is_unlocked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'"
        >
          <span v-if="selectedBadge.is_unlocked">🎉 达成时间：{{ formatDate(selectedBadge.unlocked_at) }}</span>
          <span v-else>💡 解锁条件：{{ selectedBadge.description }}</span>
        </div>

        <button
          type="button"
          @click="closeBadgeModal"
          class="w-full py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition-all shadow-button active:scale-95"
        >
          太棒啦！
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { playBadgeUnlocked, playClick } from '../utils/sound';

defineProps({
  badges: {
    type: Array,
    default: () => []
  }
});

const selectedBadge = ref(null);

function openBadgeModal(badge) {
  selectedBadge.value = badge;
  if (badge.is_unlocked) {
    playBadgeUnlocked();
  } else {
    playClick();
  }
}

function closeBadgeModal() {
  playClick();
  selectedBadge.value = null;
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
</script>
