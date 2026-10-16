<template>
  <!-- Timer of a timed task: start, pause and resume, or clear; with an expected time, the time left.
       Only the buttons stop the click, so tapping the rest of a task card still checks it off. -->
  <div class="flex flex-wrap items-center gap-1.5 text-xs font-bold font-chinese">
    <template v-if="!item.timer_running && seconds === 0">
      <button type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 active:scale-95" @click.stop="$emit('start')">
        ⏱ 开始计时
      </button>
      <span v-if="item.expected_minutes" class="text-slate-400">预计 {{ item.expected_minutes }} 分钟</span>
    </template>
    <template v-else>
      <span
        class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg tabular-nums text-sm font-black"
        :class="item.timer_running ? 'bg-violet-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600'"
      >
        <span v-if="item.timer_running" class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
        {{ formatClock(seconds) }}
      </span>
      <button v-if="item.timer_running" type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-white border border-slate-200 text-slate-600 active:scale-95" @click.stop="$emit('pause')">⏸ 暂停</button>
      <template v-else>
        <button type="button" class="px-2.5 py-1 min-h-[32px] rounded-lg bg-violet-50 hover:bg-violet-100 text-violet-700 active:scale-95" @click.stop="$emit('start')">▶ 继续</button>
        <button type="button" class="px-2 py-1 min-h-[32px] rounded-lg text-slate-400 hover:text-rose-500" title="清零重新计时" @click.stop="$emit('reset')">↺ 清零</button>
      </template>
      <span v-if="pace" :class="pace.over ? 'text-rose-500' : 'text-slate-400'">{{ pace.text }}</span>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatClock, liveSeconds, paceLabel } from '../utils/taskTimer.js';

const props = defineProps({
  item: { type: Object, required: true },
  now: { type: Number, required: true }
});
defineEmits(['start', 'pause', 'reset']);

const seconds = computed(() => liveSeconds(props.item, props.now));
const pace = computed(() => paceLabel(seconds.value, props.item.expected_minutes));
</script>
