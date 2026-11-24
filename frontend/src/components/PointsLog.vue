<template>
  <div class="min-w-0 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-700">
    <div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
      <h3 class="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
        <span>💰</span>
        <span>积分变动记录</span>
      </h3>
      <span class="text-xs text-slate-400 font-bold">最近明细</span>
    </div>

    <!-- Empty State -->
    <div v-if="logs.length === 0" class="py-12 text-center text-slate-400 text-sm">
      <div class="text-4xl mb-2">🎁</div>
      完成任务即可获取金币积分哦，快去完成任务吧！
    </div>

    <!-- Log list -->
    <div v-else class="space-y-3 max-h-[360px] overflow-y-auto pr-1">
      <div
        v-for="log in logs"
        :key="log.id"
        class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700"
      >
        <div class="min-w-0 flex-1 basis-32 flex items-start gap-2">
          <div class="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center text-xl shrink-0">
            🪙
          </div>
          <div class="min-w-0">
            <div class="text-sm font-bold text-slate-800 dark:text-slate-100 break-words [overflow-wrap:anywhere]">
              {{ log.title || '完成日常作业打卡' }}
            </div>
            <div class="text-xs text-slate-400">
              {{ formatTime(log.earned_at) }}
            </div>
          </div>
        </div>

        <div class="shrink-0 text-base font-black flex items-center gap-1" :class="log.points < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'">
          <span>{{ log.points >= 0 ? '+' : '' }}{{ log.points }}</span>
          <span class="text-xs font-bold">积分</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { businessDate, businessClock } from '../utils/businessDate.js';
const calendar = useCalendarStore();
defineProps({
  logs: {
    type: Array,
    default: () => []
  }
});

function formatTime(isoStr) {
  if (!isoStr) return '';
  const date = businessDate(isoStr, calendar.timeZone);
  const time = businessClock(isoStr, calendar.timeZone);
  if (!date) return '';
  if (date === calendar.today) return `今天 ${time}`;
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日 ${time}`;
}
</script>
