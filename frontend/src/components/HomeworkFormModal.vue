<template>
  <!-- Record homework (or change a record): the course, when it was set, when it is due, and what it is -->
  <UiDialog :title="record ? '✏️ 修改作业记录' : '📒 记作业'" :busy="saving" wide @close="$emit('close')">
    <FormDraftNotice :draft="draft" :busy="saving" @retry="save" />
    <button v-if="conflict" type="button" :disabled="saving" class="min-h-[44px] mb-3 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="reloadRecord">重新读取作业</button>
    <!-- While saving, the whole form is frozen so nothing typed meanwhile is silently dropped. -->
    <form @submit.prevent="save">
     <fieldset :disabled="saving || draft.available || draft.pending" class="space-y-4 min-w-0">
      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div>
        <span class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">哪门课</span>
        <div v-if="record" class="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 font-chinese">{{ courseLabel(record) }}</div>
        <template v-else>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="course in courses"
              :key="course.course_key"
              type="button"
              class="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl text-xs font-bold border font-chinese"
              :aria-pressed="course.course_key === selected?.course_key"
              :class="course.course_key === selected?.course_key ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'"
              @click="selectCourse(course)"
            >
              {{ course.kind === 'class' ? '🎹 ' : '' }}{{ course.subject }}
            </button>
          </div>
          <select
            v-if="otherSubjects.length"
            aria-label="其他科目"
            class="mt-2 min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 outline-none focus:border-brand-500"
            :value="selected && !courses.includes(selected) ? selected.subject : ''"
            @change="pickOtherSubject($event.target.value)"
          >
            <option value="">{{ courses.length ? '其他科目…' : '选择科目…' }}</option>
            <option v-for="subject in otherSubjects" :key="subject" :value="subject">{{ subject }}</option>
          </select>
        </template>
      </div>

      <div>
        <label for="homework-content" class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">作业内容</label>
        <textarea
          id="homework-content"
          v-model="form.content"
          rows="4"
          maxlength="500"
          required
          placeholder="例如：抄写第 5 课生字两遍，预习第 6 课"
          class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 outline-none font-chinese resize-none"
        ></textarea>
      </div>

      <div class="homework-dates grid grid-cols-2 gap-3">
        <div class="sm:min-w-0">
          <label for="homework-assigned" class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">布置日期</label>
          <input id="homework-assigned" v-model="form.assigned_date" type="date" :max="today" required class="homework-date-input min-h-[44px] min-w-[44px] w-full sm:block sm:min-w-0 sm:max-w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" @change="onAssignedChange" />
          <div class="flex flex-wrap gap-1.5 mt-1.5">
            <button type="button" class="min-h-[44px] min-w-[44px] px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="setAssigned(today)">今天</button>
            <button v-if="selected?.last_lesson_date && selected.last_lesson_date !== today" type="button" class="min-h-[44px] min-w-[44px] px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="setAssigned(selected.last_lesson_date)">
              上次课 {{ dayName(selected.last_lesson_date) }}
            </button>
          </div>
        </div>
        <div class="sm:min-w-0">
          <label for="homework-due" class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">截止日期</label>
          <input id="homework-due" v-model="form.due_date" type="date" :min="form.assigned_date" class="homework-date-input min-h-[44px] min-w-[44px] w-full sm:block sm:min-w-0 sm:max-w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" @input="dueTouched = true" />
          <button v-if="dueTouched && suggestion?.due_date && form.due_date !== suggestion.due_date" type="button" class="min-h-[44px] min-w-[44px] mt-1.5 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="resetDue">
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
          <label for="homework-points" class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">奖励积分</label>
          <input id="homework-points" v-model.number="form.points" type="number" min="0" max="10000" class="min-h-[44px] min-w-[44px] w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" @input="pointsTouched = true" />
          <p class="mt-1 text-xs font-bold text-slate-400">默认按课程，可以在「课程默认积分」里设置</p>
        </div>
      </div>
      <PriorityFields v-if="asParent" v-model="form.priority" />
      <p v-if="asParent && record?.task && record.task_state !== 'open'" class="text-xs text-slate-500 dark:text-slate-400">已完成、已跳过或已过期的任务保留原有优先级；这里仅修改作业记录。</p>
      <TimingFields v-if="asParent && !record && form.create_task" v-model:track-time="form.track_time" v-model:expected-minutes="form.expected_minutes" />

      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
        <button type="button" class="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="$emit('close')">取消</button>
        <button type="submit" :disabled="saving || conflict || !form.content.trim() || !(record || selected)" class="min-h-[44px] min-w-[44px] px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
     </fieldset>
    </form>
  </UiDialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import api from '../api/client';
import TimingFields from './TimingFields.vue';
import PriorityFields from './PriorityFields.vue';
import UiDialog from './UiDialog.vue';
import { SCHOOL_SUBJECTS, WEEKDAY_NAMES, shortDate } from '../utils/schedule.js';
import { courseLabel } from '../utils/homework.js';
import FormDraftNotice from './FormDraftNotice.vue';
import { useFormDraft } from '../composables/useFormDraft';
import { restoreFormFields } from '../utils/formDrafts';
import { getDataGeneration } from '../utils/session';
import { confirmAction } from '../utils/confirmation';

const props = defineProps({
  childId: { type: String, required: true },
  courses: { type: Array, default: () => [] },
  asParent: { type: Boolean, default: false },
  // Set to change a record; left out to record new homework.
  record: { type: Object, default: null },
  // The family's date, not the device's.
  today: { type: String, required: true }
});
const emit = defineEmits(['close', 'saved']);

