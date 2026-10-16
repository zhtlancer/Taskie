<template>
  <div
    class="relative select-none rounded-2xl border-2 p-3.5 transition-all duration-200 cursor-pointer flex items-center justify-between min-h-[96px] shadow-sm overflow-hidden"
    :class="[
      task.is_completed
        ? 'bg-emerald-50/90 border-emerald-400 shadow-emerald-100/50'
        : task.is_skipped
          ? 'bg-slate-50 border-dashed border-slate-300 cursor-default'
          : 'bg-white border-slate-200 hover:border-brand-300 hover:shadow-card'
    ]"
    @click="handleClick"
  >
    <!-- Left: Checkbox & Content -->
    <div class="flex items-center gap-3.5 flex-1 min-w-0 mr-2">
      <!-- Checkbox Circle (Touch target >= 48px) -->
      <div
        class="w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 shrink-0 text-xl font-bold"
        :class="[
          task.is_completed
            ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 scale-105'
            : task.is_skipped
              ? 'bg-slate-200 text-slate-500'
              : 'border-2 border-slate-300 bg-slate-50 text-transparent hover:border-brand-400'
        ]"
      >
        <span v-if="task.is_completed">✓</span>
        <span v-else-if="task.is_skipped">⏭</span>
        <span v-else class="text-xs text-slate-300">○</span>
      </div>

      <!-- Task Details -->
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1">
          <!-- Subject Pill -->
          <span
            class="px-2 py-0.5 rounded-lg text-xs font-bold shrink-0 font-chinese"
            :class="subjectBadgeClass(task.subject)"
          >
            {{ task.subject }}
          </span>
          <span v-if="task.origin === 'adhoc'" class="px-2 py-0.5 rounded-lg text-xs font-black shrink-0 bg-orange-100 text-orange-700">
            临时
          </span>

          <!-- Task Title with child-friendly Chinese typography -->
          <h4
            class="text-lg font-bold text-slate-800 truncate max-w-full transition-colors font-chinese"
            :class="{ 'line-through text-slate-400': task.is_completed || task.is_skipped }"
          >
            {{ task.title }}
          </h4>
        </div>

        <!-- Weekly target frequency pill (每周完成特定次数) -->
        <div
          v-if="isWeeklyTask"
          class="mt-1 flex items-center gap-1.5 flex-wrap"
        >
          <span
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold"
            :class="[
              isWeeklyTargetMet
                ? 'bg-emerald-100 text-emerald-800 font-black'
                : 'bg-indigo-50 text-indigo-700 border border-indigo-200/60'
            ]"
          >
            <span>🎯</span>
            <span v-if="isWeeklyTargetMet">
              周目标 {{ task.weekly_target_times }}次 · 已达标 ({{ task.weekly_completed_times }}/{{ task.weekly_target_times }}) 🎉
            </span>
            <span v-else>
              周目标 {{ task.weekly_target_times }}次 · 本周已完成 {{ task.weekly_completed_times || 0 }}/{{ task.weekly_target_times }}
            </span>
            <span v-if="task.weekly_skipped_times">· 跳过 {{ task.weekly_skipped_times }} 次</span>
          </span>

          <!-- Flexible vs required today: times still needed against days left this week -->
          <span
            v-if="!isWeeklyTargetMet && !task.is_completed && !task.is_skipped && task.week_days_left"
            class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold"
            :class="task.is_optional ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-rose-600'"
          >
            <span v-if="task.is_optional">🌤️ 今天可选 · 本周还剩 {{ task.week_days_left }} 天，还差 {{ task.weekly_remaining_times }} 次</span>
            <span v-else>⏰ 今天要做 · 本周只剩 {{ task.week_days_left }} 天，还差 {{ task.weekly_remaining_times }} 次</span>
          </span>

          <!-- Mini progress dots -->
          <div class="flex items-center gap-0.5 ml-1">
            <span
              v-for="n in Math.min(task.weekly_target_times || 3, 7)"
              :key="n"
              class="w-2 h-2 rounded-full transition-colors"
              :class="n <= (task.weekly_completed_times || 0) ? 'bg-indigo-500' : n <= weeklyUsed ? 'bg-slate-400' : 'bg-slate-200'"
            ></span>
          </div>
        </div>

        <!-- Sub information / points -->
        <div class="mt-1 flex items-center gap-2 text-sm">
          <span
            class="font-extrabold flex items-center gap-1"
            :class="task.is_completed ? 'text-emerald-600' : task.is_skipped ? 'text-slate-400' : 'text-amber-500'"
          >
            <span>★</span>
            <span>{{ task.is_completed ? `已得 ${task.points}分` : task.is_skipped ? '跳过不得分' : `${task.points}分` }}</span>
          </span>
          <span v-if="task.is_completed" class="text-xs text-emerald-500 font-medium font-chinese">
            (今天已完成)
          </span>
          <!-- Skip: a child asks a parent; a parent skips at once -->
          <button
            v-if="canSkip"
            type="button"
            class="ml-auto px-2.5 py-1 min-h-[32px] rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-bold font-chinese active:scale-95"
            @click.stop="emit('skip', task)"
          >
            {{ asParent ? '⏭️ 跳过' : '🙋 今天没有？' }}
          </button>
        </div>

        <!-- Skip status: skipped, waiting for a parent, or turned down -->
        <div v-if="task.is_skipped" class="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-bold font-chinese">
          <span class="px-2 py-0.5 rounded-md bg-slate-200 text-slate-600">⏭️ 今天已跳过 · {{ task.skip_reason }}</span>
          <button v-if="asParent" type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-rose-500" @click.stop="emit('unskip', task)">
            撤销跳过
          </button>
        </div>
        <div v-else-if="skipPending" class="mt-1.5 flex flex-wrap items-center gap-2 text-xs font-bold font-chinese">
          <span class="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200/70">⏳ 申请跳过：{{ task.skip_request.reason }} · 等家长确认</span>
          <template v-if="asParent">
            <button type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-emerald-500 text-white" @click.stop="emit('approve-skip', task)">同意跳过</button>
            <button type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-white border border-slate-200 text-slate-600" @click.stop="emit('reject-skip', task)">不同意</button>
          </template>
          <button v-else type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-white border border-slate-200 text-slate-500" @click.stop="emit('cancel-skip', task)">撤回</button>
        </div>
        <div v-else-if="skipTurnedDown && !asParent" class="mt-1.5 text-xs font-bold text-rose-500 font-chinese">
          家长没有同意跳过，今天还是要完成哦
        </div>
      </div>
    </div>

    <!-- Right: Animated Check status icon or quick toggle hint -->
    <div class="shrink-0 text-right">
      <span
        v-if="task.is_completed"
        class="inline-block px-3 py-1 rounded-xl bg-emerald-100 text-emerald-700 text-xs font-bold font-chinese"
      >
        完成
      </span>
      <span
        v-else-if="task.is_skipped"
        class="inline-block px-3 py-1 rounded-xl bg-slate-200 text-slate-500 text-xs font-bold font-chinese"
      >
        已跳过
      </span>
      <span
        v-else
        class="inline-block px-3 py-1 rounded-xl bg-slate-100 text-slate-500 text-xs font-semibold hover:bg-brand-50 hover:text-brand-600 font-chinese"
      >
        待完成
      </span>
    </div>

    <!-- Floating Coin particles container -->
    <div
      v-for="particle in activeParticles"
      :key="particle.id"
      class="absolute pointer-events-none z-30 font-black text-amber-500 flex items-center gap-1 animate-coin"
      :style="{ left: particle.x + 'px', top: particle.y + 'px' }"
    >
      <span class="text-xl">💰</span>
      <span class="text-lg font-extrabold">+{{ task.points }}分</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { playTaskComplete, playTaskUncomplete } from '../utils/sound';

