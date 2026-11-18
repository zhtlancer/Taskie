<template>
  <div class="w-full min-w-0">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <button v-for="badge in badges" :key="badge.id || badge.key" type="button" :aria-label="`查看徽章：${badge.name}`" @click="openBadgeModal(badge)"
        class="min-w-0 group flex flex-col items-center p-3 sm:p-4 rounded-2xl border-2 transition-colors select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
        :class="badge.is_unlocked ? 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'">
        <span class="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-3 shrink-0" aria-hidden="true" :class="badge.is_unlocked ? 'bg-amber-200 dark:bg-amber-900' : 'bg-slate-200 dark:bg-slate-700 grayscale'">{{ badge.icon_emoji || '🏅' }}</span>
        <span class="w-full text-sm font-bold text-center break-words [overflow-wrap:anywhere]" :class="badge.is_unlocked ? 'text-amber-900 dark:text-amber-200' : 'text-slate-600 dark:text-slate-300'">{{ badge.name }}</span>
        <span class="w-full text-xs text-slate-500 dark:text-slate-400 text-center mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">{{ badge.description }}</span>
        <span class="mt-3 px-2 py-1 rounded-full text-xs font-bold" :class="badge.is_unlocked ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'">{{ badge.is_unlocked ? '✓ 已获得' : '🔒 未解锁' }}</span>
        <span v-if="badge.is_unlocked && badge.unlocked_at" class="text-xs text-amber-800 dark:text-amber-200 mt-1">{{ formatDate(badge.unlocked_at) }}</span>
      </button>
    </div>

    <UiDialog v-if="selectedBadge" :title="selectedBadge.name" @close="closeBadgeModal">
      <div class="text-center break-words [overflow-wrap:anywhere]">
        <div class="w-24 h-24 mx-auto rounded-3xl flex items-center justify-center text-5xl mb-4" aria-hidden="true" :class="selectedBadge.is_unlocked ? 'bg-amber-100 dark:bg-amber-950/40' : 'bg-slate-100 dark:bg-slate-800 grayscale'">{{ selectedBadge.icon_emoji || '🏅' }}</div>
        <p class="text-sm text-slate-600 dark:text-slate-300 mb-4">{{ selectedBadge.description }}</p>
        <p class="py-3 px-4 rounded-xl text-sm font-bold" :class="selectedBadge.is_unlocked ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'">{{ selectedBadge.is_unlocked ? `🎉 达成时间：${formatDate(selectedBadge.unlocked_at)}` : `💡 解锁条件：${selectedBadge.description}` }}</p>
      </div>
      <template #footer><button type="button" class="ui-button-primary" @click="closeBadgeModal">{{ selectedBadge.is_unlocked ? '太棒啦！' : '继续加油' }}</button></template>
    </UiDialog>
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { businessDate } from '../utils/businessDate.js';
import { ref, watch } from 'vue';
import { playBadgeUnlocked, playClick } from '../utils/sound';
import UiDialog from './UiDialog.vue';
const calendar = useCalendarStore();
const props = defineProps({ badges: { type: Array, default: () => [] } });
const selectedBadge = ref(null);
watch(() => props.badges, badges => {
  if (selectedBadge.value) selectedBadge.value = badges.find(badge => (badge.id || badge.key) === (selectedBadge.value.id || selectedBadge.value.key)) || null;
});
function openBadgeModal(badge) {
  selectedBadge.value = badge;
  if (badge.is_unlocked) playBadgeUnlocked();
  else playClick();
}
function closeBadgeModal() { playClick(); selectedBadge.value = null; }
function formatDate(isoStr) {
  if (!isoStr) return '';
  const date = businessDate(isoStr, calendar.timeZone);
  return date ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` : '';
}
</script>
