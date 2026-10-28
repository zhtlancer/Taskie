<template>
  <div class="time-stats-page min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="time-stats-main max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <div class="time-stats-screen">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2"><span>⏱</span><span>用时统计</span></h2>
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5">按家庭时区统计；平均值只用已记录用时，缺失用时在样本充足时单独估算</p>
        </div>
        <router-link to="/parent/dashboard" class="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">← 数据总览</router-link>
      </div>

      <!-- Filters: child and range, in one row -->
      <div class="flex flex-wrap items-center gap-2 mb-5">
        <button
          v-for="child in children"
          :key="child.id"
          type="button"
          class="min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold border font-chinese"
          :aria-pressed="selectedChild?.id === child.id"
          :class="selectedChild?.id === child.id ? 'bg-brand-500 border-brand-500 text-white shadow-button' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'"
          @click="selectChild(child)"
        >
          {{ child.avatar_emoji }} {{ child.name }}
        </button>
        <span class="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700"></span>
        <button
          v-for="range in ranges"
          :key="range.key"
          type="button"
          class="min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold border font-chinese"
          :aria-pressed="rangeKey === range.key"
          :class="rangeKey === range.key ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
          @click="selectRange(range.key)"
        >
          {{ range.label }}
        </button>
        <button type="button" class="min-h-[44px] px-3 py-2 rounded-xl text-xs font-bold border" :aria-pressed="rangeKey === 'custom'"
          :class="rangeKey === 'custom' ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
          @click="selectCustomRange">自定义日期</button>
      </div>

      <form v-if="rangeKey === 'custom'" class="mb-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4" novalidate @submit.prevent="applyCustomRange">
        <div class="stats-custom-range gap-3 items-end">
          <label class="min-w-0 text-sm font-bold">开始日期<input v-model="customDraft.from" type="date" required class="stats-date-input ui-input block w-full mt-1" /></label>
          <label class="min-w-0 text-sm font-bold">结束日期<input v-model="customDraft.to" type="date" required class="stats-date-input ui-input block w-full mt-1" /></label>
          <button type="submit" :disabled="!selectedChild" class="ui-button-primary">更新统计</button>
        </div>
        <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">含首尾日期，最多 366 天。修改后点击“更新统计”应用。</p>
        <p v-if="rangeError" role="alert" class="mt-2 text-sm text-rose-600 dark:text-rose-300">{{ rangeError }}</p>
      </form>

      <div class="flex flex-wrap items-center gap-2 mb-4">
        <button type="button" :disabled="!canExport" class="ui-button-secondary" @click="downloadCsv('daily')">按日导出 CSV</button>
        <button type="button" :disabled="!canExport" class="ui-button-secondary" @click="downloadCsv('tasks')">按任务导出 CSV</button>
        <button type="button" :disabled="!canExport" class="ui-button-secondary" @click="printReport">打印报告</button>
        <p v-if="customDirty" class="text-xs text-slate-500 dark:text-slate-400">日期尚未应用，请先更新统计。</p>
      </div>
      <p v-if="downloadError" role="alert" class="mb-4 text-sm text-rose-600 dark:text-rose-300">{{ downloadError }}</p>
      <p v-if="error" role="alert" class="mb-4 px-4 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }} <button v-if="selectedChild" type="button" class="min-h-[44px] px-3 underline" @click="load">重新读取</button></p>
      <div v-if="loading" class="text-center py-20 text-brand-500 dark:text-brand-400 font-bold"><span class="animate-spin mr-2">⏳</span> 正在统计...</div>

      <template v-else-if="stats">
        <p class="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2" data-stats-range>{{ selectedChild.name }} · {{ stats.from }} 至 {{ stats.to }} · {{ calendar.timeZone }}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mb-4">{{ TIME_STATS_NOTE }}</p>
        <!-- Headline numbers -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <div class="text-xs font-bold text-slate-400">已记录用时</div>
            <div class="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{{ formatMinutes(stats.summary.recorded_seconds) }}</div>
            <div class="text-xs font-bold text-slate-400 mt-0.5">
              {{ compareText }}
            </div>
            <div class="text-xs text-slate-500 dark:text-slate-400 mt-1">系统补估 {{ formatMinutes(estimateSeconds(stats.summary)) }} · 含估算 {{ formatMinutes(stats.summary.estimated_seconds) }}</div>
          </div>
          <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <div class="text-xs font-bold text-slate-400">平均每天（含估算）</div>
            <div class="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{{ workDays ? formatMinutes(stats.summary.estimated_seconds / workDays) : '—' }}</div>
            <div class="text-xs font-bold text-slate-400 mt-0.5">按有计时任务的 {{ workDays }} 天算</div>
          </div>
          <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <div class="text-xs font-bold text-slate-400">没记录用时</div>
            <div class="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{{ stats.summary.missing }} <span class="text-sm">次</span></div>
            <div class="text-xs font-bold text-slate-400 mt-0.5">共 {{ stats.summary.sessions }} 次，{{ stats.summary.estimated_missing }} 次已估算，{{ unestimatedCount(stats.summary) }} 次未能估算</div>
          </div>
          <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <div class="text-xs font-bold text-slate-400">平均几点写完</div>
            <div class="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{{ stats.summary.finish_average || '—' }}</div>
            <div class="text-xs font-bold text-slate-400 mt-0.5">
              <template v-if="stats.summary.finish_latest">最晚 {{ stats.summary.finish_latest }}（{{ shortDate(stats.summary.finish_latest_date) }}）</template>
              <template v-if="stats.previous.finish_average"> · 之前平均 {{ stats.previous.finish_average }}</template>
            </div>
          </div>
        </div>

        <p v-if="!stats.summary.sessions" class="mb-5 px-4 py-3 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-xs font-bold">
          这段时间还没有用时记录。在“任务模板”或长期任务里打开“⏱ 记录用时”，孩子完成时计时或填写用了多久，这里就会有数据。<router-link to="/parent/tasks" class="block min-h-[44px] py-3 underline">去配置计时任务 →</router-link>
        </p>

        <!-- ① Each day -->
        <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-3">📅 每天的作业用时</h3>
          <TimeDailyChart :days="stats.days" show-estimate />
        </section>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
          <!-- ② Subjects -->
          <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-3">📚 各学科用时</h3>
            <p v-if="!stats.subjects.length" class="text-xs font-bold text-slate-400">没有数据</p>
            <ul v-else class="space-y-3">
              <li v-for="subject in subjectRows" :key="subject.subject">
                <div class="flex items-baseline justify-between text-xs font-bold mb-1">
                  <span class="flex items-center gap-1.5 text-slate-700 dark:text-slate-200"><span class="w-2.5 h-2.5 rounded-sm" :style="{ background: SUBJECT_COLORS[subject.subject] }"></span>{{ subject.subject }}</span>
                  <span class="text-slate-500 dark:text-slate-400">
                    {{ formatMinutes(subject.recorded_seconds) }}
                    <template v-if="subject.estimated_seconds > subject.recorded_seconds">（含估算 {{ formatMinutes(subject.estimated_seconds) }}）</template>
                    · {{ subject.share }}%
                  </span>
                </div>
                <div class="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div class="h-full rounded-r" :style="{ width: `${subject.share}%`, background: SUBJECT_COLORS[subject.subject] }"></div>
                </div>
              </li>
            </ul>
          </section>

          <!-- ⑥ When it was finished -->
          <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
            <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-1">🌙 几点写完作业</h3>
            <p class="text-xs font-bold text-slate-400 mb-2">每天最后一项任务完成的时间（所有任务都算，事后补记的不算；今天还没结束，不算在内）</p>
            <p v-if="!stats.summary.finish_days" class="text-xs font-bold text-slate-400">没有数据</p>
            <FinishTimeChart v-else :days="stats.days" />
          </section>
        </div>

        <!-- ③④ Each task, against its expected time -->
        <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-3">📝 每项任务的用时</h3>
          <p v-if="!stats.tasks.length" class="text-xs font-bold text-slate-400">没有数据</p>
          <div v-else>
            <div class="space-y-3 lg:hidden">
              <article v-for="task in stats.tasks" :key="task.key" class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                <h4 class="text-sm font-bold text-slate-800 dark:text-slate-100">{{ task.title }}</h4>
                <div class="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>平均 {{ formatMinutes(task.average_seconds) ?? '—' }}</span><span>已记录 {{ task.recorded }} / {{ task.sessions }} 次</span></div>
                <div class="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>预计 {{ task.expected_minutes ? `${task.expected_minutes} 分` : '未设置' }}</span><span :class="trendClass(task)">{{ trendText(task) }}</span></div>
                <p v-if="task.over_expected" class="text-xs text-amber-700 dark:text-amber-300">{{ task.judged }} 次里 {{ task.over_expected }} 次超时</p>
                <Sparkline v-if="task.points.length" :values="task.points.map(p => ({ value: p.seconds, title: `${shortDate(p.date)} ${formatMinutes(p.seconds)}` }))" :color="SUBJECT_COLORS[subjectOf(task.subject)]" :label="`${task.title} 用时趋势`" />
              </article>
            </div>
            <div class="hidden lg:block overflow-x-auto -mx-1">
            <table class="w-full min-w-[720px] text-xs">
              <thead class="text-slate-400">
                <tr>
                  <th class="px-2 py-2 text-left font-bold">任务</th>
                  <th class="px-2 py-2 text-right font-bold">有记录</th>
                  <th class="px-2 py-2 text-right font-bold">平均</th>
                  <th class="px-2 py-2 text-right font-bold">最快 – 最慢</th>
                  <th class="px-2 py-2 text-right font-bold">和之前比</th>
                  <th class="px-2 py-2 text-left font-bold">预计用时</th>
                  <th class="px-2 py-2 text-left font-bold">趋势</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="task in stats.tasks" :key="task.key" class="border-t border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold">
                  <td class="px-2 py-2.5">
                    <span class="inline-flex items-center gap-1.5 font-chinese">
                      <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: SUBJECT_COLORS[subjectOf(task.subject)] }"></span>
                      {{ task.title }}
                      <span v-if="task.kind !== 'template'" class="px-1 rounded bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 dark:text-slate-400">{{ task.kind === 'goal' ? '长期' : task.kind === 'homework' ? '作业' : '临时' }}</span>
                    </span>
                  </td>
                  <td class="px-2 py-2.5 text-right text-slate-500 dark:text-slate-400">{{ task.recorded }} / {{ task.sessions }} 次</td>
                  <td class="px-2 py-2.5 text-right">{{ formatMinutes(task.average_seconds) ?? '—' }}</td>
                  <td class="px-2 py-2.5 text-right text-slate-500 dark:text-slate-400">{{ task.recorded ? `${formatMinutes(task.min_seconds)} – ${formatMinutes(task.max_seconds)}` : '—' }}</td>
                  <td class="px-2 py-2.5 text-right" :class="trendClass(task)">{{ trendText(task) }}</td>
                  <td class="px-2 py-2.5">
                    <template v-if="task.expected_minutes">
                      {{ task.expected_minutes }} 分
                      <span v-if="task.over_expected" class="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200">⚠️ {{ task.judged }} 次里 {{ task.over_expected }} 次超时</span>
                      <span v-else-if="task.judged" class="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200">✓ 都没超时</span>
                    </template>
                    <span v-else class="text-slate-300">没设</span>
                  </td>
                  <td class="px-2 py-2.5">
                    <Sparkline
                      v-if="task.points.length"
                      :values="task.points.map(p => ({ value: p.seconds, title: `${shortDate(p.date)} ${formatMinutes(p.seconds)}` }))"
                      :color="SUBJECT_COLORS[subjectOf(task.subject)]"
                      :label="`${task.title} 用时趋势`"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        </section>

        <!-- ⑤ Reading speed of long-term tasks -->
        <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <h3 class="text-base font-black text-slate-800 dark:text-slate-100 mb-1">📖 长期任务的速度</h3>
          <p class="text-xs font-bold text-slate-400 mb-3">按有用时的进度记录计算，比如每读一页用多久</p>
          <p v-if="!stats.goals.length" class="text-xs font-bold text-slate-400">没有数据：长期任务打开“记录用时”并按页（或其他单位）记录进度后才有</p>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="goal in stats.goals" :key="goal.id" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-sm font-black text-slate-800 dark:text-slate-100 font-chinese truncate">{{ goal.title }}</div>
                <div class="text-xl font-black text-slate-800 dark:text-slate-100 mt-0.5">每{{ goal.unit }} {{ formatPerUnit(goal.seconds_per_unit) }}</div>
                <div class="text-xs font-bold text-slate-400">
                  {{ goal.amount }} {{ goal.unit }}有计时
                  <template v-if="goal.previous_seconds_per_unit"> · 之前每{{ goal.unit }} {{ formatPerUnit(goal.previous_seconds_per_unit) }}</template>
                </div>
              </div>
              <Sparkline
                v-if="goal.points.length > 1"
                :values="goal.points.map(p => ({ value: p.seconds_per_unit, title: `${shortDate(p.date)} 每${goal.unit} ${formatPerUnit(p.seconds_per_unit)}` }))"
                :label="`${goal.title} 速度趋势`"
                :width="120"
                :height="36"
              />
            </div>
          </div>
        </section>
      </template>
      </div>
      <TimeStatsReport v-if="canExport" :stats="stats" :child-name="selectedChild.name" :time-zone="calendar.timeZone || 'UTC'" />
      <!-- Printing from the browser menu while no report is ready would otherwise give a blank page. -->
      <p v-else class="time-stats-print-unavailable">统计报告尚未就绪：日期未应用、正在加载或读取失败。请在页面上更新统计后再打印。</p>
    </main>
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import TimeDailyChart from '../components/TimeDailyChart.vue';
import FinishTimeChart from '../components/FinishTimeChart.vue';
import Sparkline from '../components/Sparkline.vue';
import TimeStatsReport from '../components/TimeStatsReport.vue';
import { SUBJECT_COLORS, formatMinutes, formatPerUnit, minutesDelta, rangePresets, subjectOf } from '../utils/timeStats.js';
import { validateStatsRange, estimateSeconds, unestimatedCount, timeStatsCsv, timeStatsFilename, TIME_STATS_NOTE } from '../utils/timeStatsReport.js';
import { shortDate } from '../utils/schedule.js';
const calendar = useCalendarStore();

