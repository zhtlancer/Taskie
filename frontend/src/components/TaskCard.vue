<template>
  <div
    class="relative select-none rounded-2xl border-2 p-3.5 transition-all duration-200 cursor-pointer flex items-center justify-between min-h-[96px] shadow-sm overflow-hidden"
    :class="[
      task.is_completed
        ? 'bg-emerald-50/90 border-emerald-400 shadow-emerald-100/50'
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
            : 'border-2 border-slate-300 bg-slate-50 text-transparent hover:border-brand-400'
        ]"
      >
        <span v-if="task.is_completed">✓</span>
        <span v-else class="text-xs text-slate-300">○</span>
      </div>

      <!-- Task Details -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <!-- Subject Pill -->
          <span
            class="px-2 py-0.5 rounded-lg text-xs font-bold shrink-0 font-chinese"
            :class="subjectBadgeClass(task.subject)"
          >
            {{ task.subject }}
          </span>

          <!-- Task Title with child-friendly Chinese typography -->
          <h4
            class="text-lg font-bold text-slate-800 truncate transition-colors font-chinese"
            :class="{ 'line-through text-slate-400': task.is_completed }"
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
          </span>

          <!-- Mini progress dots -->
          <div class="flex items-center gap-0.5 ml-1">
            <span
              v-for="n in Math.min(task.weekly_target_times || 3, 7)"
              :key="n"
              class="w-2 h-2 rounded-full transition-colors"
              :class="n <= (task.weekly_completed_times || 0) ? 'bg-indigo-500' : 'bg-slate-200'"
            ></span>
          </div>
        </div>

        <!-- Sub information / points -->
        <div class="mt-1 flex items-center gap-2 text-sm">
          <span
            class="font-extrabold flex items-center gap-1"
            :class="task.is_completed ? 'text-emerald-600' : 'text-amber-500'"
          >
            <span>★</span>
            <span>{{ task.is_completed ? `已得 ${task.points}分` : `${task.points}分` }}</span>
          </span>
          <span v-if="task.is_completed" class="text-xs text-emerald-500 font-medium font-chinese">
            (今天已完成)
          </span>
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
  }
});

const emit = defineEmits(['toggle']);

const activeParticles = ref([]);

const isWeeklyTask = computed(() => {
  return props.task.schedule_type === 'weekly_times' || Boolean(props.task.weekly_target_times);
});

const isWeeklyTargetMet = computed(() => {
  if (!isWeeklyTask.value) return false;
  const target = props.task.weekly_target_times || 1;
  const current = props.task.weekly_completed_times || 0;
  return current >= target;
});

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
