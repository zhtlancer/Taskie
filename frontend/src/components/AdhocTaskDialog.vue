<template>
  <UiDialog :title="`${task ? '✏️ 修改' : '➕ 添加'}${child.name}的临时任务`" :busy="saving" @close="$emit('close')">
    <FormDraftNotice :draft="draft" :busy="saving" @retry="save" />
    <p v-if="error" role="alert" class="mb-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ error }}</p>
    <button v-if="conflict" type="button" :disabled="saving" class="min-h-[44px] mb-3 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold text-sm" @click="reload">重新读取任务</button>
    <form @submit.prevent="save">
      <fieldset :disabled="saving || draft.available || draft.pending" class="space-y-4 min-w-0">
        <label class="block text-sm font-bold">任务名称
          <input v-model="form.title" autofocus maxlength="50" required placeholder="例如：订正数学练习、准备手抄报" class="block w-full min-h-[44px] mt-1 px-3 rounded-xl border border-slate-200 dark:border-slate-700" />
        </label>
        <label class="block text-sm font-bold">所属学科
          <select v-model="form.subject" class="block w-full min-h-[44px] mt-1 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <option v-for="subject in subjects" :key="subject">{{ subject }}</option>
          </select>
        </label>
        <p v-if="task" class="text-sm text-slate-500 dark:text-slate-400">布置日期：{{ task.date }}</p>
        <div v-else>
          <label class="block text-sm font-bold">哪一天
            <input v-model="form.date" type="date" required class="block w-full min-h-[44px] min-w-0 max-w-full mt-1 px-3 rounded-xl border border-slate-200 dark:border-slate-700" />
          </label>
          <div class="flex gap-2 mt-1">
            <button type="button" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm" @click="form.date = calendar.today">今天</button>
            <button type="button" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm" @click="form.date = addDays(calendar.today, 1)">明天</button>
          </div>
        </div>
        <label class="block text-sm font-bold">奖励积分
          <input v-model.number="form.points" type="number" min="0" max="10000" required class="block w-full min-h-[44px] mt-1 px-3 rounded-xl border border-slate-200 dark:border-slate-700" />
        </label>
        <label class="block text-sm font-bold">截止日期{{ task && baseline.date < calendar.today ? '（必填）' : '（可不填）' }}
          <input v-model="form.due_date" type="date" :min="minDue" :required="Boolean(task && baseline.date < calendar.today)" class="block w-full min-h-[44px] min-w-0 max-w-full mt-1 px-3 rounded-xl border border-slate-200 dark:border-slate-700" />
        </label>
        <PriorityFields v-model="form.priority" />
        <TimingFields v-model:track-time="form.track_time" v-model:expected-minutes="form.expected_minutes" />
        <div class="flex justify-end gap-2">
          <button type="button" class="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800" @click="$emit('close')">取消</button>
          <button type="submit" :disabled="conflict || (task && !baseline.can_edit)" class="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white font-bold disabled:opacity-40">{{ saving ? '保存中…' : task ? '保存修改' : '确认添加' }}</button>
        </div>
      </fieldset>
    </form>
  </UiDialog>
</template>
<script setup>
import { computed, reactive, ref } from 'vue';
import api from '../api/client';
import { useCalendarStore } from '../stores/calendar';
import { getDataGeneration } from '../utils/session';
import { addDays } from '../utils/schedule';
import UiDialog from './UiDialog.vue';
import PriorityFields from './PriorityFields.vue';
import TimingFields from './TimingFields.vue';
import FormDraftNotice from './FormDraftNotice.vue';
import { useFormDraft } from '../composables/useFormDraft';
import { restoreFormFields } from '../utils/formDrafts';
import { confirmAction } from '../utils/confirmation';
const props = defineProps({ child: { type: Object, required: true }, task: { type: Object, default: null } });
const emit = defineEmits(['close', 'saved']);
const calendar = useCalendarStore();
const baseline = ref(props.task);
let generation = getDataGeneration();
const defaults = task => task ? { title: task.title, subject: task.subject, points: task.points, date: task.date,
  due_date: task.due_date || '', priority: task.priority, track_time: Boolean(task.track_time), expected_minutes: task.expected_minutes }
  : { title: '', subject: '语文', date: calendar.today, due_date: '', points: 10, priority: 1, track_time: false, expected_minutes: null };
const form = reactive(defaults(props.task));
const subjects = computed(() => [...new Set(['语文', '数学', '英语', '其他', form.subject])]);
const minDue = computed(() => props.task ? [baseline.value.date, calendar.today].sort().at(-1) : form.date);
const saving = ref(false), error = ref(''), conflict = ref(false);
const draft = useFormDraft({ kind: 'adhoc', child_id: props.child.id, record_id: props.task?.id ?? null }, {
  read: () => ({ form: { ...form }, baseVersion: baseline.value?.edit_version, basePriority: baseline.value?.priority }),
  hasContent: data => Boolean(data.form.title.trim()),
  apply: data => {
    if (props.task && !/^[a-f0-9]{64}$/.test(data.baseVersion)) throw new Error('草稿版本信息不完整，请重新读取任务');
    restoreFormFields(form, data.form);
    if (props.task) baseline.value = { ...baseline.value, edit_version: data.baseVersion, priority: data.basePriority };
  }, invalidated: () => emit('close')
});
async function reload() {
  if (!await confirmAction('重新读取会用服务器中的最新内容替换当前输入，并丢弃这份本机草稿。需要保留的文字请先复制。确定继续吗？')) return;
  saving.value = true;
  try {
    const fresh = await api.getAdhocTask(props.task.id);
    baseline.value = fresh; generation = getDataGeneration();
    Object.assign(form, defaults(fresh));
    draft.discard();
    conflict.value = false;
    error.value = fresh.can_edit ? '' : '这项任务已完成、跳过、过期或转为课程作业，不能在此修改。';
  } catch (err) { error.value = typeof err === 'string' ? err : err.message; }
  finally { saving.value = false; }
}
async function save() {
  if (saving.value || conflict.value) return;
  saving.value = true; error.value = '';
  try {
    const { date, ...content } = form;
    const body = { ...content, due_date: form.due_date || null, expected_minutes: form.track_time ? form.expected_minutes : null };
    if (props.task && form.priority === baseline.value.priority) delete body.priority;
    const attempt = draft.prepare(props.task ? { ...body, expected_version: baseline.value.edit_version } : { ...body, date });
    const saved = props.task
      ? await api.updateAdhocTask(props.task.id, attempt.body, generation)
      : await api.createAdhocTask(props.child.id, { ...attempt.body, request_id: attempt.request_id });
    draft.complete();
    emit('saved', saved);
  } catch (err) {
    draft.failed(err);
    error.value = typeof err === 'string' ? err : err.message;
    conflict.value = ['EDIT_CONFLICT', 'DATA_RESTORED'].includes(err.code);
  } finally { saving.value = false; }
}
</script>
