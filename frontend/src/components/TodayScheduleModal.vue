<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="$emit('close')">
    <div class="bg-white rounded-3xl p-5 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border-2 border-violet-100 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xl font-black text-slate-800 font-chinese">
          📅 今天的课
          <span v-if="today.week" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-xs align-middle">{{ today.week }}周</span>
        </h3>
        <button type="button" class="w-9 h-9 rounded-xl text-slate-400 hover:bg-slate-100 text-lg" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>

      <!-- Outside classes first: when and where the child has to be -->
      <section v-if="today.outside.length">
        <h4 class="text-xs font-black text-violet-600 mb-1.5">🎨 课外班</h4>
        <DaySchedule :day="{ ...today, holiday: null, school: [] }" />
      </section>

      <section>
        <h4 class="text-xs font-black text-slate-500 mb-1.5">🏫 学校的课</h4>
        <DaySchedule :day="{ ...today, outside: [] }" />
      </section>

      <section v-if="tomorrow" class="rounded-2xl bg-amber-50 border border-amber-200 p-3">
        <h4 class="text-xs font-black text-amber-700 mb-1">🎒 明天（{{ WEEKDAY_NAMES[tomorrow.weekday] }}）要带</h4>
        <ul v-if="tomorrow.bring.length" class="space-y-0.5">
          <li v-for="item in tomorrow.bring" :key="item.for + item.items" class="text-sm font-bold text-slate-700 font-chinese">
            <span class="text-amber-600">{{ item.for }}：</span>{{ item.items }}
          </li>
        </ul>
        <p v-else class="text-xs font-bold text-slate-400">没有特别要带的东西</p>
      </section>

      <router-link :to="`/child/${childId}/schedule`" class="block text-center py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-sm font-bold text-slate-600" @click="$emit('close')">
        查看整周课程表 →
      </router-link>
    </div>
  </div>
</template>

<script setup>
import DaySchedule from './DaySchedule.vue';
import { WEEKDAY_NAMES } from '../utils/schedule.js';

defineProps({
  childId: { type: String, required: true },
  today: { type: Object, required: true },
  tomorrow: { type: Object, default: null }
});
defineEmits(['close']);
</script>
