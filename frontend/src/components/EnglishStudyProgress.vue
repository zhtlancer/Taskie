<template>
  <div class="space-y-2" data-english-study-progress aria-label="认读与默写进度">
    <div v-for="skill in ENGLISH_STUDY_SKILLS" :key="skill.key" :data-study-skill="skill.key"
      class="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 px-3 py-2 space-y-1 min-w-0 [overflow-wrap:anywhere]">
      <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span class="text-xs font-bold text-slate-700 dark:text-slate-200">{{ skill.label }} ·
          <span :class="progress(skill.key).status === 'due' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'">{{ progress(skill.key).label }}</span>
        </span>
        <router-link v-if="!disabled" :to="englishStudyLink(word.child_id, skill.key)"
          @click.stop @keydown.stop
          class="inline-flex items-center min-h-11 min-w-11 text-xs font-bold text-brand-700 dark:text-brand-300"
          :aria-label="`前往${skill.label}练习`">{{ skill.label }}练习 →</router-link>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">最近学习：{{ progress(skill.key).last_review_date || '—' }}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">下次复习：{{ progress(skill.key).next_due_date || '—' }}</p>
    </div>
  </div>
</template>

<script setup>
import { ENGLISH_STUDY_SKILLS, englishProgress, englishStudyLink } from '../utils/englishProgress';
const props = defineProps({ word: { type: Object, required: true }, disabled: Boolean });
const progress = skill => englishProgress(props.word, skill);
</script>
