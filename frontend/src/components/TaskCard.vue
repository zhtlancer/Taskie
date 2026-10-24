<template>
  <div ref="card" data-task-card
    class="relative select-none rounded-2xl border-2 p-4 transition-all duration-200 cursor-pointer flex flex-col gap-3 min-w-0 h-full shadow-sm"
    :class="[task.is_completed ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700' : task.is_skipped ? 'bg-slate-50 dark:bg-slate-800 border-dashed border-slate-300 dark:border-slate-600 cursor-default' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-card', { 'z-40': menuOpen }]"
    @click="handleClick" @keydown.esc="menuOpen && ($event.stopPropagation(), closeMenu())">
    <header class="flex items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-1.5 min-w-0">
        <span class="px-2 py-1 rounded-lg text-xs font-bold font-chinese" :class="subjectBadgeClass(task.subject)">{{ task.subject }}</span>
        <span v-if="task.origin === 'adhoc'" class="px-2 py-1 rounded-lg text-xs font-bold bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300">{{ task.homework ? '作业' : '临时' }}</span>
        <span v-if="task.origin === 'class'" class="px-2 py-1 rounded-lg text-xs font-bold bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">课外班</span>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <span class="text-xs font-bold" :class="task.is_completed ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400'">{{ statusLabel }}</span>
        <button v-if="menuActions.length" ref="menuTrigger" type="button" aria-label="更多任务操作" :aria-expanded="menuOpen" :aria-controls="`task-menu-${task.id}`"
          class="w-11 h-11 -my-1 -mr-2 rounded-xl text-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-400" @click.stop="toggleMenu">⋯</button>
      </div>
    </header>

    <div class="space-y-1.5 min-w-0">
      <h4 class="text-lg leading-snug font-bold text-slate-800 dark:text-slate-100 line-clamp-2 break-words font-chinese" :class="{ 'text-slate-500 dark:text-slate-400': task.is_completed || task.is_skipped }">{{ task.title }}</h4>
      <p v-if="homeworkDetail" class="text-sm leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-line line-clamp-2 break-words font-chinese">📒 {{ homeworkDetail }}</p>
      <p v-if="deadlineLabel" class="text-xs font-bold" :class="deadlineToday ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'">📌 {{ deadlineLabel }}</p>
      <p v-if="task.class_lesson" class="text-xs text-violet-600 dark:text-violet-300 break-words">🕓 {{ task.class_lesson.start_time }}–{{ task.class_lesson.end_time }}{{ task.class_lesson.location ? ` · ${task.class_lesson.location}` : '' }}</p>
    </div>

    <div v-if="isWeeklyTask" class="space-y-1 text-xs text-slate-500 dark:text-slate-400">
      <p :class="isWeeklyTargetMet ? 'text-emerald-700 dark:text-emerald-300 font-bold' : ''">🎯 本周 {{ task.weekly_completed_times || 0 }} / {{ task.weekly_target_times }} 次{{ isWeeklyTargetMet ? ' · 目标已达成' : '' }}<span v-if="task.weekly_skipped_times"> · 跳过 {{ task.weekly_skipped_times }} 次</span></p>
      <p v-if="!isWeeklyTargetMet && !task.is_completed && !task.is_skipped && task.week_days_left" :class="task.is_optional ? 'text-sky-600 dark:text-sky-300' : 'text-rose-600 dark:text-rose-300'">{{ task.is_optional ? '今天可选' : '今天要做' }} · 本周还剩 {{ task.week_days_left }} 天，还差 {{ task.weekly_remaining_times }} 次</p>
      <p v-if="task.is_extra" class="text-violet-600 dark:text-violet-300">✨ 额外挑战 · 自愿完成，不影响考核</p>
      <p v-if="task.allow_extra && task.extra_points && task.extra_reward_limit">额外奖励已用 {{ task.weekly_extra_rewarded_times || 0 }} / {{ task.extra_reward_limit }} 次</p>
    </div>

    <div v-if="usesStudySessions(task)" class="space-y-2.5">
      <div v-if="!task.is_completed && !task.is_skipped && (task.timer_running || currentSeconds > 0)"
        class="flex items-center justify-between gap-2 rounded-xl border px-3 py-3"
        :class="task.timer_running ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
        <span role="timer" aria-label="本次学习用时" class="tabular-nums text-lg font-black whitespace-nowrap">⏱ 本次 {{ formatClock(currentSeconds) }}</span>
        <span class="text-xs font-bold shrink-0">{{ task.timer_running ? '计时中' : '已暂停' }}</span>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">已学 {{ studyCount }} 次 · {{ task.is_completed ? '累计用时' : '已保存' }} {{ savedSeconds ? formatDuration(savedSeconds) : '0 分钟' }}</p>
    </div>
    <TaskTimer v-else-if="task.track_time && !task.is_completed && !task.is_skipped" :item="task" :now="now"
      @start="emit('timer', task, 'start')" @pause="emit('timer', task, 'pause')" @reset="emit('timer', task, 'reset')" />
    <div v-else-if="task.track_time && task.is_completed" class="flex items-center gap-2 text-xs text-violet-600 dark:text-violet-300">
      <span>⏱ {{ task.duration_seconds ? `用时 ${formatDuration(task.duration_seconds)}` : '没有记录用时' }}</span>
      <button type="button" class="min-h-[44px] rounded-lg px-2 py-2 bg-violet-50 dark:bg-violet-950/40" @click.stop="emit('edit-duration', task)">更正用时</button>
    </div>

    <p v-if="task.is_skipped" class="text-xs text-slate-500 dark:text-slate-400 break-words">⏭ 今天已跳过 · {{ task.skip_reason }}</p>
    <div v-else-if="skipPending" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-2.5 text-xs text-amber-700 dark:text-amber-300 space-y-2">
      <p class="break-words">⏳ 申请跳过：{{ task.skip_request.reason }} · 等家长确认</p>
      <div v-if="asParent" class="flex gap-2">
        <button type="button" class="min-h-[44px] px-3 rounded-lg bg-emerald-500 text-white font-bold" @click.stop="emit('approve-skip', task)">同意跳过</button>
        <button type="button" class="min-h-[44px] px-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold" @click.stop="emit('reject-skip', task)">不同意</button>
      </div>
    </div>
    <p v-else-if="skipTurnedDown && !asParent" class="text-xs text-rose-500 dark:text-rose-400">家长没有同意跳过，今天还是要完成哦</p>

    <footer class="mt-auto pt-3 border-t flex items-center justify-between gap-3" :class="task.is_completed ? 'border-emerald-200/60 dark:border-emerald-800/60' : 'border-slate-100 dark:border-slate-700'">
      <div class="min-w-0">
        <p class="text-sm font-extrabold" :class="task.is_completed ? 'text-emerald-700 dark:text-emerald-300' : task.is_skipped ? 'text-slate-400' : 'text-amber-600 dark:text-amber-300'">★ {{ task.is_completed ? `已得 ${displayPoints} 分` : task.is_skipped ? '跳过不得分' : displayPoints ? `完成得 ${displayPoints} 分` : '记录完成 · 不加分' }}</p>
        <p v-if="task.completion_source === 'parent_backfill'" class="text-xs text-sky-600 dark:text-sky-300 mt-0.5">家长补记</p>
      </div>
      <button v-if="!task.is_skipped || usesStudySessions(task)" type="button"
        class="shrink-0 rounded-xl min-h-[44px] px-4 py-2.5 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-indigo-400"
        :class="task.is_completed ? 'bg-white/80 dark:bg-slate-900/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-950/40'"
        @click.stop="primaryClick">{{ primaryLabel }}</button>
    </footer>

    <template v-if="menuOpen">
      <button type="button" class="fixed inset-0 z-40 cursor-default" aria-label="关闭任务菜单" @click.stop="closeMenu" />
      <div :id="`task-menu-${task.id}`" ref="menuPanel" role="group" aria-label="任务操作" class="absolute top-14 right-3 z-50 w-44 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl" @click.stop>
        <button v-for="action in menuActions" :key="action.event" type="button" class="block w-full min-h-[44px] text-left rounded-xl px-3 py-2 text-sm font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:bg-indigo-50 dark:focus-visible:bg-indigo-950/40" @click.stop="runAction(action)">{{ action.label }}</button>
      </div>
    </template>
    <div v-for="particle in activeParticles" :key="particle.id" class="absolute pointer-events-none z-30 font-black text-amber-500 dark:text-amber-400 flex items-center gap-1 animate-coin" :style="{ left: particle.x + 'px', top: particle.y + 'px' }">
      <span class="text-xl">💰</span><span class="text-lg font-extrabold">+{{ displayPoints }}分</span>
    </div>
  </div>
