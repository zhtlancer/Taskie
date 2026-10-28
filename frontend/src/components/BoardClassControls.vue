<template>
  <div class="mt-2 flex flex-wrap gap-1.5" aria-label="课程状态">
    <span v-for="label in boardClassStatus(lesson)" :key="label" class="rounded-lg px-2 py-1 text-xs font-bold bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300">{{ label }}</span>
  </div>
  <div v-if="actions.length" class="mt-2 flex flex-wrap gap-2" aria-label="家长课程操作">
    <button v-for="action in actions" :key="action" type="button" :disabled="disabled"
      class="min-h-11 min-w-11 px-3 rounded-xl text-sm font-bold bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-700 text-violet-700 dark:text-violet-200 disabled:opacity-40"
      @click="$emit('action', action)">{{ classActionLabels[action] }}</button>
  </div>
  <ClassHomeworkNotice :result="lesson.homework" :child-id="childId" :retained="lesson.attendance?.status !== 'attended'" :disabled="disabled" />
</template>
<script setup>
import { computed } from 'vue';
import ClassHomeworkNotice from './ClassHomeworkNotice.vue';
import { boardClassActions, boardClassStatus, classActionLabels } from '../utils/boardClassActions.js';
const props = defineProps({ lesson: Object, date: String, today: String, childId: { type: String, required: true }, asParent: Boolean, disabled: Boolean });
defineEmits(['action']);
const actions = computed(() => boardClassActions(props.lesson, props.date, props.today, props.asParent));
</script>
