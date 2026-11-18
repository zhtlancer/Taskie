<template>
  <div data-history-page class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col justify-between p-3 pb-24 sm:p-6 lg:pb-6 select-none">
    <div class="max-w-5xl w-full mx-auto min-w-0">
      <!-- Header -->
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
        <div class="flex items-center gap-3 min-w-0">
          <router-link
            :to="`/child/${childId}/today`"
            aria-label="返回今日看板"
            title="返回今日看板"
            class="hidden lg:flex w-12 h-12 shrink-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 items-center justify-center text-xl text-slate-600 dark:text-slate-300 hover:border-brand-300 dark:hover:border-brand-700 shadow-sm active:scale-95 transition-all"
            @click="playClick"
          >
            ←
          </router-link>
          <div class="min-w-0">
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
              <span>📊</span>
              <span>学习历史统计</span>
            </h1>
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">
              回顾坚持足迹，见证自律成长
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2 sm:gap-3">
          <SoundToggle />
          <router-link
            :to="`/child/${childId}/characters`"
            class="hidden lg:inline-flex min-h-11 px-3.5 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 font-bold text-xs shadow-xs hover:bg-brand-100 dark:hover:bg-brand-900/40 active:scale-95 transition-all items-center gap-1.5"
            @click="playClick"
          >
            <span>📖</span>
            <span>生字生词本</span>
          </router-link>
          <router-link
            :to="`/child/${childId}/today`"
            class="hidden lg:inline-flex min-h-11 px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button hover:bg-brand-600 active:scale-95 transition-all items-center"
            @click="playClick"
          >
            返回今日看板
          </router-link>
        </div>
      </header>

      <PageState v-if="!calendar.ready" kind="loading" title="等待确认家庭日期…" description="请先通过页面顶部的提示重新读取家庭时区，再查看学习历史。" />

      <template v-else>
        <!-- Weekly Stats Cards -->
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6" aria-label="近 7 天与本周概览">
          <div data-history-card="tasks" class="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card flex items-center justify-between gap-2 min-w-0">
            <div class="min-w-0">
              <span class="text-xs font-bold text-slate-500 dark:text-slate-400 block">近 7 天累计完成任务</span>
              <div class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">
                {{ historyData ? totalCompletedTasks : '—' }} <span class="text-sm font-bold text-slate-500 dark:text-slate-400">项</span>
              </div>
              <span v-if="history.state.loading" class="block text-xs text-slate-400 mt-0.5">正在读取…</span>
              <span v-else-if="history.state.error" class="block text-xs text-rose-600 dark:text-rose-300 mt-0.5">{{ historyData ? '未能更新' : '未能读取' }}</span>
            </div>
            <span class="text-xl sm:text-3xl shrink-0" aria-hidden="true">✅</span>
          </div>

          <div data-history-card="points" class="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card flex items-center justify-between gap-2 min-w-0">
            <div class="min-w-0">
              <span class="text-xs font-bold text-slate-500 dark:text-slate-400 block">近 7 天斩获积分</span>
              <div class="text-xl sm:text-2xl font-black text-amber-600 dark:text-amber-300 mt-1">
                {{ historyData ? totalPointsEarned : '—' }} <span class="text-sm font-bold text-slate-500 dark:text-slate-400">分</span>
              </div>
              <span v-if="history.state.loading" class="block text-xs text-slate-400 mt-0.5">正在读取…</span>
              <span v-else-if="history.state.error" class="block text-xs text-rose-600 dark:text-rose-300 mt-0.5">{{ historyData ? '未能更新' : '未能读取' }}</span>
            </div>
            <span class="text-xl sm:text-3xl shrink-0" aria-hidden="true">🪙</span>
          </div>

          <div data-history-card="week" class="col-span-2 sm:col-span-1 sm:order-none bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card flex items-center justify-between gap-2 min-w-0">
            <div class="min-w-0">
              <span class="text-xs font-bold text-slate-500 dark:text-slate-400 block">本周完成度（截至今天）</span>
              <div class="text-xl sm:text-2xl font-black text-brand-600 dark:text-brand-300 mt-1">
                {{ weeklyData ? formatRate(thisWeek?.completion_rate) : '—' }}
              </div>
              <span class="text-xs font-bold text-slate-500 dark:text-slate-400 block">
                <template v-if="weekly.state.loading">正在读取…</template>
                <template v-else-if="weekly.state.error">{{ weeklyData ? '未能更新' : '未能读取' }}</template>
                <template v-else>上周 {{ formatRate(lastWeek?.completion_rate) }}</template>
              </span>
            </div>
            <span class="text-xl sm:text-3xl shrink-0" aria-hidden="true">📈</span>
          </div>
        </div>

        <!-- My homework time: recorded time only, by subject, and where I got faster -->
        <section data-history-section="time" class="min-w-0 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-6 space-y-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><span>⏱</span><span>我的作业用时（近 7 天）</span></h2>
            <span v-if="timeData?.summary.recorded_seconds" class="text-xs font-bold text-slate-500 dark:text-slate-400">一共记录了 {{ formatMinutes(timeData.summary.recorded_seconds) }}</span>
          </div>
          <p v-if="time.state.loading && timeData" role="status" class="text-xs text-slate-500 dark:text-slate-400">正在更新作业用时，当前显示上次读取的数据。</p>
          <PageState v-if="time.state.error" kind="error" title="作业用时未能读取" :description="time.state.error" :busy="time.state.loading" @retry="time.load()" />
          <PageState v-else-if="time.state.loading && !timeData" kind="loading" title="正在读取作业用时…" />
          <template v-if="timeData">
            <PageState v-if="!timeData.summary?.recorded_seconds" title="近 7 天还没有记录到作业用时" description="在任务卡片里计时或记录用时后，这里会展示每天各科用时。" />
            <template v-else>
              <ul v-if="childImprovements.length" class="space-y-1.5">
                <li v-for="item in childImprovements" :key="item.key" class="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 text-sm font-bold font-chinese break-words [overflow-wrap:anywhere]">👍 {{ item.text }}</li>
              </ul>
              <TimeDailyChart :days="timeData.days" />
            </template>
          </template>
        </section>

        <!-- This Week's Completion by Task -->
        <section data-history-section="weekly" class="min-w-0 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-6 space-y-4">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <span>🗓️</span>
              <span>本周任务完成度</span>
            </h2>
            <span v-if="thisWeek?.items.length" class="text-xs font-bold text-slate-500 dark:text-slate-400">
              截至今天应完成 {{ thisWeek.total_units }} 次，已完成 {{ thisWeek.completed_units }} 次 · 没打开的日子也算在内哦
            </span>
          </div>
          <p v-if="weekly.state.loading && weeklyData" role="status" class="text-xs text-slate-500 dark:text-slate-400">正在更新本周完成度，当前显示上次读取的数据。</p>
          <PageState v-if="weekly.state.error" kind="error" title="本周完成度未能读取" :description="weekly.state.error" :busy="weekly.state.loading" @retry="weekly.load()" />
          <PageState v-else-if="weekly.state.loading && !weeklyData" kind="loading" title="正在读取本周完成度…" />
          <template v-if="weeklyData">
            <PageState v-if="!thisWeek?.items.length" title="本周还没有任务安排" description="每周打卡或日常任务安排好后，这里会统计本周各任务的完成度。" />
            <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
              <div v-for="item in thisWeek.items" :key="item.key" class="min-w-0">
                <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-sm mb-1.5">
                  <span class="min-w-0 flex-1 basis-32 font-bold text-slate-700 dark:text-slate-200 font-chinese break-words [overflow-wrap:anywhere]">
                    {{ item.title }}
                    <span v-if="item.schedule_type === 'weekly_times'" class="inline-block text-xs text-indigo-600 dark:text-indigo-300 font-bold">每周{{ item.weekly_target }}次</span>
                  </span>
                  <span class="text-xs font-black shrink-0 text-right" :class="item.total > 0 && item.completed >= item.total ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'">
                    {{ item.completed }} / {{ item.total }}
                  </span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="item.total > 0 && item.completed >= item.total ? 'bg-emerald-500' : 'bg-brand-500'"
                    :style="{ width: `${item.total > 0 ? Math.min(100, Math.round((item.completed / item.total) * 100)) : 0}%` }"
                  ></div>
                </div>
                <p v-if="item.extra_completed" class="mt-1 text-xs font-bold text-violet-600 dark:text-violet-300 break-words">
                  实际完成 {{ item.actual_completed }} 次（额外 {{ item.extra_completed }} 次） · 目标内 +{{ item.target_points_earned }} 分 · 额外 +{{ item.extra_points_earned }} 分
                </p>
              </div>
            </div>
          </template>
        </section>

        <!-- Long-term task progress curves -->
        <section data-history-section="goals" class="min-w-0 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-6 space-y-4">
          <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>📚</span>
            <span>长期任务进度</span>
          </h2>
          <p v-if="goals.state.loading && goalsData" role="status" class="text-xs text-slate-500 dark:text-slate-400">正在更新长期任务，当前显示上次读取的数据。</p>
          <PageState v-if="goals.state.error" kind="error" title="长期任务未能读取" :description="goals.state.error" :busy="goals.state.loading" @retry="goals.load()" />
          <PageState v-else-if="goals.state.loading && !goalsData" kind="loading" title="正在读取长期任务…" />
          <template v-if="goalsData">
            <PageState v-if="!chartGoals.length" title="最近没有带进度的长期任务" description="按页数或次数记录进度的长期任务，在这里会画出累计进度曲线。" />
            <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div v-for="goal in chartGoals" :key="goal.id" class="min-w-0">
                <div class="flex flex-wrap items-baseline justify-between gap-2 text-sm mb-2">
                  <span class="min-w-0 flex-1 font-bold text-slate-700 dark:text-slate-200 font-chinese break-words [overflow-wrap:anywhere]">{{ goal.title }}</span>
                  <span class="text-xs font-black shrink-0" :class="goal.is_completed ? 'text-emerald-600 dark:text-emerald-300' : 'text-indigo-600 dark:text-indigo-300'">
                    {{ goal.is_completed ? '已完成 🎉' : `${goal.done_amount} / ${goal.total_amount} ${goal.unit || ''}` }}
                  </span>
                </div>
                <GoalProgressChart :goal="goal" :today="today" />
              </div>
            </div>
          </template>
        </section>

        <!-- Main Section: Weekly Chart & Day List -->
        <section data-history-section="history" aria-label="最近 7 天学习历史" class="min-w-0 space-y-4">
          <p v-if="history.state.loading && historyData" role="status" class="text-xs text-slate-500 dark:text-slate-400">正在更新学习历史，当前显示上次读取的数据。</p>
          <PageState v-if="history.state.error" kind="error" title="学习历史未能读取" :description="history.state.error" :busy="history.state.loading" @retry="history.load()" />
          <PageState v-else-if="history.state.loading && !historyData" kind="loading" title="正在读取学习历史…" />

          <template v-if="historyData">
            <PageState v-if="!historyList.length" title="最近 7 天还没有学习记录" description="完成日常任务或开启新的一天后，这里会按天记录完成率和积分。" />
            <div v-else class="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <!-- Left 2 Cols: Bar Chart -->
              <div class="lg:col-span-2 min-w-0 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card flex flex-col justify-between">
                <div class="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                  <h2 class="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <span>📅</span>
                    <span>最近 7 天完成率趋势</span>
                  </h2>
                  <span class="text-xs font-bold text-slate-500 dark:text-slate-400">每日达标柱状图</span>
                </div>

                <div class="h-64 my-auto">
                  <WeeklyChart :history-data="historyList" />
                </div>

                <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
                  <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full bg-emerald-500 inline-block shrink-0" aria-hidden="true"></span>
                    <span>100% 满贯达成</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full bg-brand-500 inline-block shrink-0" aria-hidden="true"></span>
                    <span>≥ 60% 表现优秀</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full bg-amber-400 inline-block shrink-0" aria-hidden="true"></span>
                    <span>&lt; 60% 仍需努力</span>
                  </div>
                </div>
              </div>

              <!-- Right 1 Col: Day Breakdown -->
              <div class="lg:col-span-1 min-w-0 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                  <span>📋</span>
                  <span>每日明细清单</span>
                </h3>

                <div class="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  <div
                    v-for="item in historyList.slice().reverse()"
                    :key="item.date"
                    class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div class="min-w-0 flex-1 basis-36">
                      <div class="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {{ formatDate(item.date) }}
                      </div>
                      <div class="text-xs text-slate-500 dark:text-slate-400 break-words">
                        {{ item.not_opened ? '当天没有打开 App' : item.total_tasks === 0 ? '休息日' : `完成 ${item.completed_tasks} / ${item.total_tasks} 项` }}{{ item.skipped_tasks ? ` · 跳过 ${item.skipped_tasks} 项` : '' }}
                        <span v-if="item.tasks?.some(task => task.completion_source === 'parent_backfill')" class="text-sky-600 dark:text-sky-300"> · 含家长补记</span>
                      </div>
                    </div>

                    <div class="text-right shrink-0">
                      <span
                        v-if="item.not_opened"
                        class="inline-block text-xs font-black px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300"
                      >
                        未打卡
                      </span>
                      <span
                        v-else-if="item.total_tasks === 0"
                        class="inline-block text-xs font-black px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      >
                        休息
                      </span>
                      <span
                        v-else
                        class="inline-block text-xs font-black px-2.5 py-1 rounded-lg"
                        :class="item.completion_rate >= 1 ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200' : 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300'"
                      >
                        {{ Math.round((item.completion_rate || 0) * 100) }}%
                      </span>
                      <div class="text-xs font-bold text-amber-600 dark:text-amber-300 mt-1">
                        +{{ item.points_earned || 0 }}分
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </section>
      </template>
    </div>
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import { useCalendarStore } from '../stores/calendar';
import { useChildStore } from '../stores/child';
import { getToken } from '../utils/session.js';
import { addDays } from '../utils/schedule.js';
import { formatMinutes, improvements } from '../utils/timeStats.js';
import { playClick } from '../utils/sound';
import ChildTabBar from '../components/ChildTabBar.vue';
import GoalProgressChart from '../components/GoalProgressChart.vue';
import PageState from '../components/ParentPageState.vue';
import SoundToggle from '../components/SoundToggle.vue';
import TimeDailyChart from '../components/TimeDailyChart.vue';
import WeeklyChart from '../components/WeeklyChart.vue';

