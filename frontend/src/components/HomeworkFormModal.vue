<template>
  <!-- Record homework (or change a record): the course, when it was set, when it is due, and what it is -->
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="$emit('close')">
    <form class="bg-white dark:bg-slate-900 rounded-3xl p-5 sm:p-6 max-w-lg w-full max-h-[92dvh] overflow-y-auto shadow-2xl border-2 border-brand-100 dark:border-brand-800 space-y-4" @submit.prevent="save">
      <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 font-chinese">{{ record ? '✏️ 修改作业记录' : '📒 记作业' }}</h3>
      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">哪门课</label>
        <div v-if="record" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 font-chinese">{{ courseLabel(record) }}</div>
        <template v-else>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="course in courses"
              :key="course.course_key"
              type="button"
              class="px-3 py-2 rounded-xl text-xs font-bold border font-chinese"
              :class="course.course_key === selected?.course_key ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'"
              @click="selectCourse(course)"
            >
              {{ course.kind === 'class' ? '🎹 ' : '' }}{{ course.subject }}
            </button>
          </div>
          <select
            v-if="otherSubjects.length"
            class="mt-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 outline-none focus:border-brand-500"
            :value="selected && !courses.includes(selected) ? selected.subject : ''"
            @change="pickOtherSubject($event.target.value)"
          >
            <option value="">{{ courses.length ? '其他科目…' : '选择科目…' }}</option>
            <option v-for="subject in otherSubjects" :key="subject" :value="subject">{{ subject }}</option>
          </select>
        </template>
      </div>

      <div>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">作业内容</label>
        <textarea
          v-model="form.content"
          rows="4"
          maxlength="500"
          required
          placeholder="例如：抄写第 5 课生字两遍，预习第 6 课"
          class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 outline-none font-chinese resize-none"
        ></textarea>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">布置日期</label>
          <input v-model="form.assigned_date" type="date" :max="today" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" @change="onAssignedChange" />
          <div class="flex flex-wrap gap-1.5 mt-1.5">
            <button type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="setAssigned(today)">今天</button>
            <button v-if="selected?.last_lesson_date && selected.last_lesson_date !== today" type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="setAssigned(selected.last_lesson_date)">
              上次课 {{ dayName(selected.last_lesson_date) }}
            </button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">截止日期</label>
          <input v-model="form.due_date" type="date" :min="form.assigned_date" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" @input="dueTouched = true" />
          <button v-if="dueTouched && suggestion?.due_date && form.due_date !== suggestion.due_date" type="button" class="mt-1.5 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="resetDue">
            恢复默认 {{ dayName(suggestion.due_date) }}
          </button>
        </div>
      </div>
      <p v-if="dueHint" class="-mt-2 text-xs font-bold" :class="dueHint.warn ? 'text-amber-600 dark:text-amber-300' : 'text-slate-400'">{{ dueHint.text }}</p>

      <div v-if="!record" class="rounded-2xl border p-3" :class="canCreateTask ? 'border-orange-100 dark:border-orange-800 bg-orange-50/40 dark:bg-orange-950/40' : 'border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800'">
        <label class="flex items-start gap-2" :class="canCreateTask ? 'cursor-pointer' : 'opacity-60'">
          <input v-model="form.create_task" type="checkbox" :disabled="!canCreateTask" class="mt-0.5 w-4 h-4 accent-orange-500" @change="createTouched = true" />
          <span>
            <span class="block text-xs font-bold text-slate-700 dark:text-slate-200">{{ asParent ? '生成打卡任务' : '请家长生成打卡任务' }}</span>
            <span class="block text-xs font-bold text-slate-400">
              {{ canCreateTask ? (asParent ? '截止前每天出现在今日看板上，最后一天必须完成' : '家长确认后，会出现在今日看板上') : '截止日期已过或没有截止日期，只保存作业记录' }}
            </span>
            <span v-if="canCreateTask && suggestion?.same_subject_tasks?.length" class="block mt-1 text-xs font-bold text-amber-600 dark:text-amber-300">
              这天已有「{{ suggestion.same_subject_tasks.join('」「') }}」，如果已经包含这项作业，可以不生成
            </span>
          </span>
        </label>
      </div>

      <div v-if="asParent && (record || form.create_task)" class="grid grid-cols-2 gap-3 items-start">
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">奖励积分</label>
          <input v-model.number="form.points" type="number" min="0" max="10000" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" @input="pointsTouched = true" />
          <p class="mt-1 text-xs font-bold text-slate-400">默认按课程，可以在「课程默认积分」里设置</p>
        </div>
      </div>
      <TimingFields v-if="asParent && !record && form.create_task" v-model:track-time="form.track_time" v-model:expected-minutes="form.expected_minutes" />

      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="$emit('close')">取消</button>
        <button type="submit" :disabled="saving || !form.content.trim() || !(record || selected)" class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import api from '../api/client';
