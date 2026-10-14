<template>
  <div class="h-screen max-h-[820px] w-full max-w-[1180px] mx-auto flex flex-col justify-between p-4 select-none overflow-hidden">
    <!-- Top Header Bar -->
    <header class="h-16 shrink-0 bg-white rounded-2xl px-5 border border-slate-200 shadow-sm flex items-center justify-between">
      <!-- Left: Child Info & Date -->
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-brand-50 flex items-center justify-center text-2xl shadow-inner">
          {{ childAvatar }}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-black text-slate-800 leading-tight">{{ childName }}</h2>
            <span class="text-xs font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md">学生端</span>
          </div>
          <p class="text-xs font-semibold text-slate-400 leading-tight">{{ formattedDate }}</p>
        </div>
      </div>

      <!-- Center: Today Progress -->
      <div class="flex items-center gap-4 bg-slate-50 px-4 py-1.5 rounded-2xl border border-slate-100">
        <div class="flex flex-col text-right">
          <span class="text-xs font-bold text-slate-500">今日完成进度</span>
          <span class="text-sm font-black text-slate-800">
            完成 {{ completedCount }} / {{ totalCount }}
          </span>
        </div>

        <div class="w-28 bg-slate-200 h-3 rounded-full overflow-hidden p-0.5">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="completionRate >= 100 ? 'bg-emerald-500' : 'bg-brand-500'"
            :style="{ width: `${completionRate}%` }"
          ></div>
        </div>

        <ProgressRing
          :percentage="completionRate"
          :size="42"
          :stroke-width="5"
        />
      </div>

      <!-- Right: Sound toggle & Parent entrance button -->
      <div class="flex items-center gap-2.5">
        <button
          type="button"
          @click="openStrokeLookup"
          class="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-600 font-bold text-xs transition-all active:scale-95 shadow-xs"
          title="实时查笔画"
        >
          <span>🔍</span>
          <span>查笔画</span>
        </button>
        <SoundToggle />
        <router-link
          to="/parent/login"
          @click="playClick"
          class="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs transition-all active:scale-95"
        >
          <span>⚙️</span>
          <span>家长</span>
        </router-link>
      </div>
    </header>

    <!-- Main Layout (Two Columns) -->
    <div class="flex-1 flex gap-4 my-3 min-h-0 overflow-hidden">
      <!-- Left Sidebar: Subject filter nav + Streak + Points + Quick links -->
      <aside class="w-60 shrink-0 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between">
        <!-- Subjects Filter Navigation -->
        <div>
          <h3 class="text-xs font-black uppercase text-slate-400 tracking-wider mb-2 px-1">
            学科筛选
          </h3>
          <nav class="space-y-1.5">
            <button
              v-for="sub in subjects"
              :key="sub.name"
              type="button"
              @click="selectSubject(sub.name)"
              class="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-bold transition-all text-left"
              :class="[
                selectedSubject === sub.name
                  ? 'bg-brand-500 text-white shadow-button'
                  : 'text-slate-600 hover:bg-slate-100 active:scale-98'
              ]"
            >
              <div class="flex items-center gap-2">
                <span>{{ sub.icon }}</span>
                <span>{{ sub.name }}</span>
              </div>
              <span
                class="text-xs px-2 py-0.5 rounded-full"
                :class="selectedSubject === sub.name ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'"
              >
                {{ getSubjectTaskCount(sub.name) }}
              </span>
            </button>
          </nav>
        </div>

        <!-- Center Divider & Widgets -->
        <div class="space-y-3 pt-3 border-t border-slate-100">
          <!-- Streak Badge Widget -->
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/80">
            <StreakBadge :count="streakDays" ref="streakRef" />
          </div>

          <!-- Today Earned Points Widget -->
          <div class="flex items-center justify-between p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/80">
            <div class="flex items-center gap-2">
              <span class="text-2xl">💰</span>
              <div>
                <span class="text-[10px] font-black uppercase text-emerald-700">今日已得</span>
                <div class="text-base font-black text-emerald-600 leading-tight">
                  {{ todayPoints }} <span class="text-xs font-bold">分</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Child Page Navigation Links -->
        <div class="space-y-1 pt-3 border-t border-slate-100">
          <router-link
            :to="`/child/${childId}/rewards`"
            @click="playClick"
            class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-brand-50 hover:text-brand-600 transition-colors"
          >
            <span>🏆</span>
            <span>积分与徽章</span>
          </router-link>

          <router-link
            :to="`/child/${childId}/history`"
            @click="playClick"
            class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-brand-50 hover:text-brand-600 transition-colors"
          >
            <span>📊</span>
            <span>历史统计</span>
          </router-link>

          <router-link
            :to="`/child/${childId}/mistakes`"
            @click="playClick"
            class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-brand-50 hover:text-brand-600 transition-colors"
          >
            <span>📝</span>
            <span>错题本</span>
          </router-link>

          <router-link
            :to="`/child/${childId}/characters`"
            @click="playClick"
            class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-brand-50 hover:text-brand-600 transition-colors"
          >
            <span>📖</span>
            <span>生字本</span>
          </router-link>

          <router-link
            to="/"
            @click="playClick"
            class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
          >
            <span>🔄</span>
            <span>切换小朋友</span>
          </router-link>
        </div>
      </aside>

      <!-- Right Area: 2-Column Task Grid & Bottom Motivation Banner -->
      <main class="flex-1 bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-col justify-between overflow-hidden">
        <!-- Task Cards Grid (2 Columns, optimized for up to 8 tasks without scrolling on 1180x820) -->
        <div class="flex-1 overflow-y-auto pr-1">
          <!-- Loading state -->
          <div v-if="loading" class="flex justify-center items-center h-48 text-brand-500 font-bold">
            <span class="animate-spin mr-2">⏳</span> 正在加载今日任务...
          </div>

          <!-- Holiday tasks for the whole period -->
          <PeriodTasksPanel
            v-if="!loading && activePeriod"
            :period="activePeriod"
            :today="todayString"
            @changed="refreshPeriods"
          />

          <!-- Empty state -->
          <div
            v-if="!loading && filteredTasks.length === 0 && !activePeriod"
            class="flex flex-col items-center justify-center h-64 text-slate-400"
          >
            <span class="text-5xl mb-3">🏖️</span>
            <span class="text-base font-bold text-slate-600">当前分类下暂无任务</span>
            <span class="text-xs text-slate-400 mt-1">可以选择“全部”查看或在家长端添加任务</span>
          </div>

          <div
            v-if="!loading && activePeriod && filteredTasks.length === 0"
            class="text-center py-6 text-sm font-bold text-slate-400"
          >
            假期中，今天没有日常任务～
          </div>

          <!-- 2 Columns Grid -->
          <div v-if="!loading && filteredTasks.length > 0" class="grid grid-cols-2 gap-3.5">
            <TaskCard
              v-for="task in filteredTasks"
              :key="task.id"
              :task="task"
              @toggle="handleTaskToggle"
            />
          </div>
        </div>

        <!-- Bottom Motivation Banner (hidden on holiday days without daily tasks) -->
        <div v-if="totalCount > 0 || !activePeriod" class="mt-3 shrink-0">
          <!-- When all completed -->
          <div
            v-if="allDone"
            class="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 text-white flex items-center justify-between shadow-lg shadow-emerald-200 animate-pop-in"
          >
            <div class="flex items-center gap-3">
              <span class="text-2xl animate-bounce">🎉</span>
              <div>
                <h4 class="text-sm font-black tracking-wide">
                  太棒啦！今日作业任务已全部完成！
                </h4>
                <p class="text-xs text-emerald-100 font-medium">
                  {{ optionalPendingCount > 0 ? `还有 ${optionalPendingCount} 项本周弹性任务，可以多做多得分哦！` : '已获得全部任务积分，保持连续打卡哦！' }}
                </p>
              </div>
            </div>
            <button
              type="button"
              @click="handleRecelebrate"
              class="px-3.5 py-1.5 rounded-xl bg-white text-emerald-700 font-black text-xs hover:bg-emerald-50 active:scale-95 transition-all shadow-sm"
            >
              再撒一次花 🎉
            </button>
          </div>

          <!-- When in progress -->
          <div
            v-else
            class="p-3.5 rounded-2xl bg-gradient-to-r from-brand-50 via-indigo-50 to-amber-50 border border-brand-100 flex items-center justify-between"
          >
            <div class="flex items-center gap-2.5">
              <span class="text-xl">✨</span>
              <span class="text-sm font-bold text-slate-700">
                全部完成今天任务，即可冲击更高连胜纪录与荣耀徽章！
              </span>
            </div>
            <span class="text-xs font-black text-brand-600 bg-white px-3 py-1 rounded-xl shadow-xs">
              加油！还剩 {{ totalCount - completedCount }} 项
            </span>
          </div>
        </div>
      </main>
    </div>

    <!-- Stroke Lookup Modal -->
    <StrokeLookupModal
      v-model="isLookupModalOpen"
      :child-id="childId"
      initial-char="学"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import confetti from 'canvas-confetti';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import TaskCard from '../components/TaskCard.vue';
