<template>
  <!-- The child's current timer, kept in view on every page: tap it to reopen the task, pause it, or
       resume it once paused. -->
  <section v-if="timer && variant === 'sidebar'" :aria-label="regionLabel" class="rounded-2xl p-3 space-y-2 shadow-sm" :class="tone">
    <button type="button" class="block w-full min-h-[44px] text-left" @click="open">
      <span class="flex items-center gap-1.5 text-xs font-bold" :class="running ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'">
        <span v-if="running" class="w-1.5 h-1.5 rounded-full bg-white motion-safe:animate-pulse"></span>{{ running ? '计时中' : '⏸ 已暂停' }}
      </span>
      <span class="block mt-0.5 text-sm font-bold font-chinese truncate">{{ label }}</span>
      <span data-running-clock class="block text-2xl font-black tabular-nums">{{ clock }}</span>
    </button>
    <p v-if="long" class="text-xs font-bold">已经计时很久了，是不是忘了暂停？</p>
    <p v-if="store.error" role="alert" class="text-xs font-bold" :class="running ? '' : 'text-rose-600 dark:text-rose-300'">{{ store.error }}</p>
    <button type="button" class="w-full min-h-[44px] rounded-xl text-sm font-bold disabled:opacity-60" :class="actionTone" :disabled="store.busy" @click="toggle">{{ action }}</button>
  </section>
  <div v-else-if="timer" class="lg:hidden fixed inset-x-0 z-40 bottom-[calc(61px+env(safe-area-inset-bottom))] px-3 pb-2 pointer-events-none">
    <p v-if="store.error" role="alert" class="pointer-events-auto max-w-xl mx-auto mb-1 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-300 text-xs font-bold shadow">{{ store.error }}</p>
    <section :aria-label="regionLabel" class="pointer-events-auto max-w-xl mx-auto flex items-center gap-2 rounded-2xl pl-3 pr-1.5 py-1 shadow-lg" :class="tone">
      <button type="button" class="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 text-left" @click="open">
        <span v-if="running" class="shrink-0 w-2 h-2 rounded-full bg-white motion-safe:animate-pulse"></span>
        <span v-else class="shrink-0 text-xs font-bold text-slate-500 dark:text-slate-400">已暂停</span>
        <span class="min-w-0 flex-1 truncate text-sm font-bold font-chinese">{{ long ? '忘了暂停？' : '' }}{{ label }}</span>
        <span data-running-clock class="shrink-0 text-base font-black tabular-nums">{{ clock }}</span>
      </button>
      <button type="button" class="shrink-0 min-h-[44px] px-3 rounded-xl text-sm font-bold disabled:opacity-60" :class="actionTone" :disabled="store.busy" @click="toggle">{{ action }}</button>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useRunningTimerStore } from '../stores/runningTimer.js';
import { LONG_TIMER_SECONDS, MAX_TIMER_SECONDS, formatClock, liveSeconds, timerTarget } from '../utils/taskTimer.js';
import { playClick } from '../utils/sound';

const props = defineProps({
  childId: { type: String, required: true },
  // sidebar: a card in the tablet sidebar; bar: a strip above the phone tab bar.
  variant: { type: String, default: 'bar' },
  now: { type: Number, required: true }
});
const router = useRouter();
const store = useRunningTimerStore();
const timer = computed(() => store.childId === props.childId ? store.timer : null);
const running = computed(() => timer.value.timer_running);
const seconds = computed(() => Math.min(MAX_TIMER_SECONDS, liveSeconds(timer.value, props.now)));
const clock = computed(() => formatClock(seconds.value));
const long = computed(() => running.value && seconds.value > LONG_TIMER_SECONDS);
const label = computed(() => `${timer.value.subject} · ${timer.value.title}`);
const regionLabel = computed(() => running.value ? '正在计时' : '计时已暂停');
const action = computed(() => running.value ? '⏸ 暂停' : '▶ 继续');
const tone = computed(() => !running.value
  ? 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
  : long.value ? 'bg-amber-500 dark:bg-amber-600 text-white' : 'bg-violet-500 dark:bg-violet-600 text-white');
const actionTone = computed(() => running.value ? 'bg-white/20 hover:bg-white/30' : 'bg-violet-500 hover:bg-violet-600 text-white');

function open() {
  playClick();
  router.push({ path: `/child/${props.childId}/today`, query: timerTarget(timer.value) });
}
function toggle() {
  playClick();
  if (running.value) store.pause();
  else store.resume();
}
</script>