const calendar = useCalendarStore();
const route = useRoute();
const childStore = useChildStore();

const childId = computed(() => route.params.id || childStore.childId);
const today = computed(() => calendar.today);
const scopeKey = computed(() => `${childId.value}|${today.value}|${calendar.timeZone}`);
const silent = { silentError: true, preserveError: true, networkErrorMessage: '无法连接服务器，请检查网络后重新读取。' };
const message = error => typeof error === 'string' ? error : error?.message || '读取失败，请重试。';
let alive = true;

function reader(fetch) {
  const state = reactive({ data: null, loading: false, error: '', key: '' });
  let serial = 0, controller;
  const data = computed(() => calendar.ready && state.data !== null && state.key === scopeKey.value ? state.data : null);
  function stop(clear = false) {
    serial++;
    controller?.abort();
    controller = undefined;
    state.loading = false;
    if (clear) { state.data = null; state.error = ''; state.key = ''; }
  }
  async function load() {
    stop();
    if (!alive || !calendar.ready || !today.value || !childId.value || !getToken()) return;
    const request = serial, key = scopeKey.value, child = childId.value, token = getToken(), abort = new AbortController();
    controller = abort;
    const matches = () => alive && request === serial && key === scopeKey.value && child === childId.value && token === getToken() && calendar.ready;
    state.loading = true;
    state.error = '';
    try {
      const result = await fetch(child, abort.signal);
      if (matches()) { state.data = result; state.key = key; }
    } catch (error) {
      if (matches() && !abort.signal.aborted) state.error = message(error);
    } finally {
      if (request === serial) { state.loading = false; controller = undefined; }
    }
  }
  return { state, data, stop, load };
}