const props = defineProps({
  task: {
    type: Object,
    required: true
  },
  // The board is open with a parent session: skips take effect at once and requests can be settled here.
  asParent: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['toggle', 'skip', 'unskip', 'cancel-skip', 'approve-skip', 'reject-skip']);

const activeParticles = ref([]);

const isWeeklyTask = computed(() => {
  return props.task.schedule_type === 'weekly_times' || Boolean(props.task.weekly_target_times);
});

// Skipped times use up the weekly target just like completed ones.
const weeklyUsed = computed(() => (props.task.weekly_completed_times || 0) + (props.task.weekly_skipped_times || 0));
const isWeeklyTargetMet = computed(() => {
  if (!isWeeklyTask.value) return false;
  return weeklyUsed.value >= (props.task.weekly_target_times || 1);
});

const skipPending = computed(() => !props.task.is_completed && props.task.skip_request?.status === 'pending');
const skipTurnedDown = computed(() => !props.task.is_completed && ['rejected', 'revoked'].includes(props.task.skip_request?.status));
// Once a parent turned a request down, only the parent can still skip the task.
const canSkip = computed(() => !props.task.is_completed && !props.task.is_skipped && !skipPending.value &&
  (props.asParent || !skipTurnedDown.value));

function subjectBadgeClass(subject) {
  switch (subject) {
    case '语文':
      return 'bg-rose-100 text-rose-700';
    case '数学':
      return 'bg-blue-100 text-blue-700';
    case '英语':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return 'bg-amber-100 text-amber-800';
  }
}

function handleClick(event) {
  // A skipped task cannot be checked off until a parent takes the skip back.
  if (props.task.is_skipped) return;
  if (!props.task.is_completed) {
    // 播放任务打卡完成音
    playTaskComplete();

    // Generate floating coin animation particle
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left - 30, 20), rect.width - 100);
    const y = Math.max(event.clientY - rect.top - 20, 10);

    const particleId = Date.now() + Math.random();
    activeParticles.value.push({ id: particleId, x, y });

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