import ProgressRing from '../components/ProgressRing.vue';
import StreakBadge from '../components/StreakBadge.vue';
import SoundToggle from '../components/SoundToggle.vue';
import StrokeLookupModal from '../components/StrokeLookupModal.vue';
import PeriodTasksPanel from '../components/PeriodTasksPanel.vue';
import { playAllDone, playBadgeUnlocked, playClick } from '../utils/sound';

const route = useRoute();
const childStore = useChildStore();
const isLookupModalOpen = ref(false);

function openStrokeLookup() {
  playClick();
  isLookupModalOpen.value = true;
}

const childId = computed(() => route.params.id || childStore.childId);
const childName = computed(() => childStore.childName);
const childAvatar = computed(() => childStore.childAvatar);

const tasks = ref([]);
const loading = ref(true);
const periods = ref([]);
const activePeriod = computed(() => periods.value.find(period => period.status === 'active') || null);
const todayString = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

async function refreshPeriods() {
  try {
    periods.value = await api.getChildPeriods(childId.value);
  } catch (err) {
    console.error('Failed to load holiday periods:', err);
  }
  await childStore.fetchStats();
}
const selectedSubject = ref('全部');
const streakRef = ref(null);

const streakDays = computed(() => childStore.stats.current_streak ?? 0);
const todayPoints = computed(() => childStore.stats.today_points || 0);