const history = reader((id, signal) => api.getHistory(id, 7, signal, silent));
const weekly = reader((id, signal) => api.getWeeklySummary(id, signal, silent));
const goals = reader((id, signal) => api.getChildGoals(id, signal, silent));
const time = reader((id, signal) => api.getTimeStats(id, undefined, undefined, signal, silent));
const readers = [history, weekly, goals, time];

const historyData = history.data;
const historyList = computed(() => historyData.value || []);
const weeklyData = weekly.data;
const thisWeek = computed(() => weeklyData.value?.current_week?.completion || null);
const lastWeek = computed(() => weeklyData.value?.last_week?.completion || null);
const goalsData = goals.data;
const timeData = time.data;
const childImprovements = computed(() => timeData.value ? improvements(timeData.value) : []);

// Progress-based long-term tasks that are running or finished within the last 30 days.
const chartGoals = computed(() => {
  if (!calendar.ready || !today.value || !goalsData.value) return [];
  const since = addDays(today.value, -30);
  return goalsData.value.filter(goal => goal.mode === 'progress' && goal.logs.length &&
    (goal.status === 'active' || (goal.completed_on || goal.end_date || '') >= since));
});

const totalCompletedTasks = computed(() => historyList.value.reduce((sum, item) => sum + (item.completed_tasks || 0), 0));
const totalPointsEarned = computed(() => historyList.value.reduce((sum, item) => sum + (item.points_earned || 0), 0));
const formatRate = rate => rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00Z`);
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 (${weekDays[d.getUTCDay()]})`;
}

function refresh() {
  if (!alive || !calendar.ready || !today.value || !childId.value || !getToken()) return;
  return Promise.allSettled(readers.map(resource => resource.load()));
}
function resetScope() {
  readers.forEach(resource => resource.stop(true));
  refresh();
}
function onResume() {
  if (document.hidden) return;
  const before = today.value;
  calendar.refreshToday();
  if (before === today.value) refresh();
}

watch(() => [childId.value, today.value, calendar.timeZone, calendar.ready], ([child], [previous]) => {
  if (child !== previous) readers.forEach(resource => resource.stop(true));
  if (!calendar.ready) { readers.forEach(resource => resource.stop()); return; }
  refresh();
}, { flush: 'sync' });

onMounted(() => {
  refresh();
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', onResume);
  window.addEventListener('taskie:data-restored', resetScope);
  window.addEventListener('taskie:session-changed', resetScope);
});

onBeforeUnmount(() => {
  alive = false;
  readers.forEach(resource => resource.stop());
  document.removeEventListener('visibilitychange', onResume);
  window.removeEventListener('pageshow', onResume);
  window.removeEventListener('taskie:data-restored', resetScope);
  window.removeEventListener('taskie:session-changed', resetScope);
});
</script>
