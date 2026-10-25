<template>
  <UiDialog :title="editing ? '⏱ 修改用时' : '⏱ 用了多久？'" :busy="busy" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <p class="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400 font-chinese truncate">{{ title }}</p>
        <p v-if="note" class="mt-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold">{{ note }}</p>
        <p v-else-if="!editing" class="mt-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-sm">这项任务当前没有计时记录，可以拖动下方滑条补填实际用时，也可以不填直接完成。</p>
      </div>

      <p v-if="error" role="alert" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div>
        <div class="mb-4 rounded-xl bg-violet-50 dark:bg-violet-950/40 p-3">
          <label :for="sliderId" class="flex justify-between gap-3 text-sm font-bold">
            <span>{{ additive && recordedSeconds > 0 ? '调整后累计用时' : '实际用时' }}</span><output :for="sliderId" class="text-violet-700 dark:text-violet-300 tabular-nums">{{ formatTime(selectedSeconds) }}</output>
          </label>
          <div class="relative mt-1">
            <input :id="sliderId" type="range" :min="minimumSeconds" :max="sliderMaxSeconds" :value="selectedSeconds" :step="additive ? 1 : 60" :disabled="busy" @input="selectedSeconds = Number($event.target.value)"
              class="duration-range relative z-10 block w-full min-h-[44px] cursor-pointer disabled:opacity-50" :style="{ '--fill': thumbCenter(selectedSeconds ?? minimumSeconds) }" />
            <span v-if="expectedInRange" aria-hidden="true" class="absolute top-[37px] h-1.5 w-0.5 -translate-x-1/2 bg-violet-500" :style="{ left: thumbCenter(expectedMinutes * 60) }"></span>
          </div>
          <div class="flex justify-between text-xs text-slate-500 dark:text-slate-400"><span>{{ formatTime(minimumSeconds) }}</span><span>{{ formatTime(sliderMaxSeconds) }}</span></div>
          <p v-if="expectedMinutes" class="mt-2 text-xs text-violet-700 dark:text-violet-300">预计用时 {{ expectedMinutes }} 分钟，请按实际情况调整。</p>
        </div>
        <div class="grid grid-cols-3 gap-2 mb-2">
          <button
            v-for="option in quickMinutes"
            :key="option"
            type="button"
            :disabled="busy || option * 60 < minimumSeconds" class="min-h-[44px] min-w-[44px] py-2.5 rounded-xl text-sm font-bold border active:scale-95 disabled:opacity-40"
            :class="selectedSeconds === option * 60 ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="selectedSeconds = Math.max(minimumSeconds, option * 60)"
          >
            {{ option }} 分钟
          </button>
        </div>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
          <span>自己填</span>
          <input
            :value="selectedSeconds === null ? '' : Number((selectedSeconds / 60).toFixed(3))"
            :disabled="busy"
            type="number"
            :min="Number((minimumSeconds / 60).toFixed(3))"
            :max="Number((maximumSeconds / 60).toFixed(3))"
            :step="additive ? 'any' : '1'"
            inputmode="numeric"
            @input="selectedSeconds = $event.target.value === '' ? null : Math.round(Number($event.target.value) * 60)"
            class="w-24 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-center focus:border-violet-500 outline-none"
          />
          <span>分钟</span>
        </label>
      </div>

      <div class="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button type="button" class="min-h-[44px] min-w-[44px] mr-auto px-3 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" :disabled="busy" @click="emit('close')">取消</button>
        <button v-if="!editing" type="button" :disabled="busy" class="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" @click="$emit('submit', null)">
          {{ additive && recordedSeconds > 0 ? '保持已有用时，直接完成' : '不填，直接完成' }}
        </button>
        <button v-else-if="initialSeconds" type="button" :disabled="busy" class="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" @click="$emit('submit', null)">
          清除用时
        </button>
        <button type="submit" :disabled="busy || !valid" class="min-h-[44px] min-w-[44px] px-6 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold shadow-sm disabled:opacity-50">
          {{ busy ? '保存中...' : editing ? '保存' : '完成' }}
        </button>
      </div>
    </form>
  </UiDialog>
</template>

