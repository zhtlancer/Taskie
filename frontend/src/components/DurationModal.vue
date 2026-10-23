<template>
  <UiDialog :title="editing ? '⏱ 修改用时' : '⏱ 用了多久？'" :busy="busy" @close="emit('close')">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <p class="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400 font-chinese truncate">{{ title }}</p>
        <p v-if="note" class="mt-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold">{{ note }}</p>
        <p v-else-if="!editing" class="mt-1 text-xs font-bold text-slate-400">填一下大概用了多久，不填也可以。</p>
      </div>

      <p v-if="error" role="alert" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div>
        <div class="grid grid-cols-3 gap-2 mb-2">
          <button
            v-for="option in quickMinutes"
            :key="option"
            type="button"
            :disabled="busy" class="min-h-[44px] min-w-[44px] py-2.5 rounded-xl text-sm font-bold border active:scale-95"
            :class="minutes === option ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="minutes = option"
          >
            {{ option }} 分钟
          </button>
        </div>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
          <span>自己填</span>
          <input
            v-model.number="minutes"
            :disabled="busy"
            :autofocus="typingFirst"
            type="number"
            min="1"
            max="720"
            inputmode="numeric"
            class="w-24 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-center focus:border-violet-500 outline-none"
          />
          <span>分钟</span>
        </label>
      </div>

      <div class="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button type="button" class="min-h-[44px] min-w-[44px] mr-auto px-3 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" :disabled="busy" @click="emit('close')">取消</button>
        <button v-if="!editing" type="button" :disabled="busy" class="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50" @click="$emit('submit', null)">
          不填，直接完成
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
import { computed, ref } from 'vue';
import { prefersTyping } from '../utils/pointer.js';

const props = defineProps({
  title: { type: String, required: true },
  // Prefilled duration in seconds (the timer, the expected time, or the duration being edited).
  initialSeconds: { type: Number, default: null },
  editing: { type: Boolean, default: false },
  note: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
const emit = defineEmits(['close', 'submit']);
const typingFirst = prefersTyping();

const quickMinutes = [10, 15, 20, 30, 45, 60];
const minutes = ref(props.initialSeconds ? Math.max(1, Math.round(props.initialSeconds / 60)) : null);
const valid = computed(() => Number.isInteger(minutes.value) && minutes.value >= 1 && minutes.value <= 720);

function submit() {
  if (!props.busy && valid.value) emit('submit', minutes.value * 60);
}
</script>
