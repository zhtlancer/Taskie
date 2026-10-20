<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="$emit('close')">
    <form class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border-2 border-sky-100 dark:border-sky-800 space-y-4" @submit.prevent="submit">
      <div>
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 font-chinese">{{ asParent ? '⏭️ 跳过这项任务' : '🙋 今天没有这项任务？' }}</h3>
        <p class="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400 font-chinese truncate">{{ task.subject }} · {{ task.title }}</p>
        <p class="mt-1 text-xs font-bold text-slate-400">
          {{ asParent ? '跳过后这项任务今天不用完成，也不会得分，不影响全勤和连续打卡。' : '写下理由，家长同意后今天就不用做了，不影响全勤和连续打卡。' }}
        </p>
      </div>

      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">理由（必填）</label>
        <div class="flex flex-wrap gap-2 mb-2">
          <button
            v-for="option in quickReasons"
            :key="option"
            type="button"
            class="px-3 py-1.5 rounded-xl text-xs font-bold border font-chinese active:scale-95"
            :class="reason === option ? 'bg-sky-500 border-sky-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="reason = option"
          >
            {{ option }}
          </button>
        </div>
        <input
          v-model="reason"
          type="text"
          maxlength="50"
          required
          placeholder="也可以自己写，例如：数学老师请假了"
          class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-sky-500 outline-none font-chinese"
        />
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="$emit('close')">取消</button>
        <button
          type="submit"
          :disabled="busy || !reason.trim()"
          class="px-6 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 text-white text-xs font-bold shadow-sm disabled:opacity-50"
        >
          {{ busy ? '提交中...' : asParent ? '确认跳过' : '请家长确认' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  task: { type: Object, required: true },
  asParent: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
const emit = defineEmits(['close', 'submit']);

const quickReasons = ['老师今天没布置', '在学校已经做完了', '今天身体不舒服', '今天有活动没时间'];
const reason = ref('');

function submit() {
  if (reason.value.trim()) emit('submit', reason.value.trim());
}
</script>