const route = useRoute();
const children = ref([]);
const selectedChild = ref(null);
const timetables = ref([]);
const rangeKey = ref('7');
const appliedCustom = ref(null);
const customDraft = ref({ from: '', to: '' });
const rangeError = ref('');
const downloadError = ref('');
const stats = ref(null);
const statsChildId = ref(null);
const loading = ref(true);
const error = ref('');
let statsRequest = 0;
let childRequest = 0;
let disposed = false;
let statsController;
let timetableController;
const downloads = new Map();

const ranges = computed(() => rangePresets(timetables.value, calendar.today));
const range = computed(() => rangeKey.value === 'custom' && appliedCustom.value ? appliedCustom.value : ranges.value.find(r => r.key === rangeKey.value) || ranges.value[0]);
const customDirty = computed(() => rangeKey.value === 'custom' && (customDraft.value.from !== range.value.from || customDraft.value.to !== range.value.to));
const canExport = computed(() => Boolean(stats.value && !loading.value && !error.value && !rangeError.value && !customDirty.value &&
  statsChildId.value === selectedChild.value?.id && stats.value.from === range.value.from && stats.value.to === range.value.to));
const workDays = computed(() => stats.value ? stats.value.days.filter(day => day.sessions).length : 0);
const compareText = computed(() => {
  const delta = minutesDelta(stats.value.summary.recorded_seconds, stats.value.previous.recorded_seconds);
  return delta ? `比之前同样长的一段${delta}` : '之前没有记录';
});
const subjectRows = computed(() => {
  const total = stats.value.subjects.reduce((sum, s) => sum + s.estimated_seconds, 0) || 1;
  return stats.value.subjects.map(s => ({ ...s, share: Math.round((s.estimated_seconds / total) * 100) }));
});

