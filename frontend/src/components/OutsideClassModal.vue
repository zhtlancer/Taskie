<template>
  <UiDialog :title="cls ? '编辑课外班' : '新增课外班'" :busy="saving" wide @close="$emit('close')">
    <form class="space-y-4" @submit.prevent="save">
      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2 sm:col-span-1">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">课程名称</label>
          <input v-model="form.title" aria-label="课程名称" type="text" maxlength="20" required placeholder="例如：钢琴课" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div class="col-span-2 sm:col-span-1">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">机构（可不填）</label>
          <input v-model="form.institution" type="text" maxlength="30" placeholder="例如：少年宫" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">上课地点</label>
          <input v-model="form.location" type="text" maxlength="50" placeholder="例如：人民路 88 号 3 楼 302" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">每周上课</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="day in WEEK_ORDER"
            :key="day"
            type="button"
            class="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold border"
            :class="form.days_of_week.includes(day) ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="toggleDay(day)"
          >
            {{ WEEKDAY_NAMES[day] }}
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">开始时间</label>
          <input v-model="form.start_time" type="time" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">结束时间</label>
          <input v-model="form.end_time" type="time" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">从哪天开始</label>
          <input v-model="form.start_date" aria-label="从哪天开始" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">排课方式</label>
          <select v-model="scheduleMode" aria-label="排课方式" class="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm">
            <option value="count">按总课次</option>
            <option value="date">按结束日期</option>
          </select>
        </div>
        <div v-if="scheduleMode === 'count'">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">总课次</label>
          <input v-model.number="form.total_lessons" aria-label="总课次" type="number" min="1" max="520" required class="w-full min-h-[44px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm" />
        </div>
        <div v-else>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">到哪天结束（可不填）</label>
          <input v-model="form.end_date" aria-label="到哪天结束" type="date" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">老师（可不填）</label>
          <input v-model="form.teacher" type="text" maxlength="10" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">要带的东西（可不填）</label>
          <input v-model="form.bring" type="text" maxlength="50" placeholder="例如：琴谱" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">备注（可不填）</label>
          <input v-model="form.note" type="text" maxlength="100" placeholder="例如：提前 10 分钟到，带水杯" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
      </div>

      <section v-if="scheduleMode === 'count'" aria-label="排课预览" class="rounded-2xl bg-violet-50 dark:bg-violet-950/40 p-3 space-y-2 text-xs font-bold text-violet-700 dark:text-violet-300">
        <p v-if="preview.length">共 {{ preview.length }} 次 · 首课 {{ preview[0] }} · 最后一次 {{ preview.at(-1) }}</p>
        <p v-else>选择上课星期、开始日期和总课次后预览排课。</p>
        <p class="text-slate-500 dark:text-slate-400">请假保留原课次，不自动延长；调课沿用原课次。保存后可对单次课程请假或调课。</p>
        <details v-if="preview.length">
          <summary class="cursor-pointer min-h-[44px] flex items-center">查看全部课次</summary>
          <ol class="max-h-48 overflow-y-auto space-y-1">
            <li v-for="(date, index) in preview" :key="date">第 {{ index + 1 }} 次 · {{ date }} {{ WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()] }} {{ form.start_time }}–{{ form.end_time }}</li>
          </ol>
        </details>
      </section>

      <div>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">哪些孩子上</label>
        <div class="flex flex-wrap gap-1.5">
          <button type="button" class="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold border" :class="form.child_ids === null ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'" @click="form.child_ids = null">👨‍👩‍👧 全部孩子</button>
          <button
            v-for="child in children"
            :key="child.id"
            type="button"
            class="min-h-[44px] px-3 py-1.5 rounded-lg text-xs font-bold border font-chinese"
            :class="form.child_ids?.includes(child.id) ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="toggleChild(child.id)"
          >
            {{ child.avatar_emoji }} {{ child.name }}
          </button>
        </div>
      </div>

      <div class="rounded-2xl border border-emerald-100 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/40 p-3">
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="form.create_task" type="checkbox" class="mt-0.5 w-4 h-4 accent-emerald-500" />
          <span>
            <span class="block text-xs font-bold text-slate-700 dark:text-slate-200">✅ 上课那天生成打卡任务</span>
            <span class="block text-xs font-bold text-slate-400">计入全勤和积分；请假或调走的那天不出现</span>
          </span>
        </label>
        <div v-if="form.create_task" class="mt-2 pl-6 flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
          打卡积分
          <input v-model.number="form.points" type="number" min="0" max="10000" class="w-20 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-center outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button type="button" :disabled="saving" class="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="$emit('close')">取消</button>
        <button type="submit" :disabled="saving || !form.days_of_week.length || form.child_ids?.length === 0 || (scheduleMode === 'count' && !preview.length)" class="min-h-[44px] px-6 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold disabled:opacity-50">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </form>
  </UiDialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import UiDialog from './UiDialog.vue';
import api from '../api/client';
import { WEEKDAY_NAMES, WEEK_ORDER, localDate, lessonDates } from '../utils/schedule.js';

const props = defineProps({
  // The class being edited, or null for a new one.
  cls: { type: Object, default: null },
  children: { type: Array, required: true }
});
const emit = defineEmits(['close', 'saved']);
const scheduleMode = ref(props.cls && !props.cls.total_lessons ? 'date' : 'count');

const fields = ['title', 'institution', 'location', 'teacher', 'start_time', 'end_time', 'start_date', 'end_date', 'bring', 'note', 'create_task', 'points'];
const form = ref(props.cls
  ? { ...Object.fromEntries(fields.map(field => [field, props.cls[field] ?? ''])), total_lessons: props.cls.total_lessons ?? 20, days_of_week: [...props.cls.days_of_week], child_ids: props.cls.child_ids && [...props.cls.child_ids] }
  : { title: '', institution: '', location: '', teacher: '', start_time: '16:30', end_time: '17:30', start_date: localDate(), end_date: '', bring: '', note: '',
      create_task: false, points: 5, days_of_week: [], child_ids: null, total_lessons: 20 });
const preview = computed(() => lessonDates(form.value.start_date, form.value.days_of_week, form.value.total_lessons));
const saving = ref(false);
const error = ref('');

function toggleDay(day) {
  const days = form.value.days_of_week;
  form.value.days_of_week = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
}

function toggleChild(id) {
  const ids = form.value.child_ids || [];
  form.value.child_ids = ids.includes(id) ? ids.filter(childId => childId !== id) : [...ids, id];
}

async function save() {
  saving.value = true;
  error.value = '';
  const payload = { ...form.value, total_lessons: scheduleMode.value === 'count' ? form.value.total_lessons : null,
    end_date: scheduleMode.value === 'count' ? preview.value.at(-1) : form.value.end_date || null, points: form.value.points || 0 };
  try {
    emit('saved', props.cls ? await api.updateOutsideClass(props.cls.id, payload) : await api.createOutsideClass(payload));
  } catch (err) {
    error.value = typeof err === 'string' ? err : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}
</script>