import TimingFields from './TimingFields.vue';
import { SCHOOL_SUBJECTS, WEEKDAY_NAMES, localDate, shortDate } from '../utils/schedule.js';
import { courseLabel } from '../utils/homework.js';

const props = defineProps({
  childId: { type: String, required: true },
  courses: { type: Array, default: () => [] },
  asParent: { type: Boolean, default: false },
  // Set to change a record; left out to record new homework.
  record: { type: Object, default: null }
});
const emit = defineEmits(['close', 'saved']);

const today = localDate();
const dayName = date => `${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${shortDate(date)}`;

const selected = ref(null);
const suggestion = ref(null);
const saving = ref(false);
const error = ref('');
// Defaults follow the course and assigned date until the user sets the field.
const dueTouched = ref(false);
const pointsTouched = ref(false);
const createTouched = ref(false);
const form = reactive(props.record
  ? { content: props.record.content, assigned_date: props.record.assigned_date, due_date: props.record.due_date || '', points: props.record.points, create_task: false }
  : { content: '', assigned_date: today, due_date: '', points: 10, create_task: false, track_time: false, expected_minutes: null });

const otherSubjects = computed(() => SCHOOL_SUBJECTS.filter(subject => !props.courses.some(c => c.kind === 'school' && c.subject === subject)));
const canCreateTask = computed(() => Boolean(form.due_date) && form.due_date >= today);

const dueHint = computed(() => {
  if (props.record) return form.due_date && form.due_date < today ? { text: '截止日期已过', warn: true } : null;
  if (!suggestion.value) return null;
  const { next_lesson_date: next } = suggestion.value;
  if (!next) return { text: '课程表里找不到下一次课，请自己选截止日期', warn: !form.due_date };
  return { text: `下次课是${dayName(next)}，默认前一天截止${form.due_date && form.due_date < today ? '（已过）' : ''}`, warn: form.due_date < today };
});

function selectCourse(course) {
  selected.value = course;
  form.assigned_date = course.last_lesson_date ?? today;
  dueTouched.value = false;
  refresh();
}

function pickOtherSubject(subject) {
  if (subject) selectCourse({ kind: 'school', subject, class_id: null, course_key: `school:${subject}`, last_lesson_date: null });
}

function setAssigned(date) {
  form.assigned_date = date;
  onAssignedChange();
}

function onAssignedChange() {
  if (!props.record && form.assigned_date) refresh();
}

function resetDue() {
  dueTouched.value = false;
  form.due_date = suggestion.value?.due_date || '';
}

// The default due date, points and whether to create a task, for the course and assigned date.
let latest = 0;
async function refresh() {
  if (!selected.value) return;
  const request = ++latest;
  const { kind, subject, class_id } = selected.value;
  try {
    const result = await api.suggestHomework(props.childId, { course_kind: kind, subject: kind === 'school' ? subject : undefined, class_id: class_id ?? undefined, assigned_date: form.assigned_date });
    if (request !== latest) return;
    suggestion.value = result;
    if (!dueTouched.value) form.due_date = result.due_date || '';
    if (!pointsTouched.value) form.points = result.points;
    if (!createTouched.value) form.create_task = canCreateTask.value && !result.same_subject_tasks.length;
    if (!canCreateTask.value) form.create_task = false;
  } catch (err) {
    if (request === latest) error.value = typeof err === 'string' ? err : '读取课程信息失败';
  }
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    let saved;
    if (props.record) {
      saved = await api.updateHomework(props.record.id, { content: form.content, assigned_date: form.assigned_date, due_date: form.due_date || null,
        ...(props.asParent ? { points: form.points || 0 } : {}) });
    } else {
      const { kind, subject, class_id } = selected.value;
      const createTask = form.create_task && canCreateTask.value;
      saved = await api.createHomework(props.childId, {
        course_kind: kind, subject: kind === 'school' ? subject : undefined, class_id: class_id ?? undefined,
        content: form.content, assigned_date: form.assigned_date, due_date: form.due_date || null, create_task: createTask,
        ...(props.asParent ? { points: form.points || 0, ...(createTask ? { track_time: form.track_time, expected_minutes: form.track_time ? form.expected_minutes : null } : {}) } : {})
      });
    }
    emit('saved', saved);
  } catch (err) {
    error.value = typeof err === 'string' ? err : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

if (!props.record && props.courses.length) selectCourse(props.courses[0]);
</script>
