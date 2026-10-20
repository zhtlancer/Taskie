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
        @click="appendDigit(digit)"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-3xl font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/40 active:scale-95 active:bg-brand-100 dark:active:bg-brand-900/40 transition-all flex items-center justify-center focus:outline-none"
      >
        {{ digit }}
      </button>

      <!-- Clear Button -->
      <button
        type="button"
        @click="clearPin"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-lg font-bold text-slate-500 dark:text-slate-400 shadow-sm hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all flex items-center justify-center focus:outline-none"
      >
        清空
      </button>

      <!-- 0 -->
      <button
        type="button"
        @click="appendDigit('0')"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-3xl font-bold text-slate-700 dark:text-slate-200 shadow-sm hover:border-brand-300 dark:hover:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-900/40 active:scale-95 active:bg-brand-100 dark:active:bg-brand-900/40 transition-all flex items-center justify-center focus:outline-none"
      >
        0
      </button>

      <!-- Backspace Button -->
      <button
        type="button"
        @click="deleteDigit"
        class="min-w-[68px] min-h-[68px] h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-2xl font-bold text-slate-600 dark:text-slate-300 shadow-sm hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all flex items-center justify-center focus:outline-none"
      >
        ⌫
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { playClick } from '../utils/sound';

const props = defineProps({
  maxLength: {
    type: Number,
    default: 4
  },
  errorMessage: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['complete', 'change']);

const pin = ref('');
const hasError = ref(false);

watch(() => props.errorMessage, (newVal) => {
  if (newVal) {
    hasError.value = true;
    setTimeout(() => {
      hasError.value = false;
      pin.value = '';
    }, 700);
  }
});

function appendDigit(d) {
  if (pin.value.length >= props.maxLength) return;
  playClick();
  pin.value += d;
  emit('change', pin.value);

  if (pin.value.length === props.maxLength) {
    emit('complete', pin.value);
  }
}

function deleteDigit() {
  if (pin.value.length > 0) {
    playClick();
    pin.value = pin.value.slice(0, -1);
    emit('change', pin.value);
  }
}

function clearPin() {
  playClick();
  pin.value = '';
  emit('change', pin.value);
}

defineExpose({
  clear: clearPin
});
</script>
