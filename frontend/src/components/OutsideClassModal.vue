<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto" @click.self="$emit('close')">
    <form class="bg-white rounded-3xl p-5 sm:p-6 max-w-lg w-full shadow-2xl border-2 border-violet-100 space-y-4 my-4" @submit.prevent="save">
      <h3 class="text-xl font-black text-slate-800">🎨 {{ cls ? '编辑课外班' : '新增课外班' }}</h3>
      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ error }}</p>

      <div class="grid grid-cols-2 gap-3">
        <div class="col-span-2 sm:col-span-1">
          <label class="block text-xs font-bold text-slate-600 mb-1.5">课程名称</label>
          <input v-model="form.title" type="text" maxlength="20" required placeholder="例如：钢琴课" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div class="col-span-2 sm:col-span-1">
          <label class="block text-xs font-bold text-slate-600 mb-1.5">机构（可不填）</label>
          <input v-model="form.institution" type="text" maxlength="30" placeholder="例如：少年宫" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-bold text-slate-600 mb-1.5">上课地点</label>
          <input v-model="form.location" type="text" maxlength="50" placeholder="例如：人民路 88 号 3 楼 302" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-600 mb-1.5">每周上课</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="day in WEEK_ORDER"
            :key="day"
            type="button"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border"
            :class="form.days_of_week.includes(day) ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-slate-200 text-slate-600'"
            @click="toggleDay(day)"
          >
            {{ WEEKDAY_NAMES[day] }}
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">开始时间</label>
          <input v-model="form.start_time" type="time" required class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">结束时间</label>
          <input v-model="form.end_time" type="time" required class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">从哪天开始</label>
          <input v-model="form.start_date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">到哪天结束（可不填）</label>
          <input v-model="form.end_date" type="date" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">老师（可不填）</label>
          <input v-model="form.teacher" type="text" maxlength="10" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">要带的东西（可不填）</label>
          <input v-model="form.bring" type="text" maxlength="50" placeholder="例如：琴谱" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-bold text-slate-600 mb-1.5">备注（可不填）</label>
          <input v-model="form.note" type="text" maxlength="100" placeholder="例如：提前 10 分钟到，带水杯" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-violet-500 font-chinese" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-600 mb-1.5">哪些孩子上</label>
        <div class="flex flex-wrap gap-1.5">
          <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-bold border" :class="form.child_ids === null ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-slate-200 text-slate-600'" @click="form.child_ids = null">👨‍👩‍👧 全部孩子</button>
          <button
            v-for="child in children"
            :key="child.id"
            type="button"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border font-chinese"
            :class="form.child_ids?.includes(child.id) ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white border-slate-200 text-slate-600'"
            @click="toggleChild(child.id)"
          >
            {{ child.avatar_emoji }} {{ child.name }}
          </button>
        </div>
      </div>

      <div class="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3">
        <label class="flex items-start gap-2 cursor-pointer">
          <input v-model="form.create_task" type="checkbox" class="mt-0.5 w-4 h-4 accent-emerald-500" />
          <span>
            <span class="block text-xs font-bold text-slate-700">✅ 上课那天生成打卡任务</span>
            <span class="block text-[11px] font-bold text-slate-400">计入全勤和积分；请假或调走的那天不出现</span>
          </span>
        </label>
        <div v-if="form.create_task" class="mt-2 pl-6 flex items-center gap-2 text-xs font-bold text-slate-600">
          打卡积分
          <input v-model.number="form.points" type="number" min="0" max="10000" class="w-20 px-2 py-1 rounded-lg border border-slate-200 text-center outline-none focus:border-emerald-500" />
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
        <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100" @click="$emit('close')">取消</button>
        <button type="submit" :disabled="saving || !form.days_of_week.length || form.child_ids?.length === 0" class="px-6 py-2.5 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold disabled:opacity-50">{{ saving ? '保存中...' : '保存' }}</button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import api from '../api/client';
import { WEEKDAY_NAMES, WEEK_ORDER, localDate } from '../utils/schedule.js';

const props = defineProps({
  // The class being edited, or null for a new one.
  cls: { type: Object, default: null },
  children: { type: Array, required: true }
});
const emit = defineEmits(['close', 'saved']);

const fields = ['title', 'institution', 'location', 'teacher', 'start_time', 'end_time', 'start_date', 'end_date', 'bring', 'note', 'create_task', 'points'];
const form = ref(props.cls
  ? { ...Object.fromEntries(fields.map(field => [field, props.cls[field] ?? ''])), days_of_week: [...props.cls.days_of_week], child_ids: props.cls.child_ids && [...props.cls.child_ids] }
  : { title: '', institution: '', location: '', teacher: '', start_time: '16:30', end_time: '17:30', start_date: localDate(), end_date: '', bring: '', note: '',
      create_task: false, points: 5, days_of_week: [], child_ids: null });
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
  const payload = { ...form.value, end_date: form.value.end_date || null, points: form.value.points || 0 };
  try {
    emit('saved', props.cls ? await api.updateOutsideClass(props.cls.id, payload) : await api.createOutsideClass(payload));
  } catch (err) {
    error.value = typeof err === 'string' ? err : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}
</script>
