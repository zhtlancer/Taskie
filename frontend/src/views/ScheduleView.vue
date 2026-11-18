<template>
  <div data-schedule-page class="min-h-screen w-full max-w-[1180px] mx-auto p-3 pb-24 lg:p-4 select-none">
    <header class="bg-white dark:bg-slate-900 rounded-2xl px-4 py-3 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap items-center justify-between gap-3 mb-3">
      <div class="flex items-center gap-3 min-w-0">
        <router-link :to="`/child/${childId}/today`" class="hidden lg:flex min-h-[44px] items-center px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300" @click="playClick">← 今日任务</router-link>
        <h1 class="text-lg font-black text-slate-800 dark:text-slate-100">📅 课程表</h1>
      </div>
      <div v-if="calendar.ready" role="group" aria-label="课程表周切换" class="flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0">
        <div class="flex items-center justify-between gap-2 flex-1 sm:flex-none min-w-0">
          <button type="button" class="w-11 h-11 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-black text-slate-600 dark:text-slate-300" aria-label="上一周" @click="shiftWeek(-7)">‹</button>
          <div class="text-center min-w-0" aria-live="polite">
            <div data-schedule-range class="text-sm font-black text-slate-800 dark:text-slate-100">{{ weekRange }}</div>
            <div class="text-xs font-bold text-slate-500 dark:text-slate-400">
              {{ weekStart === mondayOf(today) ? '本周' : weekStart > today ? '以后' : '以前' }}{{ weekLabel ? ` · ${weekLabel}周` : '' }}
            </div>
          </div>
          <button type="button" class="w-11 h-11 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-black text-slate-600 dark:text-slate-300" aria-label="下一周" @click="shiftWeek(7)">›</button>
        </div>
        <button v-if="weekStart !== mondayOf(today)" type="button" class="min-h-[44px] px-3 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-bold" @click="shiftWeek(null)">回到本周</button>
      </div>
    </header>

    <PageState v-if="!calendar.ready" kind="loading" title="等待确认家庭日期…" description="请先通过页面顶部的提示重新读取家庭时区，再查看课程安排。" />
    <PageState v-else-if="loading" kind="loading" title="正在加载课程表…" />
    <PageState v-else-if="loadError" kind="error" title="课程表未能读取" :description="loadError" @retry="load" />
    <PageState v-else-if="!hasAnything" kind="empty" title="这一周没有课程安排" description="可以切换到其他周查看；课程由家长在“课程日历 → 学校与课外班”中设置。" />

    <template v-else>
      <!-- Phones and portrait tablets keep all seven day buttons in a scrolling row. -->
      <div class="lg:hidden">
        <div role="group" aria-label="选择上课日期" class="flex gap-1.5 overflow-x-auto pb-2">
          <button
            v-for="day in days"
            :key="day.date"
            :data-schedule-day="day.date"
            :aria-pressed="selectedDate === day.date"
            :aria-current="day.date === today ? 'date' : undefined"
            type="button"
            class="shrink-0 min-w-[56px] min-h-[48px] px-3 py-2 rounded-xl text-xs font-bold border"
            :class="selectedDate === day.date ? 'bg-brand-500 border-brand-500 text-white' : day.date === today ? 'bg-brand-50 dark:bg-brand-900/40 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="selectedDate = day.date; playClick()"
          >
            {{ WEEKDAY_NAMES[day.weekday] }}<span class="block text-xs opacity-80">{{ shortDate(day.date) }}</span>
          </button>
        </div>
        <section v-if="selectedDay" :aria-label="`${selectedDay.date}的课程`" class="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-700">
          <h2 class="mb-3 text-sm font-black text-slate-700 dark:text-slate-200">{{ shortDate(selectedDay.date) }} {{ WEEKDAY_NAMES[selectedDay.weekday] }}{{ selectedDay.date === today ? ' · 今天' : '' }}</h2>
          <DaySchedule :day="selectedDay" />
        </section>
      </div>

      <!-- Landscape tablets show the full week; empty weekends are omitted. -->
      <div class="hidden lg:grid gap-3" :style="{ gridTemplateColumns: `repeat(${shownDays.length}, minmax(0, 1fr))` }">
        <section
          v-for="day in shownDays"
          :key="day.date"
          :aria-label="`${day.date}的课程`"
          class="bg-white dark:bg-slate-900 rounded-2xl p-2.5 border min-h-[200px] min-w-0"
          :class="day.date === today ? 'border-brand-300 dark:border-brand-700 shadow-card' : 'border-slate-200 dark:border-slate-700'"
        >
          <h2 class="flex flex-wrap items-baseline justify-between gap-1 px-1 mb-2">
            <span class="text-sm font-black" :class="day.date === today ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-200'">{{ WEEKDAY_NAMES[day.weekday] }}</span>
            <span class="text-xs font-bold text-slate-500 dark:text-slate-400">{{ day.date === today ? '今天' : shortDate(day.date) }}</span>
          </h2>
          <DaySchedule :day="day" compact />
        </section>
      </div>
    </template>

    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import DaySchedule from '../components/DaySchedule.vue';
