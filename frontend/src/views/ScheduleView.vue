<template>
  <div class="min-h-screen w-full max-w-[1180px] mx-auto p-3 pb-24 lg:p-4 select-none">
    <header class="bg-white rounded-2xl px-4 py-3 border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 mb-3">
      <div class="flex items-center gap-3">
        <router-link :to="`/child/${childId}/today`" class="hidden lg:flex px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-600" @click="playClick">← 今日任务</router-link>
        <h2 class="text-lg font-black text-slate-800">📅 课程表</h2>
      </div>
      <div class="flex items-center gap-2">
        <button type="button" class="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600" aria-label="上一周" @click="shiftWeek(-7)">‹</button>
        <div class="text-center min-w-[120px]">
          <div class="text-sm font-black text-slate-800">{{ shortDate(weekStart) }} – {{ shortDate(addDays(weekStart, 6)) }}</div>
          <div class="text-[11px] font-bold text-slate-400">
            {{ weekStart === mondayOf(today) ? '本周' : weekStart > today ? '以后' : '以前' }}{{ weekLabel ? ` · ${weekLabel}周` : '' }}
          </div>
        </div>
        <button type="button" class="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 font-black text-slate-600" aria-label="下一周" @click="shiftWeek(7)">›</button>
        <button v-if="weekStart !== mondayOf(today)" type="button" class="px-3 py-2 rounded-xl bg-brand-50 text-brand-600 text-xs font-bold" @click="shiftWeek(null)">回到本周</button>
      </div>
    </header>

    <div v-if="loading" class="text-center py-16 text-brand-500 font-bold"><span class="animate-spin mr-2">⏳</span> 正在加载课程表...</div>

    <template v-else>
      <!-- Phones and portrait tablets: one day at a time -->
      <div class="lg:hidden">
        <div class="flex gap-1.5 overflow-x-auto pb-2 -mx-3 px-3">
          <button
            v-for="day in days"
            :key="day.date"
            type="button"
            class="shrink-0 px-3 py-2 rounded-xl text-xs font-bold border"
            :class="selectedDate === day.date ? 'bg-brand-500 border-brand-500 text-white' : day.date === today ? 'bg-brand-50 border-brand-200 text-brand-600' : 'bg-white border-slate-200 text-slate-600'"
            @click="selectedDate = day.date"
          >
            {{ WEEKDAY_NAMES[day.weekday] }}<span class="block text-[10px] opacity-70">{{ shortDate(day.date) }}</span>
          </button>
        </div>
        <div v-if="selectedDay" class="bg-white rounded-2xl p-3 border border-slate-200">
          <DaySchedule :day="selectedDay" />
        </div>
      </div>

      <!-- iPad landscape: the whole week; weekends only when something is on -->
      <div class="hidden lg:grid gap-3" :style="{ gridTemplateColumns: `repeat(${shownDays.length}, minmax(0, 1fr))` }">
        <div
          v-for="day in shownDays"
          :key="day.date"
          class="bg-white rounded-2xl p-2.5 border min-h-[200px]"
          :class="day.date === today ? 'border-brand-300 shadow-card' : 'border-slate-200'"
        >
          <div class="flex items-baseline justify-between px-1 mb-2">
            <span class="text-sm font-black" :class="day.date === today ? 'text-brand-600' : 'text-slate-700'">{{ WEEKDAY_NAMES[day.weekday] }}</span>
            <span class="text-[11px] font-bold text-slate-400">{{ day.date === today ? '今天' : shortDate(day.date) }}</span>
          </div>
          <DaySchedule :day="day" compact />
        </div>
      </div>

      <p v-if="!hasAnything" class="mt-4 text-center text-sm font-bold text-slate-400">这一周还没有课程表，请家长在“家长后台 → 课程表”里添加。</p>
    </template>

    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import DaySchedule from '../components/DaySchedule.vue';
import ChildTabBar from '../components/ChildTabBar.vue';
import { playClick } from '../utils/sound';
import { WEEKDAY_NAMES, addDays, localDate, mondayOf, shortDate } from '../utils/schedule.js';

const route = useRoute();
const childId = computed(() => route.params.id);
const today = localDate();
const weekStart = ref(mondayOf(today));
const days = ref([]);
const selectedDate = ref(today);
const loading = ref(true);

const selectedDay = computed(() => days.value.find(day => day.date === selectedDate.value) || days.value[0]);
const hasContent = day => day.school.length || day.outside.length || day.holiday;
const shownDays = computed(() => days.value.filter(day => ![0, 6].includes(day.weekday) || hasContent(day)));
const hasAnything = computed(() => days.value.some(hasContent));
const weekLabel = computed(() => days.value.find(day => day.week)?.week ?? null);

async function load() {
  loading.value = true;
  try {
    days.value = await api.getChildSchedule(childId.value, weekStart.value, addDays(weekStart.value, 6));
    if (!days.value.some(day => day.date === selectedDate.value)) selectedDate.value = weekStart.value;
  } catch (err) {
    console.error('Failed to load the timetable:', err);
  } finally {
    loading.value = false;
  }
}

function shiftWeek(days) {
  playClick();
  weekStart.value = days === null ? mondayOf(today) : addDays(weekStart.value, days);
  selectedDate.value = days === null ? today : weekStart.value;
  load();
}

onMounted(load);
</script>
