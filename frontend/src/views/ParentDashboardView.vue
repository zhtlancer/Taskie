<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-6 flex-1">
      <!-- Title Bar -->
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <span>📊</span>
            <span>今日作业完成概览</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            实时查看所有孩子的打卡与任务进展
          </p>
        </div>

        <router-link
          to="/parent/tasks"
          class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button active:scale-95 transition-all"
        >
          📝 管理任务模板
        </router-link>
      </div>

      <!-- Quick Summary Cards -->
      <div class="grid grid-cols-3 gap-4 mb-8">
        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">已注册小朋友</span>
            <div class="text-3xl font-black text-slate-800 mt-1">
              {{ childrenStats.length }} <span class="text-sm font-bold text-slate-500">位</span>
            </div>
          </div>
          <span class="text-4xl">👶</span>
        </div>

        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">今日总任务完成率</span>
            <div class="text-3xl font-black text-emerald-600 mt-1">
              {{ overallCompletionRate }}%
            </div>
          </div>
          <span class="text-4xl">🎯</span>
        </div>

        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">全员累计发放积分</span>
            <div class="text-3xl font-black text-amber-500 mt-1">
              {{ totalPointsIssued }} <span class="text-sm font-bold text-slate-500">分</span>
            </div>
          </div>
          <span class="text-4xl">🪙</span>
        </div>
      </div>

      <!-- Children Detail Progress Grid -->
      <h3 class="text-base font-bold text-slate-700 mb-3 px-1">
        各个小朋友实时看板
      </h3>

      <div v-if="loading" class="text-center py-16 text-brand-500 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在统计今日作业进展...
      </div>

      <div v-else-if="childrenStats.length === 0" class="text-center py-16 bg-white rounded-3xl border border-slate-200">
        <div class="text-5xl mb-2">👶</div>
        <p class="text-slate-500 text-sm mb-4">还没有添加小朋友账号哦</p>
        <router-link
          to="/parent/children"
          class="px-5 py-2.5 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button"
        >
          立即添加小朋友
        </router-link>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          v-for="item in childrenStats"
          :key="item.child.id"
          class="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all"
        >
          <!-- Top Row: Avatar, Name, Link -->
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center text-3xl shadow-inner">
                {{ item.child.avatar_emoji || '🐱' }}
              </div>
              <div>
                <h4 class="text-xl font-bold text-slate-800">{{ item.child.name }}</h4>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-xs text-amber-600 font-extrabold flex items-center gap-0.5">
                    <span>🔥</span>
                    <span>连续 {{ item.stats.current_streak || 0 }} 天</span>
                  </span>
                  <span class="text-slate-300">·</span>
                  <span class="text-xs text-slate-500 font-bold">
                    今日积分 +{{ item.stats.today_points || 0 }}
                  </span>
                </div>
              </div>
            </div>

            <router-link
              :to="`/child/${item.child.id}/today`"
              class="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-600 text-xs font-bold transition-all"
            >
              进入看板 →
            </router-link>
          </div>

          <!-- Progress Bar & Count -->
          <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-4">
            <div class="flex items-center justify-between text-xs font-bold mb-1.5">
              <span class="text-slate-500">今日完成情况</span>
              <span class="text-slate-800">
                完成 {{ item.stats.today_completed_tasks || 0 }} / {{ item.stats.today_total_tasks || 0 }} 项
                ({{ Math.round((item.stats.today_completion_rate || 0) * 100) }}%)
              </span>
            </div>

            <div class="w-full bg-slate-200 h-3 rounded-full overflow-hidden p-0.5">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="item.stats.today_completion_rate >= 1 ? 'bg-emerald-500' : 'bg-brand-500'"
                :style="{ width: `${Math.round((item.stats.today_completion_rate || 0) * 100)}%` }"
              ></div>
            </div>
          </div>

          <!-- Quick Stats Summary -->
          <div class="grid grid-cols-2 gap-3 text-center text-xs">
            <div class="p-2.5 rounded-xl bg-amber-50/60 border border-amber-100">
              <span class="text-slate-400 font-semibold block text-[11px]">累计总积分</span>
              <span class="text-base font-black text-amber-600">{{ item.stats.total_points || 0 }} 分</span>
            </div>
            <div class="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
              <span class="text-slate-400 font-semibold block text-[11px]">安全验证</span>
              <span class="text-base font-black text-brand-600">{{ item.child.has_pin ? '已设置 PIN' : '免密直登' }}</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';

const childrenStats = ref([]);
const loading = ref(true);

const overallCompletionRate = computed(() => {
  if (childrenStats.value.length === 0) return 0;
  let totalTasks = 0;
  let completedTasks = 0;
  for (const item of childrenStats.value) {
    totalTasks += (item.stats.today_total_tasks || 0);
    completedTasks += (item.stats.today_completed_tasks || 0);
  }
  if (totalTasks === 0) return 0;
  return Math.round((completedTasks / totalTasks) * 100);
});

const totalPointsIssued = computed(() => {
  return childrenStats.value.reduce((sum, item) => sum + (item.stats.total_points || 0), 0);
});

onMounted(async () => {
  try {
    const children = await api.getChildren();
    const statsPromises = children.map(async (child) => {
      const stats = await api.getChildStats(child.id);
      return { child, stats };
    });
    childrenStats.value = await Promise.all(statsPromises);
  } catch (err) {
    console.error('Failed to load parent dashboard:', err);
  } finally {
    loading.value = false;
  }
});
</script>
