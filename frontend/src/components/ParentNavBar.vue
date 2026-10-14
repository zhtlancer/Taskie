<template>
  <header class="bg-white border-b border-slate-200/80 sticky top-0 z-40 shadow-sm">
    <div class="max-w-6xl mx-auto px-6 h-18 py-3 flex items-center justify-between">
      <!-- Left: Logo & Brand -->
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl bg-brand-500 text-white flex items-center justify-center text-xl shadow-button">
          ⚙️
        </div>
        <div>
          <h1 class="text-lg font-black text-slate-800 tracking-tight leading-tight">
            家长管理工作台
          </h1>
          <p class="text-[11px] font-bold text-slate-400">小学生作业日常管理系统</p>
        </div>
      </div>

      <!-- Center: Nav Tabs -->
      <nav class="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
        <router-link
          to="/parent/dashboard"
          class="px-4 py-2 rounded-xl text-sm font-bold transition-all"
          :class="$route.path === '/parent/dashboard' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
        >
          📊 数据总览
        </router-link>
        <router-link
          to="/parent/children"
          class="px-4 py-2 rounded-xl text-sm font-bold transition-all"
          :class="$route.path === '/parent/children' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
        >
          👶 孩子账号
        </router-link>
        <router-link
          to="/parent/tasks"
          class="px-4 py-2 rounded-xl text-sm font-bold transition-all"
          :class="['/parent/tasks', '/parent/periods'].includes($route.path) ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
        >
          📝 任务模板
        </router-link>
        <router-link
          to="/parent/rewards"
          class="px-4 py-2 rounded-xl text-sm font-bold transition-all"
          :class="$route.path === '/parent/rewards' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'"
        >
          🎁 奖励兑换
        </router-link>
      </nav>

      <!-- Right: Sound Toggle & Return to Child Side button -->
      <div class="flex items-center gap-3">
        <router-link to="/parent/settings" class="text-sm font-bold text-brand-600">备份与设置</router-link>
        <button @click="exitParent" class="text-sm font-bold text-slate-600">退出家长</button>
        <SoundToggle />
        <router-link
          to="/"
          @click="exitParent"
          class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold transition-all flex items-center gap-1.5 active:scale-95"
        >
          <span>🏠</span>
          <span>返回孩子看板</span>
        </router-link>
      </div>
    </div>
  </header>
</template>

<script setup>
import SoundToggle from './SoundToggle.vue';
import { playClick } from '../utils/sound';
import { useParentStore } from '../stores/parent';
import { useRouter } from 'vue-router';
const parent = useParentStore(), router = useRouter();
function exitParent() { parent.logout(); router.push('/'); }
</script>
