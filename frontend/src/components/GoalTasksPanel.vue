<template>
  <section class="mb-4 rounded-2xl border p-4" :class="period ? 'border-sky-200 bg-gradient-to-br from-sky-50 to-amber-50/60' : 'border-indigo-100 bg-indigo-50/40'">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <h3 class="text-base font-black text-slate-800 flex flex-wrap items-center gap-x-2">
        <template v-if="period">
          <span>🏖️</span>
          <span>{{ period.name }}中</span>
          <span class="text-xs font-bold text-slate-400">{{ shortDate(period.start_date) }} – {{ shortDate(period.end_date) }}</span>
        </template>
        <template v-else>
          <span>📚</span>
          <span>长期任务</span>
        </template>
      </h3>
      <span v-if="period" class="text-xs font-black text-sky-700 bg-white px-3 py-1 rounded-xl shadow-xs">还剩 {{ daysUntil(period.end_date) }} 天</span>
    </div>

    <p v-if="error" class="mb-2 px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ error }}</p>

    <div v-if="!goals.length" class="text-xs font-bold text-slate-400">假期愉快！现在没有需要完成的长期任务。</div>
    <div v-else class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div
        v-for="goal in goals"
        :key="goal.id"
        class="bg-white rounded-2xl p-3 border"
        :class="goal.is_completed ? 'border-emerald-200' : owesToday(goal) ? 'border-rose-200' : 'border-slate-200'"
      >
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="text-sm font-bold text-slate-800 font-chinese truncate">{{ goal.title }}</span>
          <span v-if="goal.points" class="text-[11px] font-black text-amber-500 shrink-0">★ {{ goal.points }}{{ goal.mode === 'progress' ? `/${goal.unit}` : '' }}</span>
        </div>
        <div class="flex flex-wrap gap-1 mb-1.5">
          <span v-if="goal.period_name && !period" class="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-[10px] font-bold">{{ goal.period_name }}</span>
          <span v-if="goal.daily_required && dailyRow(goal)?.is_skipped && !goal.today_logged" class="px-1.5 py-0.5 rounded-md text-[10px] font-black bg-slate-100 text-slate-600">
            ⏭️ 今天已跳过 · {{ dailyRow(goal).skip_reason }}
          </span>
          <span v-else-if="goal.daily_required" class="px-1.5 py-0.5 rounded-md text-[10px] font-black" :class="goal.today_logged ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'">
            {{ goal.today_logged ? '今天已记录 ✓' : '每天要记录 · 今天还没记' }}
          </span>
          <span v-if="goal.completion_bonus && !goal.is_completed" class="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700 text-[10px] font-bold">完成再奖 {{ goal.completion_bonus }} 分</span>
        </div>

        <!-- Skipping today's required log: a child asks a parent; a parent skips at once -->
        <div v-if="goal.daily_required && dailyRow(goal) && !goal.today_logged && !goal.is_completed" class="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-bold font-chinese">
          <template v-if="dailyRow(goal).is_skipped">
            <button v-if="asParent" type="button" class="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-500" @click="$emit('unskip', dailyRow(goal))">撤销跳过</button>
          </template>
          <template v-else-if="dailyRow(goal).skip_request?.status === 'pending'">
            <span class="px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-700">⏳ 申请跳过：{{ dailyRow(goal).skip_request.reason }} · 等家长确认</span>
            <template v-if="asParent">
              <button type="button" class="px-2 py-1 rounded-lg bg-emerald-500 text-white" @click="$emit('approve-skip', dailyRow(goal))">同意跳过</button>
              <button type="button" class="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600" @click="$emit('reject-skip', dailyRow(goal))">不同意</button>
            </template>
            <button v-else type="button" class="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-500" @click="$emit('cancel-skip', dailyRow(goal))">撤回</button>
          </template>
          <span v-else-if="!asParent && ['rejected', 'revoked'].includes(dailyRow(goal).skip_request?.status)" class="text-rose-500">家长没有同意跳过，今天还是要记录哦</span>
          <button v-else type="button" class="px-2 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700" @click="$emit('skip', dailyRow(goal))">
            {{ asParent ? '⏭️ 今天跳过' : '🙋 今天没法做？' }}
          </button>
        </div>

        <template v-if="goal.mode === 'progress'">
          <div class="flex flex-wrap items-center justify-between gap-x-2 text-[11px] font-bold text-slate-500 mb-1">
            <span>{{ goal.input_mode === 'position' ? `读到第 ${goal.done_amount} / ${goal.total_amount} ${goal.unit}` : `已完成 ${goal.done_amount} / ${goal.total_amount} ${goal.unit}` }}</span>
            <span class="text-right" :class="paceClass(goal)">{{ paceText(goal) }}</span>
          </div>
          <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden mb-2">
            <div class="h-full rounded-full transition-all duration-500" :class="goal.is_completed ? 'bg-emerald-500' : 'bg-indigo-500'" :style="{ width: `${Math.round((goal.done_amount / goal.total_amount) * 100)}%` }"></div>
          </div>
          <div v-if="!goal.is_completed" class="flex items-center gap-2">
            <button type="button" class="w-10 h-10 rounded-xl bg-slate-100 text-lg font-black text-slate-600 active:scale-95" @click="step(goal, -1)">−</button>
            <span class="min-w-[64px] text-center text-sm font-black text-slate-800">
              {{ goal.input_mode === 'position' ? `第 ${valueFor(goal)} ${goal.unit}` : `${valueFor(goal)} ${goal.unit}` }}
            </span>
            <button type="button" class="w-10 h-10 rounded-xl bg-slate-100 text-lg font-black text-slate-600 active:scale-95" @click="step(goal, 1)">+</button>
            <button
              type="button"
              :disabled="busy"
              class="flex-1 min-h-[40px] rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black shadow-sm active:scale-95 disabled:opacity-50"
              @click="record(goal)"
            >
              {{ goal.input_mode === 'position' ? '记录读到这里' : '记录今天的进度' }}
            </button>
          </div>
        </template>

        <template v-else>
          <button
            v-if="!goal.is_completed"
            type="button"
            :disabled="busy"
            class="w-full min-h-[40px] rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-black shadow-sm active:scale-95 disabled:opacity-50"
            @click="record(goal)"
          >
            完成啦 ✓
          </button>
        </template>
        <div v-if="goal.is_completed" class="mt-1 text-xs font-black text-emerald-600">全部完成 🎉{{ goal.completion_bonus ? ` 完成奖励 +${goal.completion_bonus} 分` : '' }}</div>

        <!-- Today's entries can be undone -->
        <div v-if="todayLogs(goal).length" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="entry in todayLogs(goal)"
            :key="entry.id"
            type="button"
            :disabled="busy || !entry.can_undo"
            :title="entry.can_undo ? '撤销这条进度' : '请先撤销后续进度'"
            class="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-bold text-slate-500 hover:text-rose-500"
            @click="undo(entry)"
          >
            今天 {{ entryLabel(goal, entry) }} · 撤销
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import api from '../api/client';
import { playTaskComplete, playAllDone, playClick } from '../utils/sound';