// Faster is green text with an arrow; slower stays neutral ink, never alarm red.
function trendText(task) {
  if (task.average_seconds === null || task.previous_average_seconds === null) return '—';
  const diff = Math.round((task.average_seconds - task.previous_average_seconds) / 60);
  if (diff === 0) return '持平';
  return diff < 0 ? `↓ 快 ${-diff} 分` : `↑ 慢 ${diff} 分`;
}
const trendClass = task => trendText(task).startsWith('↓') ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400';

async function load() {
  if (!selectedChild.value || disposed) return;
  const request = ++statsRequest;
  statsController?.abort();
  const controller = new AbortController();
  statsController = controller;
  const childId = selectedChild.value.id;
  const { from, to } = range.value;
  loading.value = true;
  error.value = '';
  downloadError.value = '';
  stats.value = null;
  statsChildId.value = null;
  try {
    const result = await api.getTimeStats(childId, from, to, controller.signal, { silentError: true });
    if (request === statsRequest) { stats.value = result; statsChildId.value = childId; }
  } catch (err) {
    if (request === statsRequest) error.value = typeof err === 'string' ? err : '加载失败，请重试';
  } finally {
    if (request === statsRequest) loading.value = false;
  }
}

async function selectChild(child) {
  const request = ++childRequest;
  // Invalidate the old child's stats before waiting for the new child's timetable.
  ++statsRequest;
  statsController?.abort();
  timetableController?.abort();
  const controller = new AbortController();
  timetableController = controller;
  selectedChild.value = child;
  timetables.value = [];
  stats.value = null;
  loading.value = true;
  error.value = '';
  let result;
  try {
    result = await api.getTimetables(child.id, controller.signal);
  } catch {
    result = [];
  }
  if (request !== childRequest) return;
  timetables.value = result;
  if (rangeKey.value !== 'custom' && !ranges.value.some(r => r.key === rangeKey.value)) rangeKey.value = '7';
  await load();
}