</template>

<script setup>
import { businessDate } from '../utils/businessDate.js';
import { useCalendarStore } from '../stores/calendar';
import { ref, computed, nextTick } from 'vue';
import { playTaskComplete, playTaskUncomplete } from '../utils/sound';
import TaskTimer from './TaskTimer.vue';
import { formatClock, formatDuration, liveSeconds, needsDurationPrompt, usesStudySessions } from '../utils/taskTimer.js';
import { deadlineText } from '../utils/schedule.js';
const calendar = useCalendarStore();

const props = defineProps({
  task: {
    type: Object,
    required: true
  },
  // The board is open with a parent session: skips take effect at once and requests can be settled here.
  asParent: {
    type: Boolean,
    default: false
  },
  // The board's clock, ticking while a timer runs.
  now: {
    type: Number,
    default: () => Date.now()
  }
});

const emit = defineEmits(['toggle', 'skip', 'unskip', 'cancel-skip', 'approve-skip', 'reject-skip', 'timer', 'edit-duration']);

const activeParticles = ref([]);
const card = ref(null), menuOpen = ref(false), menuTrigger = ref(null), menuPanel = ref(null);
const currentSeconds = computed(() => Math.min(43200, liveSeconds(props.task, props.now)));
const studyCount = computed(() => props.task.homework?.study_count ?? props.task.study_sessions?.count ?? 0);
// A timed task not yet moved to sessions has saved nothing until it is done; its running timer is only 本次.
const savedSeconds = computed(() => props.task.homework?.study_seconds ??
  (props.task.study_sessions?.managed === false && !props.task.is_completed ? 0 : props.task.study_sessions?.seconds ?? 0));