const props = defineProps({
  goals: { type: Array, required: true },
  period: { type: Object, default: null },
  today: { type: String, required: true },
  // Today's daily item of each daily-required goal, by goal id, carrying its skip state.
  dailyRows: { type: Object, default: () => ({}) },
  asParent: { type: Boolean, default: false }
});
const emit = defineEmits(['changed', 'skip', 'cancel-skip', 'approve-skip', 'reject-skip', 'unskip']);

const dailyRow = goal => props.dailyRows[goal.id] || null;
const owesToday = goal => goal.daily_required && !goal.today_logged && !dailyRow(goal)?.is_skipped;

const values = ref({});
const busy = ref(false);
const error = ref('');

function daysUntil(end) {
  const ms = new Date(`${end}T00:00:00Z`) - new Date(`${props.today}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86400000) + 1);
}

function shortDate(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

// Pacing: with a deadline, today's share of what is left; without one, the estimated finish date.
function paceText(goal) {
  if (goal.is_completed) return '';
  if (goal.end_date) {
    if (goal.suggested_today > 0) return `还剩 ${goal.days_left} 天 · 今天建议再做 ${goal.suggested_today} ${goal.unit}`;
    return '今天的量已达标 👍';
  }
  if (goal.estimated_finish_date) return `每天约 ${goal.recent_daily_rate} ${goal.unit} · 预计 ${shortDate(goal.estimated_finish_date)} 完成`;
  return '开始记录，就能估算完成日期';
}

function paceClass(goal) {
  return goal.end_date && goal.suggested_today === 0 ? 'text-emerald-600' : 'text-indigo-700';
}

// Entries default to today's suggested share (or, without a deadline, the recent daily pace);
// position entries default to the page that share would reach.
function valueFor(goal) {
  if (values.value[goal.id] !== undefined) return values.value[goal.id];
  const share = Math.max(1, Math.min(goal.suggested_today || Math.round(goal.recent_daily_rate || 0) || 1, goal.remaining_amount));
  return goal.input_mode === 'position' ? goal.done_amount + share : share;
}

function step(goal, delta) {
  playClick();
  const [min, max] = goal.input_mode === 'position' ? [goal.done_amount + 1, goal.total_amount] : [1, goal.remaining_amount];
  values.value[goal.id] = Math.min(max, Math.max(min, valueFor(goal) + delta));
}

function todayLogs(goal) {
  return (goal.logs || []).filter(entry => entry.date === props.today);
}

function entryLabel(goal, entry) {
  if (goal.mode === 'check') return '完成';
  return entry.position ? `读到第 ${entry.position} ${goal.unit}` : `+${entry.amount}${goal.unit}`;
}

async function run(action) {
  busy.value = true;
  error.value = '';
  try {
    await action();
    values.value = {};
    emit('changed');
  } catch (err) {
    error.value = typeof err === 'string' ? err : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

function record(goal) {
  const payload = goal.mode === 'check' ? {} : goal.input_mode === 'position' ? { position: valueFor(goal) } : { amount: valueFor(goal) };
  return run(async () => {
    const result = await api.logPeriodProgress(goal.id, payload);
    if (result.task?.is_completed) playAllDone();
    else playTaskComplete();
  });
}

function undo(entry) {
  playClick();
  return run(() => api.deletePeriodLog(entry.id));
}
</script>