const subjects = [
  { name: '全部', icon: '📝' },
  { name: '语文', icon: '📚' },
  { name: '数学', icon: '🔢' },
  { name: '英语', icon: '🌍' },
  { name: '其他', icon: '🎨' },
];

const formattedDate = computed(() => {
  const d = new Date();
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${weekDays[d.getDay()]} · ${d.getMonth() + 1}月${d.getDate()}日`;
});

const filteredTasks = computed(() => {
  if (selectedSubject.value === '全部') {
    return tasks.value;
  }
  return tasks.value.filter(t => t.subject === selectedSubject.value);
});

// Flexible weekly tasks only count once done, so skipping one never blocks the all-done celebration.
const countedTasks = computed(() => tasks.value.filter(t => !t.is_optional || t.is_completed));
const totalCount = computed(() => countedTasks.value.length);
const completedCount = computed(() => countedTasks.value.filter(t => t.is_completed).length);
const allDone = computed(() => completedCount.value > 0 && completedCount.value === totalCount.value);
const optionalPendingCount = computed(() => tasks.value.filter(t => t.is_optional && !t.is_completed).length);
const completionRate = computed(() => {
  if (totalCount.value === 0) return 0;
  return Math.round((completedCount.value / totalCount.value) * 100);
});

function selectSubject(subjName) {
  playClick();
  selectedSubject.value = subjName;
}

function getSubjectTaskCount(subjName) {
  if (subjName === '全部') return tasks.value.length;
  return tasks.value.filter(t => t.subject === subjName).length;
}

onMounted(async () => {
  await Promise.all([loadTasks(), refreshPeriods()]);
});

async function loadTasks() {
  loading.value = true;
  try {
    if (childStore.childId !== childId.value && childId.value) {
      // Restore child info
      const children = await api.getChildren();
      const match = children.find(c => c.id === childId.value);
      if (match) childStore.setChild(match);
    }
    tasks.value = await api.getDailyTasks(childId.value);
    await childStore.fetchStats();
  } catch (err) {
    console.error('Failed to load daily tasks:', err);
  } finally {
    loading.value = false;
  }
}

async function handleTaskToggle(task) {
  const willComplete = !task.is_completed;
  try {
    if (willComplete) {
      const res = await api.completeDailyTask(task.id);
      task.is_completed = true;
      task.completed_at = new Date().toISOString();

      if (res && res.task && res.task.weekly_completed_times !== undefined) {
        task.weekly_completed_times = res.task.weekly_completed_times;
        task.weekly_remaining_times = res.task.weekly_remaining_times;
      } else if (task.weekly_completed_times !== undefined) {
        task.weekly_completed_times = (task.weekly_completed_times || 0) + 1;
      }

      // Check if this was the last remaining task completed
      if (allDone.value) {
        fireCelebration(true);
      } else if (res && res.new_badges && res.new_badges.length > 0) {
        // Unlocked badge alert
        playBadgeUnlocked();
        fireCelebration(false);
      }

      // Refresh child stats & trigger streak shake
      tasks.value = await api.getDailyTasks(childId.value);
      await childStore.fetchStats();
      if (streakRef.value) {
        streakRef.value.wiggle();
      }
    } else {
      const res = await api.uncompleteDailyTask(task.id);
      task.is_completed = false;
      task.completed_at = null;

      if (res && res.task && res.task.weekly_completed_times !== undefined) {
        task.weekly_completed_times = res.task.weekly_completed_times;
      } else if (task.weekly_completed_times !== undefined) {
        task.weekly_completed_times = Math.max(0, (task.weekly_completed_times || 0) - 1);
      }

      tasks.value = await api.getDailyTasks(childId.value);
      await childStore.fetchStats();
    }
  } catch (err) {
    console.error('Failed to toggle task:', err);
  }
}

function handleRecelebrate() {
  playClick();
  fireCelebration(true);
}

function fireCelebration(playSound = true) {
  if (playSound) {
    playAllDone();
  }
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 }
  });
  setTimeout(() => {
    confetti({
      particleCount: 60,
      angle: 60,
      spread: 55,
      origin: { x: 0 }
    });
    confetti({
      particleCount: 60,
      angle: 120,
      spread: 55,
      origin: { x: 1 }
    });
  }, 200);
}
</script>