watch(() => calendar.today, () => { if (selectedChild.value) load(); });

function selectRange(key) {
  calendar.refreshToday();
  rangeError.value = '';
  rangeKey.value = key;
  load();
}

function selectCustomRange() {
  if (rangeKey.value === 'custom') return;
  const { from, to } = range.value;
  appliedCustom.value = { from, to };
  customDraft.value = { from, to };
  rangeError.value = '';
  rangeKey.value = 'custom';
}

function applyCustomRange() {
  rangeError.value = validateStatsRange(customDraft.value.from, customDraft.value.to);
  if (rangeError.value) return;
  appliedCustom.value = { ...customDraft.value };
  load();
}

function downloadCsv(kind) {
  if (!canExport.value) return;
  downloadError.value = '';
  let url;
  const link = document.createElement('a');
  try {
    url = URL.createObjectURL(new Blob([timeStatsCsv(stats.value, selectedChild.value.name, calendar.timeZone || 'UTC', kind)], { type: 'text/csv;charset=utf-8' }));
    link.href = url;
    link.download = timeStatsFilename(stats.value, selectedChild.value.name, kind);
    document.body.append(link);
    link.click();
    // Safari may consume the blob after click returns; keep it alive until the download starts.
    downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000));
  } catch {
    if (url) URL.revokeObjectURL(url);
    downloadError.value = '导出失败，请重试';
  } finally { link.remove(); }
}

