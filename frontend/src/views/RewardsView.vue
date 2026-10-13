<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col justify-between p-6 select-none">
    <div class="max-w-5xl w-full mx-auto">
      <!-- Header -->
      <header class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="w-12 h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-xl text-slate-600 hover:border-brand-300 shadow-sm active:scale-95 transition-all"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <span>🏆</span>
              <span>积分与荣耀徽章</span>
            </h1>
            <p class="text-xs font-bold text-slate-400">
              每一次坚持都在闪闪发光
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <SoundToggle />
          <router-link
            :to="`/child/${childId}/characters`"
            @click="playClick"
            class="px-3.5 py-2 rounded-xl bg-brand-50 border border-brand-200 text-brand-700 font-bold text-xs shadow-xs hover:bg-brand-100 active:scale-95 transition-all flex items-center gap-1.5"
          >
            <span>📖</span>
            <span>生字本</span>
          </router-link>
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button hover:bg-brand-600 active:scale-95 transition-all"
          >
            返回今日看板
          </router-link>
        </div>
      </header>

      <!-- Top Summary Stats Cards -->
      <div class="grid grid-cols-3 gap-4 mb-6">
        <!-- Points Card -->
        <div class="bg-gradient-to-tr from-amber-400 to-amber-300 rounded-3xl p-5 text-amber-950 shadow-md shadow-amber-200/50 flex items-center justify-between">
          <div>
            <span class="text-xs font-black uppercase tracking-wider text-amber-900/70">当前积分余额</span>
            <div class="text-3xl font-black mt-1">
              {{ totalPoints }} <span class="text-base font-bold">分</span>
            </div>
          </div>
          <span class="text-4xl">💰</span>
        </div>

        <!-- Streak Card -->
        <div class="bg-gradient-to-tr from-rose-400 to-amber-400 rounded-3xl p-5 text-white shadow-md shadow-rose-200/50 flex items-center justify-between">
          <div>
            <span class="text-xs font-black uppercase tracking-wider text-rose-100">连续坚持</span>
            <div class="text-3xl font-black mt-1">
              {{ streakDays }} <span class="text-base font-bold">天</span>
            </div>
          </div>
          <span class="text-4xl animate-bounce">🔥</span>
        </div>

        <!-- Badges Count Card -->
        <div class="bg-gradient-to-tr from-brand-500 to-indigo-400 rounded-3xl p-5 text-white shadow-md shadow-brand-200/50 flex items-center justify-between">
          <div>
            <span class="text-xs font-black uppercase tracking-wider text-brand-100">已解锁成就</span>
            <div class="text-3xl font-black mt-1">
              {{ unlockedCount }} / {{ allBadges.length }} <span class="text-base font-bold">个</span>
            </div>
          </div>
          <span class="text-4xl">🏅</span>
        </div>
      </div>

      <!-- Main Section: Badge Wall & Points Log Tabs or 2-column layout -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left 2 Cols: Badge Wall -->
        <div class="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2">
              <span>🎖️</span>
              <span>徽章荣誉墙</span>
            </h2>
            <span class="text-xs text-slate-400 font-bold">
              已点亮 {{ unlockedCount }} 个
            </span>
          </div>

          <BadgeWall :badges="allBadges" />
        </div>

        <!-- Right 1 Col: Points History Stream -->
        <div class="lg:col-span-1">
          <PointsLog :logs="pointLogs" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import BadgeWall from '../components/BadgeWall.vue';
import PointsLog from '../components/PointsLog.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick } from '../utils/sound';

const route = useRoute();
const childStore = useChildStore();

const childId = computed(() => route.params.id || childStore.childId);
const totalPoints = computed(() => childStore.stats.total_points || 0);
const streakDays = computed(() => childStore.stats.current_streak || 5);

const allBadges = ref([]);
const pointLogs = ref([]);

const unlockedCount = computed(() => allBadges.value.filter(b => b.is_unlocked).length);

onMounted(async () => {
  await loadData();
});

async function loadData() {
  try {
    await childStore.fetchStats();

    const [definitions, childBadges, logs] = await Promise.all([
      api.getBadgeDefinitions(),
      api.getChildBadges(childId.value),
      api.getPointLogs(childId.value)
    ]);

    const unlockedMap = new Map();
    for (const b of childBadges) {
      unlockedMap.set(b.badge_id || b.key, b);
    }

    allBadges.value = definitions.map(def => {
      const unlockedInfo = unlockedMap.get(def.id) || unlockedMap.get(def.key);
      return {
        ...def,
        is_unlocked: Boolean(unlockedInfo),
        unlocked_at: unlockedInfo ? unlockedInfo.unlocked_at : null
      };
    });

    pointLogs.value = logs || [];
  } catch (err) {
    console.error('Failed to load rewards data:', err);
  }
}
</script>