import ChildTabBar from '../components/ChildTabBar.vue';
import PageState from '../components/ParentPageState.vue';
import { getToken } from '../utils/session.js';
import { playClick } from '../utils/sound';
import { WEEKDAY_NAMES, addDays, mondayOf, shortDate } from '../utils/schedule.js';
const calendar = useCalendarStore();
const route = useRoute();
const childId = computed(() => route.params.id);
const today = computed(() => calendar.today);
const weekStart = ref(mondayOf(today.value));
const days = ref([]);
const selectedDate = ref(today.value);
const loading = ref(true), loadError = ref('');
const scopeKey = computed(() => `${childId.value}|${today.value}|${calendar.timeZone}|${weekStart.value}`);
let alive = true, serial = 0, reader;

const selectedDay = computed(() => days.value.find(day => day.date === selectedDate.value) || days.value[0]);
const hasContent = day => day.school.length || day.outside.length || day.holiday || day.makeup;
const shownDays = computed(() => days.value.filter(day => ![0, 6].includes(day.weekday) || hasContent(day)));
const hasAnything = computed(() => days.value.some(hasContent));
const weekLabel = computed(() => days.value.find(day => day.week)?.week ?? null);
const weekRange = computed(() => {
  const end = addDays(weekStart.value, 6);
  return `${weekStart.value.slice(0, 4)}/${shortDate(weekStart.value)} – ${end.slice(0, 4) !== weekStart.value.slice(0, 4) ? `${end.slice(0, 4)}/` : ''}${shortDate(end)}`;
});

async function load() {
  const request = ++serial, scope = scopeKey.value, token = getToken();
  reader?.abort();
  days.value = []; loadError.value = ''; loading.value = false;
  if (!calendar.ready) return;
  if (!token) { loadError.value = '登录状态已变更，请重新登录后查看课程表。'; return; }
  const controller = new AbortController(); reader = controller;
  const current = () => alive && request === serial && scope === scopeKey.value && token === getToken() && calendar.ready;
  loading.value = true;
  try {
    const result = await api.getChildSchedule(childId.value, weekStart.value, addDays(weekStart.value, 6), controller.signal,
      { silentError: true, networkErrorMessage: '无法连接服务器，请检查网络后重新读取课程表。' });
    if (!current()) return;
    days.value = result;
    if (!result.some(day => day.date === selectedDate.value)) selectedDate.value = result[0]?.date || weekStart.value;
  } catch (error) {
    if (current()) loadError.value = typeof error === 'string' ? error : error?.message || '读取失败，请重新读取课程表。';
  } finally {
    if (current()) { loading.value = false; reader = undefined; }
  }
}

function shiftWeek(offset) {
  if (!calendar.ready) return;
  playClick();
  weekStart.value = offset === null ? mondayOf(today.value) : addDays(weekStart.value, offset);
  selectedDate.value = offset === null ? today.value : weekStart.value;
  // The scope watcher reads the new week. Returning to today's date in this week needs no new read.
}

watch(() => [childId.value, today.value, calendar.timeZone, calendar.ready], ([child, day], [previousChild, previousDay]) => {
  if (child !== previousChild) {
    weekStart.value = mondayOf(day); selectedDate.value = day;
  } else {
    if (weekStart.value === mondayOf(previousDay)) weekStart.value = mondayOf(day);
    if (selectedDate.value === previousDay) selectedDate.value = day;
  }
});
watch(() => [scopeKey.value, calendar.ready], load);
watch([days, selectedDate], async () => {
  await nextTick();
  if (alive) document.querySelector(`[data-schedule-day="${selectedDate.value}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
});
function resume() { if (!document.hidden) load(); }
function reset() { load(); }
onMounted(() => {
  load();
  document.addEventListener('visibilitychange', resume); window.addEventListener('pageshow', resume);
  window.addEventListener('taskie:data-restored', reset); window.addEventListener('taskie:session-changed', reset);
});
onUnmounted(() => {
  alive = false; serial++; reader?.abort();
  document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume);
  window.removeEventListener('taskie:data-restored', reset); window.removeEventListener('taskie:session-changed', reset);
});
</script>
