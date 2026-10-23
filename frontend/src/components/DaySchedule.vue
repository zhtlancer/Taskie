<template>
  <!-- One day: school lessons with the breaks between them, then outside classes with time and place -->
  <div class="space-y-1.5 font-chinese">
    <p v-if="day.holiday" class="px-3 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-xs font-bold">🏖️ {{ day.holiday }}，不上学</p>
    <p v-if="day.makeup" class="px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold">🔁 调休上学 · 按{{ WEEKDAY_NAMES[day.makeup.acts_as] }}课表{{ day.makeup.note ? `（${day.makeup.note}）` : '' }}</p>

    <template v-for="item in day.school" :key="item.id">
      <div v-if="item.kind === 'break'" class="flex items-center gap-2 px-2 text-xs font-bold text-slate-400">
        <span class="tabular-nums">{{ item.start_time }}</span>
        <span class="flex-1 border-t border-dashed border-slate-200 dark:border-slate-700"></span>
        <span>{{ item.label }}</span>
      </div>
      <div v-else class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
        <div class="shrink-0 w-12 text-xs font-bold text-slate-400 tabular-nums leading-tight">
          <div>{{ item.start_time }}</div>
          <div v-if="!compact">{{ item.end_time }}</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{{ item.subject }}</span>
            <span v-if="item.week !== 'all'" class="px-1 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 text-xs font-black">{{ item.week }}周</span>
          </div>
          <div v-if="!compact && (item.teacher || item.room)" class="text-xs font-bold text-slate-400 truncate">
            {{ [item.teacher, item.room].filter(Boolean).join(' · ') }}
          </div>
        </div>
        <span v-if="!compact" class="shrink-0 text-xs font-bold text-slate-400">{{ item.label }}</span>
      </div>
    </template>

    <div
      v-for="lesson in day.outside"
      :key="`${lesson.class_id}-${lesson.class_lesson_date}-${lesson.status}`"
      :data-class-id="lesson.class_id"
      :data-schedule-date="day.date"
      :data-source-date="lesson.source_date || lesson.class_lesson_date"
      class="px-3 py-2 rounded-xl border"
      :class="lessonHappens(lesson) ? 'bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-70'"
    >
      <!-- Narrow week columns put the time on its own line so the class name fits -->
      <div class="flex gap-x-2" :class="compact ? 'flex-col' : 'items-center'">
        <span class="text-xs font-black tabular-nums" :class="lessonHappens(lesson) ? 'text-violet-600 dark:text-violet-300' : 'text-slate-400 line-through'">
          {{ timeRange(lesson.start_time, lesson.end_time) }}
        </span>
        <span class="text-sm font-black truncate" :class="lessonHappens(lesson) ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 line-through'">🎨 {{ lesson.title }}</span>
      </div>
      <div v-if="lesson.location || lesson.institution" class="mt-0.5 text-xs font-bold text-slate-500 dark:text-slate-400 truncate">
        📍 {{ [lesson.institution, lesson.location].filter(Boolean).join(' · ') }}
      </div>
      <div v-if="lesson.lesson_number" class="mt-0.5 text-xs font-bold text-violet-600 dark:text-violet-300">第 {{ lesson.lesson_number }} / {{ lesson.total_lessons }} 次</div>
      <div v-if="!compact && lesson.teacher" class="text-xs font-bold text-slate-400">{{ lesson.teacher }}</div>
      <div v-if="lessonNote(lesson)" class="mt-0.5 text-xs font-black" :class="lesson.status === 'moved_in' ? 'text-violet-600 dark:text-violet-300' : 'text-amber-600 dark:text-amber-300'">
        {{ lessonNote(lesson) }}
      </div>
      <slot name="outside" :lesson="lesson" :date="day.date" />
    </div>

    <p v-if="!day.holiday && !day.school.length && !day.outside.length" class="px-2 py-3 text-xs font-bold text-slate-400">没有课</p>
  </div>
</template>

<script setup>
import { WEEKDAY_NAMES, lessonHappens, lessonNote, timeRange } from '../utils/schedule.js';

defineProps({
  day: { type: Object, required: true },
  // Narrow week columns leave out end times, teachers and rooms.
  compact: { type: Boolean, default: false }
});
</script>
