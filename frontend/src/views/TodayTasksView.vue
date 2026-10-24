<template>
  <div class="min-h-[var(--app-content-height)] lg:h-[var(--app-content-height)] lg:max-h-[820px] w-full max-w-[1180px] mx-auto flex flex-col lg:justify-between p-3 pb-24 lg:p-4 select-none lg:overflow-hidden">
    <!-- Top Header Bar (wraps into two rows on phones) -->
    <header class="lg:h-16 shrink-0 bg-white dark:bg-slate-900 rounded-2xl px-4 py-3 lg:px-5 lg:py-0 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-wrap lg:flex-nowrap items-center justify-between gap-y-3">
      <!-- Left: Child Info & Date -->
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-brand-50 dark:bg-brand-900/40 flex items-center justify-center text-2xl shadow-inner">
          {{ childAvatar }}
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-black text-slate-800 dark:text-slate-100 leading-tight">{{ childName }}</h2>
            <span class="text-xs font-bold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 rounded-md">{{ asParent ? '家长' : '学生端' }}</span>
          </div>
          <p class="text-xs font-semibold text-slate-400 leading-tight">{{ formattedDate }}</p>
        </div>
      </div>

      <!-- Center: Today Progress (its own full-width row on phones) -->
      <div class="order-last w-full lg:order-none lg:w-auto flex items-center gap-4 bg-slate-50 dark:bg-slate-800 px-4 py-1.5 rounded-2xl border border-slate-100 dark:border-slate-700">
        <div class="flex flex-col lg:text-right shrink-0">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">今日完成进度</span>
          <span class="text-sm font-black text-slate-800 dark:text-slate-100">
            完成 {{ completedCount }} / {{ totalCount }}
          </span>
        </div>

        <div class="flex-1 lg:flex-none lg:w-28 bg-slate-200 dark:bg-slate-700 h-3 rounded-full overflow-hidden p-0.5">
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

      <!-- Right: today's classes, stroke lookup, sound toggle & parent entrance -->
      <div class="flex items-center gap-2.5">
        <!-- Today's lessons and outside classes (time and place); the next outside class shows here -->
        <button
          v-if="todaySchedule"
          type="button"
          @click="openSchedule"
          class="min-h-[44px] min-w-[44px] relative flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all active:scale-95 shadow-xs"
          :class="todayClasses.length ? 'bg-violet-500 hover:bg-violet-600 text-white' : 'bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-950/40 text-violet-700 dark:text-violet-300'"
          title="今天的课"
        >
          <span>{{ todayClasses.length ? '🎨' : '📅' }}</span>
          <!-- Phones keep the next class's time; wider screens add its name -->
          <span v-if="nextClass" class="tabular-nums">{{ nextClass.start_time }}</span>
          <span class="hidden sm:inline font-chinese">{{ nextClass ? nextClass.title : '今天的课' }}</span>
          <span v-if="todayClasses.length > 1" class="px-1.5 rounded-md bg-white/25 text-xs">{{ todayClasses.length }}</span>
        </button>
        <button
          type="button"
          @click="openStrokeLookup"
          class="min-h-[44px] min-w-[44px] flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-900/40 text-brand-600 dark:text-brand-300 font-bold text-xs transition-all active:scale-95 shadow-xs"
          title="实时查笔画"
        >
          <span>🔍</span>
          <span class="hidden sm:inline">查笔画</span>
        </button>
        <SoundToggle />
        <router-link
          to="/parent/login"
          @click="playClick"
          class="min-h-[44px] min-w-[44px] flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs transition-all active:scale-95"
        >
          <span>⚙️</span>
          <span class="hidden sm:inline">家长</span>
        </router-link>
      </div>
    </header>

    <!-- Phones: streak, points and subject chips (the iPad layout shows these in the sidebar) -->
    <div class="mt-3 space-y-2.5">
      <div class="flex items-center gap-2 text-xs font-black">
        <StreakBadge ref="streakRef" :count="streakDays" />
        <span class="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300">💰 今日已得 {{ todayPoints }} 分</span>
        <router-link to="/" class="ml-auto px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 whitespace-nowrap" @click="playClick(); childStore.switchAccount()">🔄 切换</router-link>
      </div>
      <div class="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3">
        <button
          v-for="sub in subjects"
          :key="sub.name"
          type="button"
          @click="selectSubject(sub.name)"
          class="min-h-[44px] shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all"
          :class="selectedSubject === sub.name ? 'bg-brand-500 text-white shadow-button' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'"
        >
          <span>{{ sub.icon }}</span>
          <span>{{ sub.name }}</span>
          <span class="text-xs opacity-70">{{ getSubjectTaskCount(sub.name) }}</span>
        </button>
      </div>
    </div>

    <!-- Main Layout (Two Columns on iPad landscape) -->
    <div class="flex-1 flex gap-4 my-3 lg:min-h-0 lg:overflow-hidden">
      <!-- Right Area: 2-Column Task Grid & Bottom Motivation Banner -->
      <main class="flex-1 min-w-0 bg-white dark:bg-slate-900 rounded-2xl p-3 lg:p-4 border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col justify-between lg:overflow-hidden">
        <!-- Task Cards Grid (2 Columns, optimized for up to 8 tasks without scrolling on 1180x820) -->
        <div class="flex-1 lg:overflow-y-auto lg:pr-1">
          <!-- Loading state -->
          <div v-if="loading" class="flex justify-center items-center h-48 text-brand-500 dark:text-brand-400 font-bold">
            <span class="animate-spin mr-2">⏳</span> 正在加载今日任务...
          </div>

          <section v-if="unfinishedAttention.length" aria-label="未结束的学习" class="mb-3 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2">
            <h2 class="text-sm font-bold text-amber-800 dark:text-amber-200">还有学习记录未结束</h2>
            <p class="text-xs text-slate-500 dark:text-slate-400">这些记录不计入今天的必做任务，可以打开并保存已学用时。</p>
            <div v-for="item in unfinishedAttention" :key="item.session.id" class="flex items-center justify-between gap-3 text-sm">
              <span class="min-w-0 break-words">{{ item.date }} · {{ item.subject }} · {{ item.title }} <span class="text-xs text-slate-500 dark:text-slate-400">{{ item.session.timer_started_at ? '计时中' : '已暂停' }}</span></span>
              <button type="button" class="shrink-0 min-h-[44px] px-3 rounded-xl bg-white dark:bg-slate-900 font-bold text-brand-700 dark:text-brand-300" @click="openUnfinished(item)">结束 / 查看记录</button>
            </div>
          </section>

          <!-- What to bring tomorrow, from tomorrow's lessons and outside classes -->
          <button
            v-if="!loading && tomorrowSchedule?.bring.length"
            type="button"
            class="w-full mb-3 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-left text-xs font-bold text-amber-800 dark:text-amber-200 font-chinese truncate"
            @click="openSchedule"
          >
            🎒 明天要带：{{ tomorrowSchedule.bring.map(item => `${item.for}·${item.items}`).join('；') }}
          </button>

          <!-- Long-term tasks (reading a book, holiday homework), with the holiday banner during a period -->
          <GoalTasksPanel
            :child-name="childStore.childName"
            v-if="!loading && (activePeriod || activeGoals.length)"
            :goals="activeGoals"
            :period="activePeriod"
            :today="todayString"
            :daily-rows="goalRows"
            :as-parent="asParent"
            :now="now"
            @changed="refreshGoals"
            v-on="skipHandlers"
          />

          <!-- A failed read is not an empty day: say so, keep what was shown before, and offer a retry. -->
          <div v-if="!loading && tasksError" role="alert" class="mb-3 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm font-bold text-rose-700 dark:text-rose-300">
            <span class="flex-1">{{ tasks.length ? '任务没有更新成功，下面是上次读到的内容。' : '今天的任务没有读取成功，这不代表没有任务。' }}</span>
            <button type="button" class="min-h-[44px] px-4 rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800" @click="refreshBoard">重新读取</button>
          </div>

          <!-- Empty state -->
          <div
            v-if="!loading && !tasksError && filteredTasks.length === 0 && extraTasks.length === 0 && !activePeriod && !activeGoals.length"
            class="flex flex-col items-center justify-center h-64 text-slate-400"
          >
            <span class="text-5xl mb-3">🏖️</span>
            <span class="text-base font-bold text-slate-600 dark:text-slate-300">当前分类下暂无任务</span>
            <span class="text-xs text-slate-400 mt-1">可以选择“全部”查看或在家长端添加任务</span>
          </div>

          <div
            v-if="!loading && !tasksError && (activePeriod || activeGoals.length) && filteredTasks.length === 0 && extraTasks.length === 0"
            class="text-center py-6 text-sm font-bold text-slate-400"
          >
            {{ activePeriod ? '假期中，今天没有日常任务～' : '今天没有日常任务～' }}
          </div>

          <!-- 2 Columns Grid -->
          <div v-if="!loading && filteredTasks.length > 0" class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <TaskCard
              v-for="task in filteredTasks"
              :key="task.id"
              :data-timer-id="task.id"
              :task="task"
              :as-parent="asParent"
              :now="now"
              @toggle="handleTaskToggle"
              @timer="handleTimer"
              @edit-duration="openDurationEdit"
              v-on="skipHandlers"
            />
          </div>
          <section v-if="!loading && extraTasks.length" class="mt-5 space-y-3">
            <div>
              <h3 class="text-sm font-black text-violet-700 dark:text-violet-300">✨ 额外挑战</h3>
              <p class="text-xs font-bold text-slate-400">自愿完成，不增加应做次数，不影响完成率、全勤和连续打卡。</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <TaskCard v-for="task in extraTasks" :key="task.id" :data-timer-id="task.id" :task="task" :as-parent="asParent" :now="now"
                @toggle="handleTaskToggle" @timer="handleTimer" @edit-duration="openDurationEdit" />
            </div>
          </section>
        </div>

        <!-- Keep the rest-day message visible when daily tasks were skipped, including goal logs. -->
        <div v-if="totalCount > 0 || skippedCount > 0 || !(activePeriod || activeGoals.length)" class="mt-3 shrink-0">
          <!-- When all completed -->
          <div
            v-if="allDone"
            class="p-3.5 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 text-white flex flex-wrap items-center justify-between gap-3 shadow-lg shadow-emerald-200 animate-pop-in"
          >
            <div class="flex items-center gap-3">
              <span class="text-2xl animate-bounce">🎉</span>
              <div>
                <h4 class="text-sm font-black tracking-wide">
                  太棒啦！今日作业任务已全部完成！
                </h4>
                <p class="text-xs text-emerald-100 font-medium">
                  {{ optionalPendingCount > 0 ? `还有 ${optionalPendingCount} 项可以晚点做的任务，做了也能得分哦！` : '已获得全部任务积分，保持连续打卡哦！' }}
                </p>
              </div>
            </div>
            <button
              type="button"
              @click="handleRecelebrate"
              class="px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 font-black text-xs hover:bg-emerald-50 dark:hover:bg-emerald-950/40 active:scale-95 transition-all shadow-sm whitespace-nowrap"
            >
              再撒一次花 🎉
            </button>
          </div>

          <!-- Everything left today was skipped -->
          <div
            v-else-if="totalCount === 0 && skippedCount > 0"
            class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5"
          >
            <span class="text-xl">⏭️</span>
            <span class="text-sm font-bold text-slate-600 dark:text-slate-300">今天的任务都跳过啦，好好休息～</span>
          </div>

          <!-- When in progress -->
          <div
            v-else
            class="p-3.5 rounded-2xl bg-gradient-to-r from-brand-50 dark:from-brand-900/40 via-indigo-50 dark:via-indigo-950/40 to-amber-50 dark:to-amber-950/40 border border-brand-100 dark:border-brand-800 flex flex-wrap items-center justify-between gap-2"
          >
            <div class="flex items-center gap-2.5">
              <span class="text-xl">✨</span>
              <span class="text-sm font-bold text-slate-700 dark:text-slate-200">
                全部完成今天任务，即可冲击更高连胜纪录与荣耀徽章！
              </span>
            </div>
            <span class="text-xs font-black text-brand-600 dark:text-brand-300 bg-white dark:bg-slate-900 px-3 py-1 rounded-xl shadow-xs whitespace-nowrap">
              加油！还剩 {{ totalCount - completedCount }} 项
            </span>
          </div>
        </div>
      </main>
    </div>

    <ChildTabBar :child-id="childId" />

    <SkipTaskModal
      v-if="skipTarget"
      :task="skipTarget"
      :as-parent="asParent"
      :busy="skipBusy"
      :error="skipError"
      @close="skipTarget = null"
      @submit="submitSkip"
    />

    <DurationModal
      v-if="durationAsk"
      :title="durationAsk.task.title"
      :initial-seconds="durationAsk.initialSeconds"
      :editing="durationAsk.editing"
      :note="durationAsk.note"
      :busy="durationBusy"
      :error="durationError"
      @close="durationAsk = null"
      @submit="submitDuration"
    />

    <TodayScheduleModal
      v-if="scheduleOpen && todaySchedule"
      :key="childId"
      :child-id="childId"
      :child-name="childName"
      :business-date="todayString"
      :refresh="refreshClassActions"
      :today="todaySchedule"
      :tomorrow="tomorrowSchedule"
      @close="scheduleOpen = false"
    />

    <!-- Stroke Lookup Modal -->
    <StrokeLookupModal
      v-model="isLookupModalOpen"
      :child-id="childId"
      initial-char="学"
    />
    <HomeworkStudyModal v-if="studyRecord" :record-id="studyRecord" :as-parent="asParent" @close="studyRecord = null; loadUnfinished()" @saved="refreshStudy" />
    <StudySessionsModal v-if="studyTask" :task-id="studyTask" :as-parent="asParent" @close="studyTask = null; loadUnfinished()" @saved="refreshStudy" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import confetti from 'canvas-confetti';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import { useRunningTimerStore } from '../stores/runningTimer.js';