<script setup>
import UiDialog from './UiDialog.vue';
import { computed, ref, useId } from 'vue';

const props = defineProps({
  title: { type: String, required: true },
  // Prefilled duration in seconds (the timer, the expected time, or the duration being edited).
  initialSeconds: { type: Number, default: null },
  expectedMinutes: { type: Number, default: null },
  additive: { type: Boolean, default: false },
  recordedSeconds: { type: Number, default: 0 },
  editing: { type: Boolean, default: false },
  note: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
const emit = defineEmits(['close', 'submit']);
const sliderId = useId();

const quickMinutes = [10, 15, 20, 30, 45, 60];
const minimumSeconds = computed(() => props.additive && props.recordedSeconds > 0 ? props.recordedSeconds : 60);
const maximumSeconds = computed(() => (props.additive ? props.recordedSeconds : 0) + 43200);
const selectedSeconds = ref(props.additive && props.recordedSeconds > 0 ? props.recordedSeconds
  : props.initialSeconds ? Math.max(60, Math.round(props.initialSeconds / 60) * 60) : (props.expectedMinutes || 15) * 60);
const sliderMaxSeconds = computed(() => Math.min(maximumSeconds.value, Math.max((props.additive ? props.recordedSeconds : 0) + 7200,
  Math.ceil(Math.max(selectedSeconds.value || 0, props.initialSeconds || 0, (props.expectedMinutes || 0) * 60) / 1800) * 1800)));
const valid = computed(() => Number.isSafeInteger(selectedSeconds.value) && (props.additive || selectedSeconds.value % 60 === 0) && selectedSeconds.value >= minimumSeconds.value && selectedSeconds.value <= maximumSeconds.value);

// The thumb is THUMB px wide and travels inside the track, so a value's position is offset by half of it.
const THUMB = 28;
const expectedInRange = computed(() => props.expectedMinutes && props.expectedMinutes * 60 >= minimumSeconds.value && props.expectedMinutes * 60 <= sliderMaxSeconds.value);
function thumbCenter(seconds) {
  const span = sliderMaxSeconds.value - minimumSeconds.value;
  const ratio = span > 0 ? Math.max(0, Math.min(1, (seconds - minimumSeconds.value) / span)) : 0;
  return `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${ratio})`;
}
function formatTime(seconds) { if (seconds === null) return '—'; const minutes = Math.floor(seconds / 60), remainder = seconds % 60; return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`; }

function submit() {
  if (!props.busy && valid.value) emit('submit', selectedSeconds.value);
}
</script>

<style scoped>
.duration-range { appearance: none; -webkit-appearance: none; background: transparent; }
.duration-range:focus { outline: none; }
.duration-range:focus-visible { outline: 2px solid #8b5cf6; outline-offset: 2px; border-radius: 9999px; }
.duration-range::-webkit-slider-runnable-track { height: 8px; border-radius: 9999px; background: linear-gradient(to right, #7c3aed var(--fill), #ddd6fe var(--fill)); }
.duration-range::-moz-range-track { height: 8px; border-radius: 9999px; background: linear-gradient(to right, #7c3aed var(--fill), #ddd6fe var(--fill)); }
.duration-range::-webkit-slider-thumb { -webkit-appearance: none; box-sizing: border-box; width: 28px; height: 28px; margin-top: -10px; border-radius: 9999px; border: 3px solid #fff; background: #7c3aed; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3); }
.duration-range::-moz-range-thumb { box-sizing: border-box; width: 28px; height: 28px; border-radius: 9999px; border: 3px solid #fff; background: #7c3aed; box-shadow: 0 1px 3px rgb(0 0 0 / 0.3); }
.dark .duration-range::-webkit-slider-runnable-track { background: linear-gradient(to right, #8b5cf6 var(--fill), #334155 var(--fill)); }
.dark .duration-range::-moz-range-track { background: linear-gradient(to right, #8b5cf6 var(--fill), #334155 var(--fill)); }
.dark .duration-range::-webkit-slider-thumb { border-color: #0f172a; background: #8b5cf6; }
.dark .duration-range::-moz-range-thumb { border-color: #0f172a; background: #8b5cf6; }
</style>
