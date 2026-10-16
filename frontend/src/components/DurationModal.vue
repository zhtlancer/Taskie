<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="$emit('close')">
    <form class="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border-2 border-violet-100 space-y-4" @submit.prevent="submit">
      <div>
        <h3 class="text-xl font-black text-slate-800 font-chinese">⏱ {{ editing ? '修改用时' : '用了多久？' }}</h3>
        <p class="mt-1 text-sm font-bold text-slate-500 font-chinese truncate">{{ title }}</p>
        <p v-if="note" class="mt-2 px-3 py-2 rounded-xl bg-amber-50 text-amber-700 text-xs font-bold">{{ note }}</p>
        <p v-else-if="!editing" class="mt-1 text-xs font-bold text-slate-400">填一下大概用了多久，不填也可以。</p>
      </div>

      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ error }}</p>

      <div>
        <div class="grid grid-cols-3 gap-2 mb-2">
          <button
            v-for="option in quickMinutes"
            :key="option"
            type="button"
            class="py-2.5 rounded-xl text-sm font-bold border active:scale-95"
            :class="minutes === option ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-slate-200 text-slate-600'"
            @click="minutes = option"
          >
            {{ option }} 分钟
          </button>
        </div>
        <label class="flex items-center gap-2 text-xs font-bold text-slate-600">
          <span>自己填</span>
          <input
            v-model.number="minutes"
            type="number"
            min="1"
            max="720"
            inputmode="numeric"
            class="w-24 px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-center focus:border-violet-500 outline-none"
          />
          <span>分钟</span>
        </label>
      </div>

      <div class="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-100">
        <button type="button" class="mr-auto px-3 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100" @click="$emit('close')">取消</button>
        <button v-if="!editing" type="button" :disabled="busy" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50" @click="$emit('submit', null)">
          不填，直接完成
        </button>
        <button v-else-if="initialSeconds" type="button" :disabled="busy" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50" @click="$emit('submit', null)">
          清除用时
        </button>
        <button type="submit" :disabled="busy || !valid" class="px-6 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold shadow-sm disabled:opacity-50">
          {{ busy ? '保存中...' : editing ? '保存' : '完成' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

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

const quickMinutes = [10, 15, 20, 30, 45, 60];
const minutes = ref(props.initialSeconds ? Math.max(1, Math.round(props.initialSeconds / 60)) : null);
const valid = computed(() => Number.isInteger(minutes.value) && minutes.value >= 1 && minutes.value <= 720);

function submit() {
  if (valid.value) emit('submit', minutes.value * 60);
}
</script>
