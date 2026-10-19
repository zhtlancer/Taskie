<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col justify-between p-3 pb-24 sm:p-6 lg:pb-6 select-none">
    <div class="max-w-5xl w-full mx-auto">
      <!-- Header -->
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:flex w-12 h-12 rounded-2xl bg-white border border-slate-200 items-center justify-center text-xl text-slate-600 hover:border-brand-300 shadow-sm active:scale-95 transition-all"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <span>📊</span>
              <span>学习历史统计</span>
            </h1>
            <p class="text-xs font-bold text-slate-400">
              回顾坚持足迹，见证自律成长
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <SoundToggle />
          <router-link
            :to="`/child/${childId}/characters`"
            @click="playClick"
            class="hidden lg:flex px-3.5 py-2 rounded-xl bg-brand-50 border border-brand-200 text-brand-700 font-bold text-xs shadow-xs hover:bg-brand-100 active:scale-95 transition-all items-center gap-1.5"
          >
            <span>📖</span>
            <span>生字生词本</span>
          </router-link>
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:inline-flex px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button hover:bg-brand-600 active:scale-95 transition-all"
          >
            返回今日看板
          </router-link>
        </div>
      </header>

      <!-- Weekly Stats Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">近 7 天累计完成任务</span>
            <div class="text-2xl font-black text-slate-800 mt-1">
              {{ totalCompletedTasks }} <span class="text-sm font-bold text-slate-500">项</span>
            </div>
          </div>
          <span class="text-3xl">✅</span>
        </div>

        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">本周完成度（截至今天）</span>
            <div class="text-2xl font-black text-brand-600 mt-1">
              {{ formatRate(thisWeek?.completion_rate) }}
            </div>
            <span class="text-[11px] font-bold text-slate-400">
              上周 {{ formatRate(lastWeek?.completion_rate) }}
            </span>
          </div>
          <span class="text-3xl">📈</span>
        </div>

        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">近 7 天斩获积分</span>
            <div class="text-2xl font-black text-amber-500 mt-1">
              {{ totalPointsEarned }} <span class="text-sm font-bold text-slate-500">分</span>
            </div>
          </div>
          <span class="text-3xl">🪙</span>
        </div>
      </div>

      <!-- My homework time: recorded time only, by subject, and where I got faster -->
      <section v-if="timeStats && timeStats.summary.recorded_seconds" class="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card mb-6">
        <div class="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2"><span>⏱</span><span>我的作业用时（近 7 天）</span></h2>
          <span class="text-xs font-bold text-slate-400">一共记录了 {{ formatMinutes(timeStats.summary.recorded_seconds) }}</span>
        </div>
        <ul v-if="childImprovements.length" class="mb-4 space-y-1.5">
          <li v-for="item in childImprovements" :key="item.key" class="px-3 py-2 rounded-xl bg-emerald-50 text-emerald-800 text-sm font-bold font-chinese">👍 {{ item.text }}</li>
        </ul>
        <TimeDailyChart :days="timeStats.days" />
      </section>

      <!-- This Week's Completion by Task -->
      <section
        v-if="thisWeek && thisWeek.items.length"
        class="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card mb-6"
      >
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span>🗓️</span>
            <span>本周任务完成度</span>
          </h2>
          <span class="text-xs font-bold text-slate-400">
            截至今天应完成 {{ thisWeek.total_units }} 次，已完成 {{ thisWeek.completed_units }} 次 · 没打开的日子也算在内哦
          </span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
          <div v-for="item in thisWeek.items" :key="item.key">
            <div class="flex items-center justify-between text-sm mb-1">
              <span class="font-bold text-slate-700 font-chinese truncate">
                {{ item.title }}
                <span v-if="item.schedule_type === 'weekly_times'" class="text-[11px] text-indigo-500 font-bold">每周{{ item.weekly_target }}次</span>
              </span>
              <span class="text-xs font-black shrink-0" :class="item.total > 0 && item.completed >= item.total ? 'text-emerald-600' : 'text-slate-500'">
                {{ item.completed }} / {{ item.total }}
                <span v-if="item.extra_completed" class="block text-[10px] text-violet-600">实际完成 {{ item.actual_completed }} 次（额外 {{ item.extra_completed }} 次）</span>
                <span v-if="item.extra_completed" class="block text-[10px] text-violet-600">目标内 +{{ item.target_points_earned }} 分 · 额外 +{{ item.extra_points_earned }} 分</span>
              </span>
            </div>
            <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="item.total > 0 && item.completed >= item.total ? 'bg-emerald-500' : 'bg-brand-500'"
                :style="{ width: `${item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0}%` }"
              ></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Long-term task progress curves -->
      <section v-if="chartGoals.length" class="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card mb-6">
        <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
          <span>📚</span>
          <span>长期任务进度</span>
        </h2>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div v-for="goal in chartGoals" :key="goal.id">
            <div class="flex items-center justify-between text-sm mb-1">
              <span class="font-bold text-slate-700 font-chinese truncate">{{ goal.title }}</span>
              <span class="text-xs font-black shrink-0" :class="goal.is_completed ? 'text-emerald-600' : 'text-indigo-600'">
                {{ goal.is_completed ? '已完成 🎉' : `${goal.done_amount} / ${goal.total_amount} ${goal.unit || ''}` }}
              </span>
            </div>
            <GoalProgressChart :goal="goal" :today="today" />
          </div>
        </div>
      </section>

      <!-- Main Section: Weekly Chart & Day List -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left 2 Cols: Bar Chart -->
        <div class="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card flex flex-col justify-between">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span>📅</span>
              <span>最近 7 天完成率趋势</span>
            </h2>
            <span class="text-xs font-bold text-slate-400">每日达标柱状图</span>
          </div>

          <div class="h-64 my-auto">
            <WeeklyChart :history-data="historyList" />
          </div>

          <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
              <span>100% 满贯达成</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-brand-500 inline-block"></span>
              <span>≥ 60% 表现优秀</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>
              <span>&lt; 60% 仍需努力</span>
            </div>
          </div>
        </div>

        <!-- Right 1 Col: Day Breakdown -->
        <div class="lg:col-span-1 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card">
          <h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <span>📋</span>
            <span>每日明细清单</span>
          </h3>

          <div class="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
            <div
              v-for="item in historyList.slice().reverse()"
              :key="item.date"
              class="p-3 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between"
            >
              <div>
                <div class="text-sm font-bold text-slate-800">
                  {{ formatDate(item.date) }}
                </div>
                <div class="text-xs text-slate-400">
                  {{ item.not_opened ? '当天没有打开 App' : item.total_tasks === 0 ? '休息日' : `完成 ${item.completed_tasks} / ${item.total_tasks} 项` }}{{ item.skipped_tasks ? ` · 跳过 ${item.skipped_tasks} 项` : '' }}
                  <span v-if="item.tasks?.some(task => task.completion_source === 'parent_backfill')" class="text-sky-600"> · 含家长补记</span>
                </div>
              </div>

              <div class="text-right">
                <span
                  v-if="item.not_opened"
                  class="text-xs font-black px-2.5 py-1 rounded-lg bg-rose-50 text-rose-600"
                >
                  未打卡
                </span>
                <span
                  v-else-if="item.total_tasks === 0"
                  class="text-xs font-black px-2.5 py-1 rounded-lg bg-slate-100 text-slate-400"
                >
                  休息
                </span>
                <span
                  v-else
                  class="text-xs font-black px-2.5 py-1 rounded-lg"
                  :class="item.completion_rate >= 1 ? 'bg-emerald-100 text-emerald-800' : 'bg-brand-50 text-brand-600'"
                >
                  {{ Math.round((item.completion_rate || 0) * 100) }}%
                </span>
                <div class="text-[11px] font-bold text-amber-600 mt-1">
                  +{{ item.points_earned || 0 }}分
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import ChildTabBar from '../components/ChildTabBar.vue';
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import WeeklyChart from '../components/WeeklyChart.vue';
import GoalProgressChart from '../components/GoalProgressChart.vue';
import TimeDailyChart from '../components/TimeDailyChart.vue';
import { formatMinutes, improvements } from '../utils/timeStats.js';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick } from '../utils/sound';