const today = computed(() => props.today);
const dayName = date => `${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${shortDate(date)}`;

const selected = ref(null);
const suggestion = ref(null);
const saving = ref(false);
const error = ref('');
const baseline = ref(props.record), conflict = ref(false);
const generation = getDataGeneration();
// Defaults follow the course and assigned date until the user sets the field.
const dueTouched = ref(false);
const pointsTouched = ref(false);
const createTouched = ref(false);
const form = reactive(props.record
  ? { content: props.record.content, assigned_date: props.record.assigned_date, due_date: props.record.due_date || '', priority: props.record.priority ?? 1, points: props.record.points, create_task: false }
  : { content: '', assigned_date: today.value, due_date: '', priority: 1, points: 10, create_task: false, track_time: false, expected_minutes: null });

const otherSubjects = computed(() => SCHOOL_SUBJECTS.filter(subject => !props.courses.some(c => c.kind === 'school' && c.subject === subject)));
const canCreateTask = computed(() => Boolean(form.due_date) && form.due_date >= today.value);

const dueHint = computed(() => {
  if (props.record) return form.due_date && form.due_date < today.value ? { text: '截止日期已过', warn: true } : null;
  if (!suggestion.value) return null;
  const { next_lesson_date: next } = suggestion.value;
  if (!next) return { text: '课程表里找不到下一次课，请自己选截止日期', warn: !form.due_date };
  return { text: `下次课是${dayName(next)}，默认前一天截止${form.due_date && form.due_date < today.value ? '（已过）' : ''}`, warn: form.due_date < today.value };
});

function selectCourse(course) {
  selected.value = course;
  form.assigned_date = course.last_lesson_date ?? today.value;
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
const draft = useFormDraft({ kind: 'homework', child_id: props.childId, record_id: props.record?.id ?? null }, {
  read: () => ({ form: { ...form }, selected: selected.value && { kind: selected.value.kind, subject: selected.value.subject,
    class_id: selected.value.class_id, course_key: selected.value.course_key }, baseVersion: baseline.value?.edit_version }),
  hasContent: data => Boolean(data.form.content.trim()),
  apply: data => {
    if (props.record && !/^[a-f0-9]{64}$/.test(data.baseVersion)) throw new Error('草稿版本信息不完整，请重新读取作业');
    latest++; dueTouched.value = true; pointsTouched.value = true; createTouched.value = true;
    restoreFormFields(form, data.form);
    if (props.record) baseline.value = { ...baseline.value, edit_version: data.baseVersion };
    else if (data.selected && ['school', 'class'].includes(data.selected.kind)) {
      selected.value = props.courses.find(course => course.course_key === data.selected.course_key) || data.selected;
    } else selected.value = null;
  }, invalidated: () => emit('close')
});
async function reloadRecord() {
  if (!await confirmAction('重新读取会用服务器中的最新内容替换当前输入，并丢弃这份本机草稿。需要保留的文字请先复制。确定继续吗？')) return;
  saving.value = true;
  try {
    const fresh = await api.getHomeworkRecord(props.record.id);
    baseline.value = fresh;
    Object.assign(form, { content: fresh.content, assigned_date: fresh.assigned_date, due_date: fresh.due_date || '', priority: fresh.priority, points: fresh.points });
    draft.discard(); conflict.value = false; error.value = '';
  } catch (err) { error.value = typeof err === 'string' ? err : err.message; }
  finally { saving.value = false; }
}
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
  if (saving.value || conflict.value) return;
  saving.value = true;
  error.value = '';
  try {
    let saved;
    if (props.record) {
      const attempt = draft.prepare({ content: form.content, assigned_date: form.assigned_date, due_date: form.due_date || null,
        expected_version: baseline.value.edit_version, ...(props.asParent ? { priority: form.priority, points: form.points || 0 } : {}) });
      saved = await api.updateHomework(props.record.id, attempt.body, generation);
    } else {
      const { kind, subject, class_id } = selected.value;
      const createTask = form.create_task && canCreateTask.value;
      const attempt = draft.prepare({
        course_kind: kind, subject: kind === 'school' ? subject : undefined, class_id: class_id ?? undefined,
        content: form.content, assigned_date: form.assigned_date, due_date: form.due_date || null, create_task: createTask,
        ...(props.asParent ? { priority: form.priority, points: form.points || 0, ...(createTask ? { track_time: form.track_time, expected_minutes: form.track_time ? form.expected_minutes : null } : {}) } : {})
      });
      saved = await api.createHomework(props.childId, { ...attempt.body, request_id: attempt.request_id });
    }
    draft.complete(); emit('saved', saved);
  } catch (err) {
    draft.failed(err);
    conflict.value = ['EDIT_CONFLICT', 'DATA_RESTORED'].includes(err.code);
    error.value = typeof err === 'string' ? err : err.message || '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

if (!props.record && props.courses.length) selectCourse(props.courses[0]);
</script>

<style scoped>
/* Preserve the original two-column phone fields; apply the sizing fix at tablet widths. */
@media (min-width: 640px) {
  .homework-dates { grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
  /* type=date retains the native picker while its value fits the available field width. */
  .homework-date-input { -webkit-appearance: none; appearance: none; }
  .homework-date-input::-webkit-date-and-time-value { width: 100%; min-width: 0; text-align: left; }
}
</style>