import TaskCard from '../components/TaskCard.vue';
import HomeworkStudyModal from '../components/HomeworkStudyModal.vue';
import StudySessionsModal from '../components/StudySessionsModal.vue';
import ProgressRing from '../components/ProgressRing.vue';
import StreakBadge from '../components/StreakBadge.vue';
import SoundToggle from '../components/SoundToggle.vue';
import StrokeLookupModal from '../components/StrokeLookupModal.vue';
import GoalTasksPanel from '../components/GoalTasksPanel.vue';
import ChildTabBar from '../components/ChildTabBar.vue';
import SkipTaskModal from '../components/SkipTaskModal.vue';
import DurationModal from '../components/DurationModal.vue';
import TodayScheduleModal from '../components/TodayScheduleModal.vue';
import { addDays, lessonHappens } from '../utils/schedule.js';
import { playAllDone, playBadgeUnlocked, playClick, playTaskComplete } from '../utils/sound';
import { LONG_TIMER_SECONDS, formatDuration, liveSeconds, needsDurationPrompt, withClock } from '../utils/taskTimer.js';
import { useParentSession } from '../composables/useParentSession.js';
import { businessDate, businessClock, businessDayLabel, DEFAULT_TIME_ZONE } from '../utils/businessDate.js';

const route = useRoute();
const router = useRouter();
const childStore = useChildStore();
const timerStore = useRunningTimerStore();
const isLookupModalOpen = ref(false);

