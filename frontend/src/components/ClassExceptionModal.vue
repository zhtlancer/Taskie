<template>
  <UiDialog :title="`${lesson.title} · ${shortDate(lesson.date)} ${WEEKDAY_NAMES[weekday]}`" :busy="saving" @close="$emit('close')">
    <form class="space-y-4" @submit.prevent="save">
      <div>
        <p class="text-xs font-bold text-slate-400">{{ child.avatar_emoji }} {{ child.name }} · 原定 {{ timeRange(cls.start_time, cls.end_time) }}</p>
      </div>
      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div class="flex gap-2">
        <button type="button" class="min-h-11 min-w-11 flex-1 py-2 rounded-xl text-sm font-bold border" :class="form.kind === 'leave' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'" @click="form.kind = 'leave'">🙋 请假</button>
        <button type="button" class="min-h-11 min-w-11 flex-1 py-2 rounded-xl text-sm font-bold border" :class="form.kind === 'moved' ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'" @click="form.kind = 'moved'">🔁 调课</button>
      </div>
      <div v-if="form.kind === 'moved'" class="grid grid-cols-3 gap-2">
        <div class="col-span-3 sm:col-span-1">
          <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">调到哪天</label>
          <input v-model="form.new_date" type="date" required class="min-h-11 w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">开始</label>
          <input v-model="form.new_start_time" type="time" required class="min-h-11 w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">结束</label>
          <input v-model="form.new_end_time" type="time" required class="min-h-11 w-full px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-violet-500" />
        </div>
      </div>
      <input v-model="form.note" type="text" maxlength="50" placeholder="备注（可不填），如 发烧、老师有事" class="min-h-11 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />

      <div class="flex justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
        <button v-if="lesson.exception_id" type="button" :disabled="saving" class="min-h-11 min-w-11 px-3 py-2 rounded-xl text-xs font-bold text-emerald-600 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40" @click="restore">恢复正常上课</button>
        <span v-else></span>
        <div class="flex gap-2">
          <button type="button" :disabled="saving" class="min-h-11 min-w-11 px-3 py-2 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="$emit('close')">取消</button>
          <button type="submit" :disabled="saving" class="min-h-11 min-w-11 px-5 py-2 rounded-xl bg-violet-500 text-white text-xs font-bold disabled:opacity-50">保存</button>
        </div>
      </div>
    </form>
  </UiDialog>
</template>

<script setup>
import { computed, ref } from 'vue';
import api from '../api/client';
import UiDialog from './UiDialog.vue';
import { WEEKDAY_NAMES, shortDate, timeRange } from '../utils/schedule.js';

const props = defineProps({
  cls: { type: Object, required: true },
  child: { type: Object, required: true },
  // The lesson on its usual date (status scheduled, leave or moved_out).
  lesson: { type: Object, required: true }
});
const emit = defineEmits(['close', 'saved']);

const weekday = computed(() => new Date(`${props.lesson.date}T00:00:00Z`).getUTCDay());
const exception = props.cls.exceptions.find(e => e.id === props.lesson.exception_id);
const form = ref({
  kind: exception?.kind ?? 'leave',
  new_date: exception?.new_date ?? props.lesson.date,
  new_start_time: exception?.new_start_time ?? props.cls.start_time,
  new_end_time: exception?.new_end_time ?? props.cls.end_time,
  note: exception?.note ?? ''
});
const saving = ref(false);
const error = ref('');

async function run(action) {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    emit('saved', await action());
  } catch (err) {
    error.value = typeof err === 'string' ? err : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

function save() {
  const { kind, note, ...moved } = form.value;
  return run(() => api.setClassException(props.cls.id, { child_id: props.child.id, date: props.lesson.date, kind, note: note || null, ...(kind === 'moved' ? moved : {}) }));
}

function restore() {
  return run(() => api.deleteClassException(props.lesson.exception_id));
}
</script>
