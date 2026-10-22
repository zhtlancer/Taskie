<template>
  <!-- Choosing how long to rest: the study timer pauses first, and rest never counts as study time. -->
  <UiDialog v-if="store.picking" title="☕ 休息一下" :busy="timerStore.busy" @close="store.picking = false">
    <p class="text-sm text-slate-600 dark:text-slate-300 mb-4">学习计时会先暂停，休息的时间不算学习用时。休息结束时这台设备会响铃提醒。</p>
    <p v-if="pickError" role="alert" class="mb-3 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ pickError }}</p>
    <div class="grid grid-cols-3 gap-2">
      <button v-for="minutes in REST_MINUTES" :key="minutes" type="button" :disabled="timerStore.busy"
        class="min-h-[56px] rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-black disabled:opacity-50"
        @click="choose(minutes)">{{ minutes }} 分钟</button>
    </div>
  </UiDialog>

  <!-- The countdown itself; closing only tucks it into the timer bar. -->
  <UiDialog v-else-if="store.rest && !store.minimized" :title="finished ? '⏰ 休息结束' : '☕ 休息中'" :busy="resuming" close-label="收起" @close="store.minimized = true">
    <div class="text-center space-y-4">
      <p v-if="resumeError" role="alert" class="text-xs font-bold text-rose-600 dark:text-rose-300">{{ resumeError }}</p>
      <template v-if="resumeChoice">
        <p role="alert" class="text-sm font-bold text-amber-700 dark:text-amber-300">计时任务已变化，现在是「{{ resumeChoice.label }}」。要继续这项任务吗？</p>
        <div class="flex flex-wrap justify-center gap-2">
          <button type="button" :disabled="resuming" class="min-h-[44px] px-4 rounded-xl bg-violet-500 text-white font-bold" @click="resume(true)">继续「{{ resumeChoice.label }}」计时</button>
          <button type="button" :disabled="resuming" class="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="resumeChoice = null">暂不继续</button>
        </div>
      </template>
      <template v-else-if="!finished">
        <p data-rest-clock class="text-6xl font-black tabular-nums text-emerald-600 dark:text-emerald-300" role="timer" :aria-label="`休息还剩 ${clock}`">{{ clock }}</p>
        <p class="text-sm text-slate-500 dark:text-slate-400">休息 {{ store.rest.minutes }} 分钟，起来走一走、喝点水吧。</p>
        <button type="button" class="min-h-[44px] px-5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200" @click="endEarly">提前结束休息</button>
      </template>
      <template v-else>
        <p class="text-5xl" aria-hidden="true">⏰</p>
        <p role="status" class="text-lg font-black text-slate-800 dark:text-slate-100">休息结束，回来继续吧！</p>
        <div class="flex flex-wrap justify-center gap-2">
          <button v-if="pausedTimer" type="button" :disabled="timerStore.busy || resuming" class="min-h-[44px] px-5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-sm font-bold disabled:opacity-50" @click="resume()">▶ 继续计时</button>
          <button type="button" :disabled="timerStore.busy || resuming" class="min-h-[44px] px-5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200" @click="store.end()">知道了</button>
        </div>
      </template>
    </div>
  </UiDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import UiDialog from './UiDialog.vue';
import { useRestStore } from '../stores/rest.js';
import { useRunningTimerStore } from '../stores/runningTimer.js';
import { REST_MINUTES, restSecondsLeft, restTarget, sameRestTarget } from '../utils/rest.js';
import { formatClock } from '../utils/taskTimer.js';
import { playClick, playRestEnd } from '../utils/sound';

const props = defineProps({
  childId: { type: String, required: true },
  now: { type: Number, required: true }
});
const store = useRestStore();
const timerStore = useRunningTimerStore();
const pickError = ref(''), resumeError = ref('');
const resuming = ref(false), resumeChoice = ref(null);

const secondsLeft = computed(() => (store.rest ? restSecondsLeft(store.rest, props.now) : 0));
const finished = computed(() => Boolean(store.rest) && secondsLeft.value === 0);
const clock = computed(() => formatClock(secondsLeft.value));
const pausedTimer = computed(() => timerStore.childId === props.childId && timerStore.timer && !timerStore.timer.timer_running);

watch(() => props.childId, id => store.load(id), { immediate: true });
watch(() => store.rest, () => { resumeChoice.value = null; resumeError.value = ''; });
watch(() => store.resumeRequested, () => resume());
// Ring once when the countdown reaches zero, and bring the dialog back even if it was tucked away.
let rungFor = null;
watch(finished, done => {
  if (!done || rungFor === store.rest.ends_at) return;
  rungFor = store.rest.ends_at;
  store.minimized = false;
  resumeError.value = '';
  playRestEnd();
  navigator.vibrate?.([300, 150, 300]);
}, { immediate: true });

async function choose(minutes) {
  playClick();
  pickError.value = '';
  const target = timerStore.childId === props.childId ? restTarget(timerStore.timer) : null;
  if (timerStore.childId === props.childId && timerStore.timer?.timer_running) {
    await timerStore.pause();
    if (timerStore.error || timerStore.timer?.timer_running || !sameRestTarget(target, timerStore.timer)) { pickError.value = timerStore.error || '计时目标已变化，请核对后重试'; return; }
  }
  store.start(minutes, target);
}

function endEarly() {
  playClick();
  store.end();
}

async function resume(confirmed = false) {
  if (resuming.value || timerStore.busy || !store.rest) return;
  playClick();
  resumeError.value = '';
  const childId = props.childId, rest = store.rest;
  const expected = confirmed ? resumeChoice.value?.target : rest.target;
  resuming.value = true;
  try {
    if (!await timerStore.refresh(childId)) { resumeError.value = '无法核对当前计时，请检查网络后重试'; return; }
    if (props.childId !== childId || store.rest !== rest) return;
    const timer = timerStore.timer;
    if (!timer || timer.timer_running) { resumeChoice.value = null; resumeError.value = '当前没有暂停的计时，请回到任务里查看'; return; }
    if (!sameRestTarget(expected, timer)) {
      resumeChoice.value = { target: restTarget(timer), label: `${timer.subject} · ${timer.title}` };
      return;
    }
    // The server still validates this exact target if another device changes it after our read.
    await timerStore.resume();
    if (!timerStore.error && sameRestTarget(expected, timerStore.timer) && timerStore.timer?.timer_running) store.end();
    else resumeError.value = timerStore.error || '没有继续成功，请核对当前任务后重试';
  } finally { resuming.value = false; }
}
</script>
