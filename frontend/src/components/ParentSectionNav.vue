<template>
  <nav class="flex flex-wrap gap-2 mb-5" :aria-label="labels[section]">
    <router-link v-for="item in parentSections[section]" :key="item.to" :to="{ path: item.to, query: childId ? { child: childId } : {} }"
      class="inline-flex items-center justify-center min-h-11 px-3 sm:px-4 rounded-xl text-sm font-bold border"
      :class="route.path === item.to ? 'bg-brand-50 dark:bg-brand-900/40 border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
      :aria-current="route.path === item.to ? 'page' : undefined">{{ item.label }}</router-link>
  </nav>
</template>
<script setup>
import { useRoute } from 'vue-router';
import { parentSections } from '../utils/parentNavigation.js';
defineProps({ section: { type: String, required: true }, childId: { type: String, default: '' } });
const route = useRoute();
const labels = { learning: '学习安排分类', calendar: '课程日历分类', management: '管理分类' };
</script>