function openStrokeLookup() {
  playClick();
  isLookupModalOpen.value = true;
}

const childId = computed(() => route.params.id || childStore.childId);
const childName = computed(() => childStore.childName);
const childAvatar = computed(() => childStore.childAvatar);
// A parent opening the board from the console acts as the parent: skips take effect at once.
const { asParent } = useParentSession();

const tasks = ref([]);
// The placeholder only covers a board that has nothing to show yet. Later refreshes update the
// cards in place: swapping them for the placeholder shrinks the page and loses the scroll position.
const loading = ref(true);
const tasksError = ref(false);
let boardLoaded = false;
const periods = ref([]);
const goals = ref([]);
const activePeriod = computed(() => periods.value.find(period => period.status === 'active') || null);
// Running long-term tasks, plus any finished today so the child sees the celebration.
const activeGoals = computed(() => goals.value.filter(goal => goal.status === 'active' || goal.completed_on === todayString.value));
const timeZone = ref(DEFAULT_TIME_ZONE);
const unfinished = ref([]);
let taskSerial = 0, goalSerial = 0, scheduleSerial = 0, unfinishedSerial = 0, loadSerial = 0;

// Keep task timers and the next-class reminder current even when no task timer is running.
const now = ref(Date.now());
const todayString = computed(() => businessDate(now.value, timeZone.value));
// Only sessions whose task left today's board; a task still due (carried over, homework) keeps its card.
const unfinishedAttention = computed(() => loading.value ? [] : unfinished.value.filter(item => !tasks.value.some(task => task.id === item.task_id)));
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
onUnmounted(() => {
  clearInterval(clock);
  taskSerial++; goalSerial++; scheduleSerial++; unfinishedSerial++; loadSerial++;
  document.removeEventListener('visibilitychange', onResume);
  window.removeEventListener('pageshow', onResume);
});
async function fetchTasks() {
  const serial = ++taskSerial, id = childId.value, date = todayString.value;
  let list;
  try {
    list = (await api.getDailyTasks(id)).map(task => withClock(task));
  } catch (err) {
    if (serial === taskSerial) tasksError.value = true;
    throw err;
  }
  if (serial !== taskSerial || id !== childId.value || date !== todayString.value) return;
  now.value = Date.now();
  tasksError.value = false;
  tasks.value = list;
  // Every timer change reloads the board's tasks, so the running-timer bar follows here.
  timerStore.refresh(id);
}