function printReport() { if (canExport.value) window.print(); }

onMounted(async () => {
  try {
    const result = await api.getChildren();
    if (disposed) return;
    children.value = result;
    const wanted = children.value.find(child => child.id === route.query.child) || children.value[0];
    if (wanted) await selectChild(wanted);
    else loading.value = false;
  } catch (err) {
    if (disposed) return;
    error.value = typeof err === 'string' ? err : '加载失败，请重试';
    loading.value = false;
  }
});

onUnmounted(() => {
  disposed = true;
  ++statsRequest;
  ++childRequest;
  statsController?.abort();
  timetableController?.abort();
  for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url); }
  downloads.clear();
});
</script>

<style scoped>
.stats-custom-range { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); }
.stats-date-input { min-width: 0; max-width: 100%; appearance: none; }
.stats-date-input::-webkit-date-and-time-value { text-align: left; }
.stats-date-input::-webkit-datetime-edit { min-width: 0; padding: 0; }
.time-stats-print-unavailable { display: none; }
@media print {
  .time-stats-page > :deep(header) { display: none !important; }
  .time-stats-screen { display: none !important; }
  .time-stats-print-unavailable { display: block; color: #000; font: 12pt/1.5 system-ui, sans-serif; }
  .time-stats-page { page: taskie-time-stats; }
  .time-stats-page, .time-stats-main { display: block; min-height: 0; margin: 0; padding: 0; max-width: none; background: white !important; }
}
</style>
<style>
@media print {
  @page taskie-time-stats { size: A4; margin: 12mm; }
  body:has(.time-stats-page), body:has(.time-stats-page) .app-shell, body:has(.time-stats-page) #app { background: white !important; min-height: 0; height: auto; padding: 0; }
}
</style>
