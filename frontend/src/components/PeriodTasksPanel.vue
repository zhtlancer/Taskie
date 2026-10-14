<template>
  <section class="mb-4 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-amber-50/60 p-4">
    <div class="flex items-center justify-between mb-3">
      <h3 class="text-base font-black text-slate-800 flex items-center gap-2">
        <span>🏖️</span>
        <span>{{ period.name }}中</span>
        <span class="text-xs font-bold text-slate-400">{{ shortDate(period.start_date) }} – {{ shortDate(period.end_date) }}</span>
      </h3>
      <span class="text-xs font-black text-sky-700 bg-white px-3 py-1 rounded-xl shadow-xs">
        还剩 {{ daysLeft }} 天
      </span>
    </div>

    <p v-if="error" class="mb-2 px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ error }}</p>

    <div v-if="period.tasks.length === 0" class="text-xs font-bold text-slate-400">假期愉快！这个假期还没有假期任务。</div>
    <div v-else class="grid grid-cols-2 gap-3">
      <div
        v-for="task in period.tasks"
        :key="task.id"
        class="bg-white rounded-2xl p-3 border"
        :class="task.is_completed ? 'border-emerald-200' : 'border-slate-200'"
      >
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <span class="text-sm font-bold text-slate-800 font-chinese truncate">{{ task.title }}</span>
          <span v-if="task.points" class="text-[11px] font-black text-amber-500 shrink-0">
            ★ {{ task.points }}{{ task.mode === 'progress' ? `/${task.unit}` : '' }}
          </span>
        </div>

        <!-- Progress towards the total -->
        <template v-if="task.mode === 'progress'">
          <div class="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-1">
            <span>已完成 {{ task.done_amount }} / {{ task.total_amount }} {{ task.unit }}</span>
            <span v-if="task.is_completed" class="text-emerald-600">全部完成 🎉</span>
            <span v-else-if="task.suggested_today > 0" class="text-sky-700">今天建议再做 {{ task.suggested_today }} {{ task.unit }}</span>
            <span v-else class="text-emerald-600">今天的量已达标 👍</span>
          </div>
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-2">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="task.is_completed ? 'bg-emerald-500' : 'bg-sky-500'"
              :style="{ width: `${Math.round((task.done_amount / task.total_amount) * 100)}%` }"
            ></div>
          </div>
          <div v-if="!task.is_completed" class="flex items-center gap-2">
            <button type="button" class="w-10 h-10 rounded-xl bg-slate-100 text-lg font-black text-slate-600 active:scale-95" @click="step(task, -1)">−</button>
            <span class="min-w-[56px] text-center text-sm font-black text-slate-800">{{ amountFor(task) }} {{ task.unit }}</span>
            <button type="button" class="w-10 h-10 rounded-xl bg-slate-100 text-lg font-black text-slate-600 active:scale-95" @click="step(task, 1)">+</button>
            <button
              type="button"
              :disabled="busy"
              class="flex-1 min-h-[40px] rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-black shadow-sm active:scale-95 disabled:opacity-50"
              @click="log(task, amountFor(task))"
            >
              记录今天的进度
            </button>
          </div>
        </template>

        <!-- Done once -->
        <template v-else>
          <button
            v-if="!task.is_completed"
            type="button"
            :disabled="busy"
            class="w-full min-h-[40px] rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-black shadow-sm active:scale-95 disabled:opacity-50"
            @click="log(task, 1)"
          >
            完成啦 ✓
          </button>
          <div v-else class="text-xs font-black text-emerald-600">已完成 🎉</div>
        </template>

        <!-- Today's entries can be undone -->
        <div v-if="todayLogs(task).length" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="entry in todayLogs(task)"
            :key="entry.id"
            type="button"
            :disabled="busy"
            class="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-500 hover:text-rose-500"
            @click="undo(entry)"
          >
            今天 {{ task.mode === 'progress' ? `+${entry.amount}${task.unit}` : '完成' }} · 撤销
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref, computed } from 'vue';
import api from '../api/client';
import { playTaskComplete, playClick } from '../utils/sound';

const props = defineProps({
  period: { type: Object, required: true },
  today: { type: String, required: true }
});
const emit = defineEmits(['changed']);

const amounts = ref({});
const busy = ref(false);
const error = ref('');

const daysLeft = computed(() => {
  const ms = new Date(`${props.period.end_date}T00:00:00Z`) - new Date(`${props.today}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86400000) + 1);
});

function shortDate(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

// Default to today's suggested share, never more than what is left.
function amountFor(task) {
  return amounts.value[task.id] ?? Math.max(1, Math.min(task.suggested_today || 1, task.remaining_amount));
}

function step(task, delta) {
  playClick();
  amounts.value[task.id] = Math.min(task.remaining_amount, Math.max(1, amountFor(task) + delta));
}

function todayLogs(task) {
  return (task.logs || []).filter(entry => entry.date === props.today);
}

async function run(action) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    amounts.value = {};
    emit('changed');
  } catch (err) {
    error.value = typeof err === 'string' ? err : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

function log(task, amount) {
  return run(async () => {
    await api.logPeriodProgress(task.id, { amount });
    playTaskComplete();
  });
}

function undo(entry) {
  playClick();
  return run(() => api.deletePeriodLog(entry.id));
}
</script>
