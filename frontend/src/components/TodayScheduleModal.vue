<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="$emit('close')">
    <div class="bg-white dark:bg-slate-900 rounded-3xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border-2 border-violet-100 dark:border-violet-800 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 font-chinese">
          📅 今天的课
          <span v-if="today.week" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 text-xs align-middle">{{ today.week }}周</span>
        </h3>
        <button type="button" class="w-9 h-9 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 text-lg" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>

      <!-- Outside classes first: when and where the child has to be -->
      <section v-if="today.outside.length">
        <h4 class="text-xs font-black text-violet-600 dark:text-violet-300 mb-1.5">🎨 课外班</h4>
        <DaySchedule :day="{ ...today, holiday: null, school: [] }" />
      </section>

      <section>
        <h4 class="text-xs font-black text-slate-500 dark:text-slate-400 mb-1.5">🏫 学校的课</h4>
        <DaySchedule :day="{ ...today, outside: [] }" />
      </section>

      <section v-if="tomorrow" class="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
        <h3 class="text-base font-black text-slate-800 dark:text-slate-100 font-chinese">
          📅 明天的课
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">{{ shortDate(tomorrow.date) }} · {{ WEEKDAY_NAMES[tomorrow.weekday] }}</span>
          <span v-if="tomorrow.week" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 text-xs">{{ tomorrow.week }}周</span>
        </h3>

        <section>
          <h4 class="text-xs font-black text-violet-600 dark:text-violet-300 mb-1.5">🎨 明天的课外班</h4>
          <DaySchedule v-if="tomorrow.outside.length" :day="{ ...tomorrow, holiday: null, makeup: null, school: [] }" />
          <p v-else class="px-2 py-2 text-xs font-bold text-slate-400">明天没有课外班</p>
        </section>

        <section>
          <h4 class="text-xs font-black text-slate-500 dark:text-slate-400 mb-1.5">🏫 明天学校的课</h4>
          <DaySchedule :day="{ ...tomorrow, outside: [] }" />
        </section>

        <div class="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
          <h4 class="text-xs font-black text-amber-700 dark:text-amber-300 mb-1">🎒 明天要带</h4>
          <ul v-if="tomorrow.bring.length" class="space-y-0.5">
            <li v-for="item in tomorrow.bring" :key="item.for + item.items" class="text-sm font-bold text-slate-700 dark:text-slate-200 font-chinese">
              <span class="text-amber-600 dark:text-amber-300">{{ item.for }}：</span>{{ item.items }}
            </li>
          </ul>
          <p v-else class="text-xs font-bold text-slate-400">没有特别要带的东西</p>
        </div>
      </section>

      <router-link :to="`/child/${childId}/schedule`" class="block text-center py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300" @click="$emit('close')">
        查看整周课程表 →
      </router-link>
    </div>
  </div>
</template>

<script setup>
import DaySchedule from './DaySchedule.vue';
import { shortDate, WEEKDAY_NAMES } from '../utils/schedule.js';

defineProps({
  childId: { type: String, required: true },
  today: { type: Object, required: true },
  tomorrow: { type: Object, default: null }
});
defineEmits(['close']);
</script>
