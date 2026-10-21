<template>
  <!-- The child's running timer, kept in view on every page: tap it to reopen the task, or pause it. -->
  <section v-if="timer && variant === 'sidebar'" aria-label="正在计时" class="rounded-2xl p-3 space-y-2 text-white shadow-sm" :class="long ? 'bg-amber-500 dark:bg-amber-600' : 'bg-violet-500 dark:bg-violet-600'">
    <button type="button" class="block w-full min-h-[44px] text-left" @click="open">
      <span class="flex items-center gap-1.5 text-xs font-bold text-white/80"><span class="w-1.5 h-1.5 rounded-full bg-white motion-safe:animate-pulse"></span>计时中</span>
      <span class="block mt-0.5 text-sm font-bold font-chinese truncate">{{ label }}</span>
      <span data-running-clock class="block text-2xl font-black tabular-nums">{{ clock }}</span>
    </button>
    <p v-if="long" class="text-xs font-bold">已经计时很久了，是不是忘了暂停？</p>
    <button type="button" class="w-full min-h-[44px] rounded-xl bg-white/20 hover:bg-white/30 text-sm font-bold disabled:opacity-60" :disabled="store.pausing" @click="pause">⏸ 暂停</button>
  </section>
  <div v-else-if="timer" class="lg:hidden fixed inset-x-0 z-40 bottom-[calc(61px+env(safe-area-inset-bottom))] px-3 pb-2 pointer-events-none">
    <section aria-label="正在计时" class="pointer-events-auto max-w-xl mx-auto flex items-center gap-2 rounded-2xl pl-3 pr-1.5 py-1 text-white shadow-lg" :class="long ? 'bg-amber-500 dark:bg-amber-600' : 'bg-violet-500 dark:bg-violet-600'">
      <button type="button" class="flex-1 min-w-0 min-h-[44px] flex items-center gap-2 text-left" @click="open">
        <span class="shrink-0 w-2 h-2 rounded-full bg-white motion-safe:animate-pulse"></span>
        <span class="min-w-0 flex-1 truncate text-sm font-bold font-chinese">{{ long ? '忘了暂停？' : '' }}{{ label }}</span>
        <span data-running-clock class="shrink-0 text-base font-black tabular-nums">{{ clock }}</span>
      </button>
      <button type="button" class="shrink-0 min-h-[44px] px-3 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-bold disabled:opacity-60" :disabled="store.pausing" @click="pause">⏸ 暂停</button>
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
const seconds = computed(() => Math.min(MAX_TIMER_SECONDS, liveSeconds(timer.value, props.now)));
const clock = computed(() => formatClock(seconds.value));
const long = computed(() => seconds.value > LONG_TIMER_SECONDS);
const label = computed(() => `${timer.value.subject} · ${timer.value.title}`);

function open() {
  playClick();
  router.push({ path: `/child/${props.childId}/today`, query: timerTarget(timer.value) });
}
function pause() {
  playClick();
  store.pause();
}
</script>
