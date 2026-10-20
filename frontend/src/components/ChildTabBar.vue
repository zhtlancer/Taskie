<template>
  <aside class="hidden lg:flex fixed left-0 top-0 bottom-0 w-52 z-30 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-5 flex-col gap-5 overflow-y-auto" aria-label="学习导航">
    <router-link :to="link('today')" class="px-3 py-2 text-lg font-black text-brand-700 dark:text-brand-300">🎒 学习空间</router-link>
    <nav class="space-y-1">
      <router-link v-for="tab in allTabs" :key="tab.path" :to="link(tab.path)" class="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold min-h-[44px]" :class="active(tab.path) ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'" :aria-current="active(tab.path) ? 'page' : undefined">{{ tab.icon }} {{ tab.label }}</router-link>
    </nav>
    <div class="mt-auto space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
      <ThemeSelect />
      <router-link to="/" class="block min-h-[44px] px-3 py-3 text-sm text-slate-500 dark:text-slate-400">切换小朋友</router-link>
    </div>
  </aside>
  <nav class="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 pb-[env(safe-area-inset-bottom)]" aria-label="学生导航">
    <div class="max-w-xl mx-auto grid grid-cols-5">
      <router-link v-for="tab in primaryTabs" :key="tab.path" :to="link(tab.path)" class="flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-xs font-bold" :class="active(tab.path) ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'" :aria-current="active(tab.path) ? 'page' : undefined" @click="playClick">
        <span class="text-xl leading-none">{{ tab.icon }}</span><span>{{ tab.label }}</span>
      </router-link>
      <button type="button" class="flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-xs font-bold" :class="secondaryActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400'" aria-label="更多学习功能" :aria-expanded="moreOpen" @click="moreOpen = true"><span class="text-xl leading-none">⋯</span><span>更多</span></button>
    </div>
  </nav>
  <UiDialog v-if="moreOpen" title="更多学习功能" @close="moreOpen = false">
    <nav class="grid grid-cols-2 gap-2 mb-5" aria-label="更多学习功能">
      <router-link v-for="tab in secondaryTabs" :key="tab.path" :to="link(tab.path)" class="min-h-[56px] rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-sm font-bold text-slate-700 dark:text-slate-200" @click="moreOpen = false">{{ tab.icon }} {{ tab.label }}</router-link>
    </nav>
    <ThemeSelect />
    <router-link to="/" class="block mt-4 min-h-[44px] rounded-xl py-3 text-center text-sm text-slate-500 dark:text-slate-400" @click="moreOpen = false">切换小朋友</router-link>
  </UiDialog>
</template>
<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { playClick } from '../utils/sound';
import ThemeSelect from './ThemeSelect.vue';
import UiDialog from './UiDialog.vue';
const props = defineProps({ childId: { type: String, required: true } });
const route = useRoute(), moreOpen = ref(false);
const primaryTabs = [{path:'today',icon:'📋',label:'今日'}, {path:'homework',icon:'📒',label:'作业'}, {path:'word-study',icon:'📚',label:'学习'}, {path:'rewards',icon:'🏆',label:'积分'}];
const secondaryTabs = [{path:'characters',icon:'📖',label:'字词本'}, {path:'mistakes',icon:'📝',label:'错题本'}, {path:'schedule',icon:'📅',label:'课表'}, {path:'history',icon:'📊',label:'历史'}];
const allTabs = [...primaryTabs, ...secondaryTabs];
const link = path => `/child/${props.childId}/${path}`;
const active = path => route.path === link(path);
const secondaryActive = computed(() => secondaryTabs.some(tab => active(tab.path)));
watch(() => route.fullPath, () => { moreOpen.value = false; });
</script>