const route = useRoute();
const childStore = useChildStore();

const childId = computed(() => route.params.id || childStore.childId);
const historyList = ref([]);
const thisWeek = ref(null);
const lastWeek = ref(null);
const goals = ref([]);
const timeStats = ref(null);
const childImprovements = computed(() => timeStats.value ? improvements(timeStats.value) : []);
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
// Progress-based long-term tasks that are running or finished within the last 30 days.
const chartGoals = computed(() => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 30);
  const since = d.toISOString().slice(0, 10);
  return goals.value.filter(goal => goal.mode === 'progress' && goal.logs.length &&
    (goal.status === 'active' || (goal.completed_on || goal.end_date || '') >= since));
});

const totalCompletedTasks = computed(() => {
  return historyList.value.reduce((sum, item) => sum + (item.completed_tasks || 0), 0);
});

function formatRate(rate) {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

const totalPointsEarned = computed(() => {
  return historyList.value.reduce((sum, item) => sum + (item.points_earned || 0), 0);
});

onMounted(async () => {
  try {
    const [data, summary, goalList, time] = await Promise.all([api.getHistory(childId.value, 7), api.getWeeklySummary(childId.value), api.getChildGoals(childId.value),
      api.getTimeStats(childId.value).catch(() => null)]);
    timeStats.value = time;
    goals.value = goalList || [];
    historyList.value = data || [];
    thisWeek.value = summary?.current_week?.completion || null;
    lastWeek.value = summary?.last_week?.completion || null;
  } catch (err) {
    console.error('Failed to load history stats:', err);
  }
});

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 (${weekDays[d.getDay()]})`;
}
</script>
