<template>
  <!-- Phone and portrait-tablet navigation for child pages; the iPad landscape layout keeps its own. -->
  <nav class="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
    <div class="max-w-xl mx-auto grid grid-cols-6">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="`/child/${childId}/${tab.path}`"
        class="flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] text-[11px] font-bold transition-colors"
        :class="$route.path.endsWith(`/${tab.path}`) ? 'text-brand-600' : 'text-slate-400'"
        @click="playClick"
      >
        <span class="text-xl leading-none">{{ tab.icon }}</span>
        <span>{{ tab.label }}</span>
      </router-link>
    </div>
  </nav>
</template>

<script setup>
import { playClick } from '../utils/sound';

defineProps({ childId: { type: String, required: true } });

const tabs = [
  { path: 'today', icon: '📋', label: '今日' },
  { path: 'rewards', icon: '🏆', label: '积分' },
  { path: 'mistakes', icon: '📝', label: '错题' },
  { path: 'characters', icon: '📖', label: '字词' },
  { path: 'schedule', icon: '📅', label: '课表' },
  { path: 'history', icon: '📊', label: '历史' }
];
</script>