const statusLabel = computed(() => props.task.is_completed ? '✓ 已完成' : props.task.is_skipped ? '已跳过'
  : studyCount.value || props.task.timer_running || currentSeconds.value ? '进行中' : '待完成');
const primaryLabel = computed(() => usesStudySessions(props.task)
  ? props.task.is_completed || props.task.is_skipped ? '查看记录' : '学习 / 记录'
  : props.task.origin === 'study' ? props.task.is_completed ? '继续学习 →' : '开始学习 →'
  : props.task.is_completed ? '撤销完成' : '完成任务');
const displayPoints = computed(() => props.task.is_completed
  ? props.task.earned_points ?? props.task.points
  : props.task.award_points ?? props.task.points);

const homeworkDetail = computed(() => {
  const homework = props.task.homework;
  if (!homework || props.task.title === `${homework.subject}：${homework.content}`) return '';
  const [first, ...rest] = homework.content.split('\n');
  return props.task.title === `${homework.subject}：${first}` ? rest.join('\n').trim() : homework.content;
});
const isWeeklyTask = computed(() => {
  return props.task.schedule_type === 'weekly_times' || Boolean(props.task.weekly_target_times);
});

// Skipped times use up the weekly target just like completed ones.
const weeklyUsed = computed(() => (props.task.weekly_target_completed_times ?? props.task.weekly_completed_times ?? 0) + (props.task.weekly_skipped_times || 0));
const isWeeklyTargetMet = computed(() => {
  if (!isWeeklyTask.value) return false;
  return weeklyUsed.value >= (props.task.weekly_target_times || 1);
});

// Carried from an earlier day ("周五的作业 · 周日前完成"), or allowed to wait until a later deadline.
const deadlineLabel = computed(() => props.task.is_completed && !props.task.carried_from ? '' : deadlineText(props.task, businessDate(Date.now(), calendar.timeZone)));
const deadlineToday = computed(() => !props.task.is_completed && props.task.carried_from && !props.task.is_optional);

const skipPending = computed(() => !props.task.is_completed && props.task.skip_request?.status === 'pending');
const skipTurnedDown = computed(() => !props.task.is_completed && ['rejected', 'revoked'].includes(props.task.skip_request?.status));
// Once a parent turned a request down, only the parent can still skip the task.
const canSkip = computed(() => !props.task.is_extra && !props.task.is_completed && !props.task.is_skipped && !skipPending.value &&
  (props.asParent || !skipTurnedDown.value));
const menuActions = computed(() => {
  if (props.task.is_skipped) return props.asParent ? [{ label: '撤销跳过', event: 'unskip' }] : [];
  // A parent answers a pending request from the buttons on the card itself.
  if (skipPending.value) return props.asParent ? [] : [{ label: '撤回申请', event: 'cancel-skip' }];
  return canSkip.value ? [{ label: props.asParent ? '跳过任务' : '今天没有？', event: 'skip' }] : [];
});
async function toggleMenu() {
  if (menuOpen.value) { closeMenu(); return; }
  menuOpen.value = true;
  await nextTick();
  menuPanel.value?.querySelector('button')?.focus();
}
function closeMenu() { menuOpen.value = false; menuTrigger.value?.focus(); }
function runAction(action) { closeMenu(); emit(action.event, props.task); }
function primaryClick(event) {
  if (usesStudySessions(props.task)) emit('toggle', props.task);
  else handleClick(event);
}

function subjectBadgeClass(subject) {
  switch (subject) {
    case '语文':
      return 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300';
    case '数学':
      return 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300';
    case '英语':
      return 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300';
    default:
      return 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200';
  }
}

function handleClick(event) {
  // A skipped task cannot be checked off until a parent takes the skip back.
  if (props.task.is_skipped) return;
  // A timed task that still needs its time asks first; the celebration waits for the answer.
  if (usesStudySessions(props.task) || props.task.origin === 'study') { emit('toggle', props.task); return; }
  if (!props.task.is_completed && props.task.track_time && needsDurationPrompt(props.task, props.now)) {
    emit('toggle', props.task);
    return;
  }
  if (!props.task.is_completed) {
    // 播放任务打卡完成音
    playTaskComplete();

    // Generate floating coin animation particle
    const rect = card.value.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left - 30, 20), rect.width - 100);
    const y = Math.max(event.clientY - rect.top - 20, 10);

    const particleId = Date.now() + Math.random();
    if (displayPoints.value > 0) activeParticles.value.push({ id: particleId, x, y });

    setTimeout(() => {
      activeParticles.value = activeParticles.value.filter(p => p.id !== particleId);
    }, 900);
  } else {
    // 播放取消打卡音
    playTaskUncomplete();
  }

  emit('toggle', props.task);
}
</script>