async function loadGoals() {
  const serial = ++goalSerial, id = childId.value, date = todayString.value;
  try {
    const [periodList, goalList] = await Promise.all([api.getChildPeriods(id), api.getChildGoals(id)]);
    if (serial !== goalSerial || id !== childId.value || date !== todayString.value) return;
    periods.value = periodList;
    goals.value = goalList.map(goal => withClock(goal));
    now.value = Date.now();
  } catch (err) {
    console.error('Failed to load long-term tasks:', err);
  }
}

// Logging progress may complete a daily-required item, so today's tasks are refreshed too.
async function refreshGoals() {
  const wasAllDone = allDone.value;
  await loadGoals();
  try {
    await fetchTasks();
  } catch (err) {
    console.error('Failed to refresh daily tasks:', err);
  }
  await Promise.all([childStore.fetchStats(), loadUnfinished()]);
  if (!wasAllDone && allDone.value) fireCelebration(true);
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

const formattedDate = computed(() => businessDayLabel(todayString.value));

// Daily items of long-term tasks are logged in their panel, so the card grid leaves them out
// (they still count towards today's progress).
const cardTasks = computed(() => tasks.value.filter(t => t.origin !== 'goal'));
const goalRows = computed(() => Object.fromEntries(tasks.value.filter(t => t.origin === 'goal').map(t => [t.goal_id, t])));
const filteredTasks = computed(() => {
  if (selectedSubject.value === '全部') {
    return cardTasks.value.filter(t => !t.is_extra);
  }
  return cardTasks.value.filter(t => !t.is_extra && t.subject === selectedSubject.value);
});

const extraTasks = computed(() => cardTasks.value.filter(t => t.is_extra && (selectedSubject.value === '全部' || t.subject === selectedSubject.value)));

// Flexible weekly tasks only count once done and skipped tasks never count, so neither blocks
// the all-done celebration.
const countedTasks = computed(() => tasks.value.filter(t => !t.is_extra && !t.is_skipped && (!t.is_optional || t.is_completed)));
const skippedCount = computed(() => tasks.value.filter(t => t.is_skipped).length);
const totalCount = computed(() => countedTasks.value.length);
const completedCount = computed(() => countedTasks.value.filter(t => t.is_completed).length);
const allDone = computed(() => completedCount.value > 0 && completedCount.value === totalCount.value);
const optionalPendingCount = computed(() => tasks.value.filter(t => !t.is_extra && t.is_optional && !t.is_completed).length);
const completionRate = computed(() => {
  if (totalCount.value === 0) return 0;
  return Math.round((completedCount.value / totalCount.value) * 100);
});

function selectSubject(subjName) {
  playClick();
  selectedSubject.value = subjName;
}

function getSubjectTaskCount(subjName) {
  if (subjName === '全部') return cardTasks.value.length;
  return cardTasks.value.filter(t => t.subject === subjName).length;
}

// --- Today's classes: the header entry, tomorrow's things to bring ---
const todaySchedule = ref(null);
const tomorrowSchedule = ref(null);
const scheduleOpen = ref(false);
const todayClasses = computed(() => (todaySchedule.value?.outside || []).filter(lessonHappens));
// The outside class still to come today (or the last one once all have started).
const nextClass = computed(() => {
  const nowTime = businessClock(now.value, timeZone.value);
  return todayClasses.value.find(lesson => lesson.end_time > nowTime) || todayClasses.value.at(-1) || null;
});

async function loadSchedule({ throwOnError = false } = {}) {
  const serial = ++scheduleSerial, id = childId.value, date = todayString.value;
  try {
    const result = await api.getChildSchedule(id, date, addDays(date, 1));
    if (serial === scheduleSerial && id === childId.value && date === todayString.value) [todaySchedule.value, tomorrowSchedule.value] = result;
  } catch (err) {
    console.error('Failed to load the timetable:', err);
    if (throwOnError) throw err;
  }
}

async function refreshClassActions() {
  const results = await Promise.allSettled([loadSchedule({ throwOnError: true }), fetchTasks(), childStore.fetchStats()]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function openSchedule() {
  playClick();
  scheduleOpen.value = true;
}

async function loadUnfinished() {
  const serial = ++unfinishedSerial, id = childId.value;
  try {
    const result = await api.getUnfinishedStudy(id);
    if (serial !== unfinishedSerial || id !== childId.value) return;
    timeZone.value = result.time_zone;
    unfinished.value = result.items;
  } catch (err) { console.error('Failed to load unfinished study:', err); }
}
function openUnfinished(item) {
  if (item.record_id) studyRecord.value = item.record_id;
  else studyTask.value = item.task_id;
}
async function refreshBoard() { await Promise.all([loadTasks(), loadGoals(), loadSchedule()]); }
async function refreshStudy() { await Promise.all([loadTasks(), loadGoals()]); }
function onResume() {
  if (document.hidden) return;
  const date = todayString.value;
  now.value = Date.now();
  if (date === todayString.value) refreshBoard(); // A changed date is handled by the watcher.
}
watch([todayString, childId], ([, id], [, previousId]) => {
  tasks.value = []; goals.value = []; periods.value = []; unfinished.value = []; tasksError.value = false;
  boardLoaded = false;
  childStore.statsRequestId++;
  childStore.stats = { ...childStore.stats, today_points: 0, today_total_tasks: 0, today_completed_tasks: 0, today_completion_rate: 0 };
  // Keep an open dialog mounted while the new business day's schedule loads.
  // Its business-date prop invalidates old actions even if that refresh fails.
  if (!scheduleOpen.value || id !== previousId) todaySchedule.value = null;
  tomorrowSchedule.value = null;
  refreshBoard();
});
onMounted(() => {
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', onResume);
  refreshBoard();
});

async function loadTasks() {
  const serial = ++loadSerial, id = childId.value;
  if (!boardLoaded) loading.value = true;
  try {
    if (childStore.childId !== childId.value && childId.value) {
      // Restore child info
      const children = await api.getChildren();
      if (serial !== loadSerial || id !== childId.value) return;
      const match = children.find(c => c.id === childId.value);
      if (match) childStore.setChild(match);
    }
    await Promise.all([fetchTasks(), childStore.fetchStats(), loadUnfinished()]);
  } catch (err) {
    console.error('Failed to load daily tasks:', err);
  } finally {
    if (serial === loadSerial) { loading.value = false; boardLoaded = true; }
  }
}

// A timed task whose timer barely ran (or ran far too long) asks how long it took before it is
// checked off; durationBody carries the answer.
const studyRecord = ref(null);
const studyTask = ref(null);

// The running-timer bar links here: a study session reopens its record, other timers scroll their card into view.
const focusId = ref(null);
watch(() => route.query, query => {
  if (query.homework) studyRecord.value = String(query.homework);
  else if (query.study) studyTask.value = String(query.study);
  else if (query.focus) focusId.value = String(query.focus);
  else return;
  router.replace({ query: {} });
}, { immediate: true });
watch([focusId, loading], async ([id, busy]) => {
  if (!id || busy) return;
  await nextTick();
  document.querySelector(`[data-timer-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  focusId.value = null;
});
// The bar paused or resumed a timer: show the change on the cards too.
watch(() => timerStore.changedAt, () => refreshGoals());
async function handleTaskToggle(task, durationBody = null) {
  if (task.homework) { studyRecord.value = task.homework.id; return; }
  if (task.origin === 'study') { router.push(`/child/${childId.value}/word-study`); return; }
  if ((task.track_time || task.study_sessions) && task.origin !== 'goal') { studyTask.value = task.id; return; }
  const willComplete = !task.is_completed;
  const wasAllDone = allDone.value;
  if (willComplete && !durationBody && task.track_time && needsDurationPrompt(task, now.value)) {
    playClick();
    const seconds = liveSeconds(task, now.value);
    durationError.value = '';
    durationAsk.value = seconds > LONG_TIMER_SECONDS
      ? { task, initialSeconds: seconds, note: `计时已经走了 ${formatDuration(seconds)}，是不是忘了暂停？请改成实际用了多久。` }
      : { task, initialSeconds: task.expected_minutes ? task.expected_minutes * 60 : null };
    return;
  }
  try {
    if (willComplete) {
      const res = await api.completeDailyTask(task.id, durationBody || undefined);
      Object.assign(task, res.task);

      if (res && res.task && res.task.weekly_completed_times !== undefined) {
        task.weekly_completed_times = res.task.weekly_completed_times;
        task.weekly_remaining_times = res.task.weekly_remaining_times;
      } else if (task.weekly_completed_times !== undefined) {
        task.weekly_completed_times = (task.weekly_completed_times || 0) + 1;
      }

      // Check if this was the last remaining task completed
      if (!wasAllDone && allDone.value) {
        fireCelebration(true);
      } else if (res && res.new_badges && res.new_badges.length > 0) {
        // Unlocked badge alert
        playBadgeUnlocked();
        fireCelebration(false);
      }

      // Refresh child stats & trigger streak shake
      await fetchTasks();
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

      await fetchTasks();
      await childStore.fetchStats();
    }
  } catch (err) {
    console.error('Failed to toggle task:', err);
  }
}

// --- Timing: timer actions, and the time a task took ---
const durationAsk = ref(null);
const durationBusy = ref(false);
const durationError = ref('');

// Starting one timer pauses any other of the child's, long-term tasks included, so both reload.
async function handleTimer(task, action) {
  playClick();
  try {
    await api.taskTimer(task.id, action);
    await refreshGoals();
  } catch (err) {
    console.error('Failed to update the timer:', err);
  }
}

function openDurationEdit(task) {
  playClick();
  durationError.value = '';
  durationAsk.value = { task, initialSeconds: task.duration_seconds, editing: true };
}

async function submitDuration(seconds) {
  const { task, editing } = durationAsk.value;
  if (!editing) {
    durationAsk.value = null;
    playTaskComplete();
    await handleTaskToggle(task, { duration_seconds: seconds });
    return;
  }
  durationBusy.value = true;
  durationError.value = '';
  try {
    await api.setTaskDuration(task.id, seconds);
    durationAsk.value = null;
    await fetchTasks();
  } catch (err) {
    durationError.value = typeof err === 'string' ? err : '保存失败，请重试';
  } finally {
    durationBusy.value = false;
  }
}

// --- Skipping a task: a child asks with a reason, a parent skips at once or settles the request ---
const skipTarget = ref(null);
const skipBusy = ref(false);
const skipError = ref('');

// Reloads after a skip change; an approved skip may finish the day or unlock a badge.
async function afterSkipChange(result) {
  const wasAllDone = allDone.value;
  await fetchTasks();
  await Promise.all([loadGoals(), childStore.fetchStats()]);
  if (!wasAllDone && allDone.value) fireCelebration(true);
  else if (result?.new_badges?.length) {
    playBadgeUnlocked();
    fireCelebration(false);
  }
}

async function runSkipAction(action) {
  try {
    await afterSkipChange(await action());
  } catch (err) {
    console.error('Failed to update the skip:', err);
  }
}

async function submitSkip(reason) {
  skipBusy.value = true;
  skipError.value = '';
  try {
    const result = await api.skipDailyTask(skipTarget.value.id, reason);
    skipTarget.value = null;
    await afterSkipChange(result);
  } catch (err) {
    skipError.value = typeof err === 'string' ? err : '提交失败，请重试';
  } finally {
    skipBusy.value = false;
  }
}

const skipHandlers = {
  skip(task) {
    playClick();
    skipError.value = '';
    skipTarget.value = task;
  },
  'cancel-skip': task => runSkipAction(() => api.cancelSkipRequest(task.skip_request.id)),
  'approve-skip': task => runSkipAction(() => api.approveSkipRequest(task.skip_request.id)),
  'reject-skip': task => runSkipAction(() => api.rejectSkipRequest(task.skip_request.id)),
  unskip: task => runSkipAction(() => api.unskipDailyTask(task.id))
};

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
