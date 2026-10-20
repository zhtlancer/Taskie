<template>
  <header class="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40">
    <div class="max-w-6xl mx-auto px-4 py-2.5 space-y-2 lg:space-y-0 lg:flex lg:items-center lg:gap-4">
      <div class="flex items-center justify-between gap-2 lg:contents">
        <router-link to="/parent/dashboard" class="text-base font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">🎒 家长工作台</router-link>
        <button type="button" class="lg:order-last min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold whitespace-nowrap" aria-label="打开家长设置菜单" :aria-expanded="menuOpen" @click="menuOpen = true">设置 · ⋯</button>
      </div>
      <nav class="grid grid-cols-5 gap-1 lg:flex-1" aria-label="家长导航">
        <router-link v-for="tab in tabs" :key="tab.to" :to="tab.to" class="flex items-center justify-center rounded-xl min-h-[44px] px-1 lg:px-3 text-xs lg:text-sm font-bold whitespace-nowrap" :class="isActive(tab) ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'" :aria-current="isActive(tab) ? 'page' : undefined">{{ tab.label }}</router-link>
      </nav>
    </div>
  </header>
  <UiDialog v-if="menuOpen" title="家长设置" @close="menuOpen = false">
    <div class="space-y-4">
      <ThemeSelect />
      <div class="flex items-center justify-between border-y border-slate-100 dark:border-slate-700 py-3"><span class="text-sm text-slate-600 dark:text-slate-300">操作音效</span><SoundToggle /></div>
      <router-link to="/parent/settings" class="block min-h-[44px] rounded-xl bg-slate-50 dark:bg-slate-800 p-3 text-sm font-bold text-slate-700 dark:text-slate-200" @click="menuOpen = false">备份与设置</router-link>
      <button type="button" class="w-full text-left min-h-[44px] rounded-xl p-3 text-sm text-slate-500 dark:text-slate-400" @click="exitParent">退出家长，返回孩子选择</button>
    </div>
  </UiDialog>
</template>
<script setup>
import { ref, watch } from 'vue';
import SoundToggle from './SoundToggle.vue';
import ThemeSelect from './ThemeSelect.vue';
import UiDialog from './UiDialog.vue';
import { useParentStore } from '../stores/parent';
import { useRouter, useRoute } from 'vue-router';
const parent = useParentStore(), router = useRouter(), route = useRoute(), menuOpen = ref(false);
function exitParent() { menuOpen.value = false; parent.logout(); router.push('/'); }
watch(() => route.fullPath, () => { menuOpen.value = false; });
const isActive = tab => tab.paths.some(path => path.endsWith('/') ? route.path.startsWith(path) : route.path === path);
const tabs = [
  {to:'/parent/dashboard',label:'总览',paths:['/parent/dashboard','/parent/time-stats','/parent/children/']},
  {to:'/parent/children',label:'孩子',paths:['/parent/children']},
  {to:'/parent/tasks',label:'任务',paths:['/parent/tasks','/parent/periods']},
  {to:'/parent/schedule',label:'课表',paths:['/parent/schedule']},
  {to:'/parent/rewards',label:'奖励',paths:['/parent/rewards']}
];
</script>
