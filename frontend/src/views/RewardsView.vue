<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col justify-between p-3 pb-24 sm:p-6 lg:pb-6 select-none">
    <div class="max-w-5xl w-full mx-auto">
      <!-- Header -->
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:flex w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 items-center justify-center text-xl text-slate-600 dark:text-slate-300 hover:border-brand-300 dark:hover:border-brand-700 shadow-sm active:scale-95 transition-all"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
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
            class="hidden lg:flex px-3.5 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 font-bold text-xs shadow-xs hover:bg-brand-100 dark:hover:bg-brand-900/40 active:scale-95 transition-all items-center gap-1.5"
          >
            <span>📖</span>
            <span>生字生词本</span>
          </router-link>
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:inline-flex px-4 py-2 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button hover:bg-brand-600 active:scale-95 transition-all"
          >
            返回今日看板
          </router-link>
        </div>
      </header>

      <!-- Top Summary Stats Cards -->
      <div class="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <!-- Points Card -->
        <div class="bg-gradient-to-tr from-amber-400 to-amber-300 dark:from-amber-400 dark:to-amber-300 rounded-2xl p-3 sm:p-5 text-amber-950 shadow-md shadow-amber-200/50 flex items-center justify-between min-w-0">
          <div>
            <span class="text-xs font-black uppercase tracking-wider text-amber-900/70">当前积分余额</span>
            <div class="text-xl sm:text-3xl font-black mt-1">
              {{ totalPoints }} <span class="text-xs sm:text-base font-bold">分</span>
            </div>
          </div>
          <span class="hidden sm:block text-4xl">💰</span>
        </div>

        <!-- Streak Card -->
        <div class="bg-gradient-to-tr from-rose-400 to-amber-400 rounded-2xl p-3 sm:p-5 text-white shadow-md shadow-rose-200/50 flex items-center justify-between min-w-0">
          <div>
            <span class="text-xs font-black uppercase tracking-wider text-rose-100">连续坚持</span>
            <div class="text-xl sm:text-3xl font-black mt-1">
              {{ streakDays }} <span class="text-xs sm:text-base font-bold">天</span>
            </div>
          </div>
          <span class="hidden sm:block text-4xl animate-bounce">🔥</span>
        </div>

        <!-- Badges Count Card -->
        <div class="bg-gradient-to-tr from-brand-500 to-indigo-400 rounded-2xl p-3 sm:p-5 text-white shadow-md shadow-brand-200/50 flex items-center justify-between min-w-0">
          <div>
            <span class="text-xs font-black uppercase tracking-wider text-brand-100">已解锁成就</span>
            <div class="text-xl sm:text-3xl font-black mt-1">
              {{ unlockedCount }} / {{ allBadges.length }} <span class="text-xs sm:text-base font-bold">个</span>
            </div>
          </div>
          <span class="hidden sm:block text-4xl">🏅</span>
        </div>
      </div>

      <!-- Rewards Shop -->
      <section class="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>🎁</span>
            <span>积分兑换商城</span>
          </h2>
          <span class="text-xs text-slate-400 font-bold">兑换后等爸爸妈妈确认哦</span>
        </div>

        <p v-if="shopError" class="mb-3 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ shopError }}</p>

        <div v-if="rewardItems.length === 0" class="text-center py-6 text-sm font-bold text-slate-400">
          爸爸妈妈还没有上架奖励，快去提醒他们吧～
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div
            v-for="item in rewardItems"
            :key="item.id"
            class="rounded-2xl border p-4 flex flex-col items-center text-center transition-all"
            :class="totalPoints >= item.cost ? 'border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/40' : 'border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60'"
          >
            <span class="text-4xl mb-2">{{ item.icon_emoji }}</span>
            <span class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese mb-1">{{ item.title }}</span>
            <span class="text-sm font-black text-amber-500 dark:text-amber-400 mb-3">★ {{ item.cost }} 分</span>
            <button
              v-if="totalPoints < item.cost"
              type="button"
              disabled
              class="w-full min-h-[48px] rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-bold"
            >
              还差 {{ item.cost - totalPoints }} 分
            </button>
            <button
              v-else-if="confirmingId === item.id"
              type="button"
              :disabled="redeeming"
              @click="redeem(item)"
              class="w-full min-h-[48px] rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-black shadow-button active:scale-95 transition-all disabled:opacity-50"
            >
              {{ redeeming ? '兑换中...' : '确定兑换？' }}
            </button>
            <button
              v-else
              type="button"
              @click="playClick(); confirmingId = item.id"
              class="w-full min-h-[48px] rounded-xl bg-amber-400 hover:bg-amber-500 text-amber-950 dark:text-amber-200 text-xs font-black shadow-sm active:scale-95 transition-all"
            >
              兑换
            </button>
          </div>
        </div>

        <!-- My Redemptions -->
        <div v-if="redemptions.length" class="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700">
          <h3 class="text-sm font-bold text-slate-600 dark:text-slate-300 mb-2">我的兑换记录</h3>
          <ul class="space-y-2">
            <li
              v-for="r in redemptions"
              :key="r.id"
              class="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800"
            >
              <span class="text-sm font-bold text-slate-700 dark:text-slate-200 font-chinese flex items-center gap-2 min-w-0">
                <span>{{ r.icon_emoji }}</span>
                <span class="truncate">{{ r.title }}</span>
                <span class="text-amber-500 dark:text-amber-400 font-black shrink-0">-{{ r.cost }}</span>
              </span>
              <span class="flex items-center gap-2 shrink-0">
                <span class="px-2 py-0.5 rounded-lg text-xs font-black" :class="statusInfo[r.status].class">
                  {{ statusInfo[r.status].label }}
                </span>
                <button
                  v-if="r.status === 'pending'"
                  type="button"
                  @click="cancel(r)"
                  class="min-h-[36px] px-2 text-xs font-bold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400"
                >
                  撤回
                </button>
              </span>
            </li>
          </ul>
        </div>
      </section>

      <!-- Main Section: Badge Wall & Points Log Tabs or 2-column layout -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left 2 Cols: Badge Wall -->
        <div class="lg:col-span-2 bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
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
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import ChildTabBar from '../components/ChildTabBar.vue';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import BadgeWall from '../components/BadgeWall.vue';
import PointsLog from '../components/PointsLog.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick, playBadgeUnlocked } from '../utils/sound';
import { getPendingRedemptions } from '../api/redemptions';

