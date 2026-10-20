<template>
  <div class="rounded-2xl border p-3" :class="task.status === 'ended' ? 'border-slate-200 dark:border-slate-700 opacity-70' : 'border-slate-200 dark:border-slate-700'">
    <div class="flex items-center justify-between gap-2 mb-1">
      <span class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese truncate">{{ task.title }}</span>
      <span class="text-xs font-black text-amber-500 dark:text-amber-400 shrink-0">
        {{ task.mode === 'progress' ? `★ ${task.points}/${task.unit}` : `★ ${task.points}` }}{{ task.completion_bonus ? ` · 完成 +${task.completion_bonus}` : '' }}
      </span>
    </div>
    <div class="flex flex-wrap gap-1 mb-1.5 text-xs font-bold">
      <span class="px-1.5 py-0.5 rounded-md" :class="statusInfo[task.status].class">{{ statusInfo[task.status].label }}</span>
      <span v-if="!task.period_id" class="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
        {{ task.start_date.slice(5) }} 起{{ task.end_date ? ` · ${task.end_date.slice(5)} 截止` : ' · 不设截止' }}
      </span>
      <span v-if="task.daily_required" class="px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300">每天要记录</span>
      <span v-if="task.track_time" class="px-1.5 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300">⏱ 记录用时{{ task.expected_minutes ? ` · 预计 ${task.expected_minutes} 分钟` : '' }}</span>
      <span v-if="task.mode === 'progress'" class="px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300">{{ task.input_mode === 'position' ? `记录读到第几${task.unit}` : '记录完成数量' }}</span>
    </div>
    <div class="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
      <span>{{ task.mode === 'progress' ? `${task.done_amount} / ${task.total_amount} ${task.unit}` : (task.is_completed ? '已完成' : '未完成') }}</span>
      <span v-if="task.is_completed" class="text-emerald-600 dark:text-emerald-300">{{ task.completed_on.slice(5) }} 完成 🎉</span>
      <span v-else-if="task.status === 'active' && task.mode === 'progress' && task.end_date" class="text-sky-700 dark:text-sky-300">还剩 {{ task.days_left }} 天，今天建议 {{ task.suggested_today }} {{ task.unit }}</span>
      <span v-else-if="task.status === 'active' && task.estimated_finish_date" class="text-sky-700 dark:text-sky-300">每天约 {{ task.recent_daily_rate }} {{ task.unit }}，预计 {{ task.estimated_finish_date.slice(5) }} 完成</span>
    </div>
    <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden mb-2">
      <div class="h-full rounded-full" :class="task.is_completed ? 'bg-emerald-500' : 'bg-sky-500'" :style="{ width: `${Math.round((task.done_amount / task.total_amount) * 100)}%` }"></div>
    </div>
    <div v-if="task.logs.length" class="flex flex-wrap gap-1 mb-2">
      <span v-for="entry in visibleLogs" :key="entry.id" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-50 dark:bg-slate-800 text-xs font-bold text-slate-500 dark:text-slate-400">
        {{ entry.date.slice(5) }} {{ task.mode === 'check' ? '✓' : entry.position ? `第${entry.position}${task.unit}` : `+${entry.amount}` }}
        <button type="button" :disabled="!entry.can_undo" class="text-slate-300 hover:text-rose-500 dark:hover:text-rose-400 disabled:cursor-not-allowed disabled:hover:text-slate-300" :title="entry.can_undo ? '删除这条记录' : '请先撤销后续进度'" @click="emit('remove-log', entry)">✕</button>
      </span>
    </div>
    <div class="flex items-center gap-2">
      <button v-if="!task.is_completed && task.status !== 'upcoming'" type="button" @click="emit('backfill', task)" class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950/40 text-slate-600 dark:text-slate-300 font-bold text-xs">补记进度</button>
      <button type="button" @click="emit('edit', task)" class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 text-slate-600 dark:text-slate-300 font-bold text-xs">编辑</button>
      <button type="button" @click="emit('remove', task)" class="ml-auto px-2 py-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-bold text-xs">删除</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({ task: { type: Object, required: true } });
// Keep the entry that must be undone first visible even when it was backfilled far in the past.
const visibleLogs = computed(() => [...props.task.logs].sort((a, b) => Number(b.can_undo) - Number(a.can_undo)).slice(0, 6));
const emit = defineEmits(['backfill', 'edit', 'remove', 'remove-log']);

const statusInfo = {
  active: { label: '进行中', class: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  upcoming: { label: '未开始', class: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' },
  ended: { label: '已过截止日期', class: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' },
  completed: { label: '已完成', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' }
};
</script>
