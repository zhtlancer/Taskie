<template>
  <div class="flex flex-col items-center select-none w-full max-w-sm mx-auto">
    <!-- Pin indicator dots -->
    <div
      class="flex justify-center items-center gap-4 my-6"
      :class="{ 'animate-flame-wiggle text-red-500 dark:text-red-400': hasError }"
    >
      <div
        v-for="i in maxLength"
        :key="i"
        class="w-5 h-5 rounded-full border-2 transition-all duration-200"
        :class="[
          i <= pin.length
            ? (hasError ? 'bg-red-500 border-red-500 scale-110' : 'bg-brand-500 border-brand-500 scale-110')
            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'
        ]"
      ></div>
    </div>

    <!-- Error message text -->
    <div v-if="errorMessage" class="h-6 text-sm font-bold text-red-500 dark:text-red-400 mb-2 transition-opacity">
      {{ errorMessage }}
    </div>
    <div v-else class="h-6 mb-2"></div>

    <!-- 3x4 Number Keypad (Buttons >= 64px for iPad touch friendliness) -->
    <div class="grid grid-cols-3 gap-4 w-full">
      <button
        v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
        :key="digit"
        type="button"
        :disabled="disabled || hasError"
        @click="appendDigit(digit)"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-3xl font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/40 active:scale-95 active:bg-brand-100 dark:active:bg-brand-900/40 disabled:opacity-70 transition-all flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        {{ digit }}
      </button>

      <!-- Clear Button -->
      <button
        type="button"
        :disabled="disabled || hasError"
        @click="clearPin()"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-lg font-bold text-slate-500 dark:text-slate-400 shadow-sm hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 disabled:opacity-70 transition-all flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        清空
      </button>

      <!-- 0 -->
      <button
        type="button"
        :disabled="disabled || hasError"
        @click="appendDigit('0')"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-3xl font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/40 active:scale-95 active:bg-brand-100 dark:active:bg-brand-900/40 disabled:opacity-70 transition-all flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        0
      </button>

      <!-- Backspace Button -->
      <button
        type="button"
        aria-label="退格"
        :disabled="disabled || hasError"
        @click="deleteDigit"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-2xl font-bold text-slate-600 dark:text-slate-300 shadow-sm hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 disabled:opacity-70 transition-all flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        ⌫
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { playClick } from '../utils/sound';
import { pinKeyAction } from '../utils/pinKey';

const props = defineProps({
  maxLength: {
    type: Number,
    default: 4
  },
  errorMessage: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['complete', 'change']);

const pin = ref('');
const hasError = ref(false);
let errorTimer = null;

watch(() => props.errorMessage, (newVal) => {
  if (newVal) {
    clearTimeout(errorTimer);
    hasError.value = true;
    errorTimer = setTimeout(() => {
      hasError.value = false;
      pin.value = '';
      errorTimer = null;
    }, 700);
  }
});

function appendDigit(d) {
  if (props.disabled || hasError.value || pin.value.length >= props.maxLength) return;
  playClick();
  pin.value += d;
  emit('change', pin.value);

  if (pin.value.length === props.maxLength) {
    emit('complete', pin.value);
  }
}

function deleteDigit() {
  if (props.disabled || hasError.value) return;
  if (pin.value.length > 0) {
    playClick();
    pin.value = pin.value.slice(0, -1);
    emit('change', pin.value);
  }
}

function clearPin(silent = false) {
  const quiet = silent === true;
  if (!quiet && (props.disabled || hasError.value)) return;
  if (!quiet) playClick();
  if (quiet) {
    clearTimeout(errorTimer);
    errorTimer = null;
    hasError.value = false;
  }
  pin.value = '';
  emit('change', pin.value);
}

function onKeydown(event) {
  if (props.disabled || hasError.value) return;
  const action = pinKeyAction(event);
  if (!action) return;
  event.preventDefault();
  if (action.type === 'digit') appendDigit(action.value);
  else if (action.type === 'backspace') deleteDigit();
  else if (action.type === 'clear') clearPin();
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => {
  clearTimeout(errorTimer);
  window.removeEventListener('keydown', onKeydown);
});

defineExpose({
  clear: () => clearPin(true)
});
</script>