const route = useRoute();
const childStore = useChildStore();

const childId = computed(() => route.params.id || childStore.childId);
// Spendable balance: points held by pending or approved redemptions are excluded.
const totalPoints = computed(() => childStore.stats.available_points ?? 0);
const streakDays = computed(() => childStore.stats.current_streak ?? 0);

const allBadges = ref([]);
const pointLogs = ref([]);
const rewardItems = ref([]);
const redemptions = ref([]);
const confirmingId = ref(null);
const redeeming = ref(false);
const shopError = ref('');

const statusInfo = {
  pending: { label: '等待确认', class: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  approved: { label: '已兑换', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  rejected: { label: '未通过', class: 'bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300' },
  cancelled: { label: '已撤回', class: 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400' }
};

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
    await loadShop();
  } catch (err) {
    console.error('Failed to load rewards data:', err);
  }
}

async function loadShop() {
  const [items, pending, history] = await Promise.all([
    api.getRewardItems(),
    getPendingRedemptions(params => api.getChildRedemptions(childId.value, params)),
    api.getChildRedemptions(childId.value, { status: 'history', limit: 8 })
  ]);
  rewardItems.value = items;
  redemptions.value = [...pending, ...history];
}

const refreshConfirmed = () => refreshAfterShopChange().catch(err => { shopError.value = String(err); });
onMounted(() => window.addEventListener('taskie:write-confirmed', refreshConfirmed));
onBeforeUnmount(() => window.removeEventListener('taskie:write-confirmed', refreshConfirmed));
async function refreshAfterShopChange() {
  confirmingId.value = null;
  await Promise.all([childStore.fetchStats(), loadShop()]);
}

async function redeem(item) {
  redeeming.value = true;
  shopError.value = '';
  try {
    await api.requestRedemption(childId.value, item.id, item.title, childStore.childName);
    playBadgeUnlocked();
  } catch (err) {
    shopError.value = typeof err === 'string' ? err : '兑换失败，请重试';
  } finally {
    redeeming.value = false;
    await refreshAfterShopChange();
  }
}

async function cancel(redemption) {
  playClick();
  shopError.value = '';
  try {
    await api.cancelRedemption(redemption.id);
  } catch (err) {
    shopError.value = typeof err === 'string' ? err : '撤回失败，请重试';
  } finally {
    await refreshAfterShopChange();
  }
}
</script>
