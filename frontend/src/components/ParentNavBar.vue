<template>
  <header class="bg-white border-b border-slate-200/80 sticky top-0 z-40 shadow-sm">
    <!-- iPad landscape: one row. Phones: brand and icon actions, then a scrollable tab strip. -->
    <div class="max-w-6xl mx-auto px-4 lg:px-6 h-18 py-3 flex flex-wrap lg:flex-nowrap items-center justify-between gap-y-2.5">
      <!-- Left: Logo & Brand -->
      <div class="flex items-center gap-3 whitespace-nowrap">
        <div class="w-10 h-10 rounded-2xl bg-brand-500 text-white flex items-center justify-center text-xl shadow-button">
          ⚙️
        </div>
        <div>
          <h1 class="text-base sm:text-lg font-black text-slate-800 tracking-tight leading-tight">
            家长管理工作台
          </h1>
          <p class="hidden sm:block text-[11px] font-bold text-slate-400">小学生作业日常管理系统</p>
        </div>
      </div>

      <!-- Center: Nav Tabs -->
      <nav class="order-last w-full lg:order-none lg:w-auto flex items-center gap-1 sm:gap-2 bg-slate-100 p-1.5 rounded-2xl overflow-x-auto whitespace-nowrap">
        <router-link
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="shrink-0 flex-1 lg:flex-none text-center px-2 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all"
          :class="tab.paths.includes($route.path) ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
        >
          {{ tab.label }}
        </router-link>
      </nav>

      <!-- Right: Settings, sign out, sound and back to the child side (icons only on phones) -->
      <div class="flex items-center gap-2 sm:gap-3 whitespace-nowrap">
        <router-link to="/parent/settings" class="text-sm font-bold text-brand-600" title="备份与设置">
          <span class="sm:hidden text-lg">🛠️</span>
          <span class="hidden sm:inline">备份与设置</span>
        </router-link>
        <button @click="exitParent" class="text-sm font-bold text-slate-600">退出<span class="hidden sm:inline">家长</span></button>
        <SoundToggle />
        <router-link
          to="/"
          @click="exitParent"
          class="px-3 sm:px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-all flex items-center gap-1.5 active:scale-95"
          title="返回孩子看板"
        >
          <span>🏠</span>
          <span class="hidden sm:inline">返回孩子看板</span>
        </router-link>
      </div>
    </div>
  </header>
</template>

<script setup>
import SoundToggle from './SoundToggle.vue';
import { useParentStore } from '../stores/parent';
import { useRouter } from 'vue-router';
const parent = useParentStore(), router = useRouter();
function exitParent() { parent.logout(); router.push('/'); }

const tabs = [
  { to: '/parent/dashboard', label: '📊 数据总览', paths: ['/parent/dashboard'] },
  { to: '/parent/children', label: '👶 孩子账号', paths: ['/parent/children'] },
  { to: '/parent/tasks', label: '📝 任务模板', paths: ['/parent/tasks', '/parent/periods'] },
  { to: '/parent/schedule', label: '📅 课程表', paths: ['/parent/schedule'] },
  { to: '/parent/rewards', label: '🎁 奖励兑换', paths: ['/parent/rewards'] }
];
</script>
