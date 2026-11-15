<template>
  <UiDialog :title="template ? '修改周期作业' : '新增周期作业'" :busy="saving" @close="$emit('close')">
    <FormDraftNotice :draft="draft" :busy="saving" @retry="save" />
    <form @submit.prevent="save">
      <fieldset :disabled="saving || draft.available || draft.pending" class="space-y-4 min-w-0">
        <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
        <p class="text-xs text-slate-500 dark:text-slate-400">每周生成一份独立作业，内容可后补；默认下周同一天截止，生成后可单独修改。修改模板只影响之后生成的作业。</p>
        <label class="block text-sm font-bold">课程名称
          <input v-model="form.subject" aria-label="课程名称" maxlength="10" required placeholder="例如：书法托管" class="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2" />
        </label>
        <label class="block text-sm font-bold">每周生成日
          <select v-model.number="form.weekday" aria-label="每周生成日" class="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
            <option v-for="day in [1, 2, 3, 4, 5, 6, 0]" :key="day" :value="day">{{ WEEKDAY_NAMES[day] }}</option>
          </select>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="block min-w-0 text-sm font-bold">生效日期
            <input v-model="form.start_date" aria-label="生效日期" type="date" required class="ui-date-time mt-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2" />
          </label>
          <label class="block min-w-0 text-sm font-bold">周期结束日期（可不填）
            <input v-model="form.end_date" aria-label="周期结束日期（可不填）" type="date" :min="form.start_date" class="ui-date-time mt-1 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2" />
          </label>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">周期结束日期包含当天，只生成此日期及之前的期次；已生成的作业仍按各自截止日期完成。不填则持续生成，直到停用模板。</p>
        <label class="flex items-center gap-2 min-h-11 text-sm font-bold"><input v-model="form.pause_on_holidays" type="checkbox" />学校假期暂停生成</label>
        <p class="text-xs text-slate-500 dark:text-slate-400">按孩子设置的假期判断，不改变每周生成日；假期中已设为调休上学的日期仍可生成。</p>
        <label class="flex items-center gap-2 min-h-11 text-sm font-bold"><input v-model="form.enabled" type="checkbox" />启用自动生成</label>
        <label class="block text-sm font-bold">奖励积分
          <input v-model.number="form.points" aria-label="奖励积分" type="number" min="0" max="10000" required class="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2" />
        </label>
        <PriorityFields v-model="form.priority" />
        <TimingFields v-model:track-time="form.track_time" v-model:expected-minutes="form.expected_minutes" />
        <div class="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700 pt-3">
          <button type="button" class="min-h-11 px-4 rounded-xl text-slate-500 dark:text-slate-400" @click="$emit('close')">取消</button>
          <button type="submit" :disabled="!form.subject.trim() || conflict" class="min-h-11 px-5 rounded-xl bg-brand-500 text-white font-bold disabled:opacity-50">{{ saving ? '保存中…' : '保存模板' }}</button>
        </div>
      </fieldset>
    </form>
  </UiDialog>
</template>
<script setup>
import { reactive, ref } from 'vue';
import UiDialog from './UiDialog.vue';
import PriorityFields from './PriorityFields.vue';
import TimingFields from './TimingFields.vue';
import FormDraftNotice from './FormDraftNotice.vue';
import { useFormDraft } from '../composables/useFormDraft';
import { restoreFormFields } from '../utils/formDrafts';
import { WEEKDAY_NAMES } from '../utils/schedule';
import { getDataGeneration } from '../utils/session';
import api from '../api/client';
const props = defineProps({ childId: { type: String, required: true }, today: { type: String, required: true }, template: { type: Object, default: null } });
const emit = defineEmits(['close', 'saved']);
const saving = ref(false), error = ref(''), conflict = ref(false), generation = getDataGeneration();
const keys = ['subject', 'weekday', 'start_date', 'end_date', 'points', 'priority', 'track_time', 'expected_minutes', 'pause_on_holidays', 'enabled'];
const form = reactive(props.template ? Object.fromEntries(keys.map(key => [key, props.template[key] ?? (key === 'end_date' ? '' : null)])) : {
  subject: '', weekday: new Date(`${props.today}T00:00:00Z`).getUTCDay(), start_date: props.today, end_date: '', points: 10, priority: 1,
  track_time: false, expected_minutes: null, pause_on_holidays: true, enabled: true
});
const version = ref(props.template?.edit_version);
const draft = useFormDraft({ kind: 'recurring-homework', child_id: props.childId, record_id: props.template?.id }, {
  read: () => ({ form: { ...form }, baseVersion: version.value }), hasContent: data => Boolean(data.form.subject.trim()),
  apply: data => { restoreFormFields(form, data.form); version.value = data.baseVersion; }, invalidated: () => emit('close')
});
async function save() {
  if (saving.value || conflict.value) return;
  saving.value = true; error.value = '';
  try {
    const body = { ...form, end_date: form.end_date || null, ...(props.template ? { expected_version: version.value } : {}) };
    const attempt = draft.prepare(body);
    if (props.template) await api.updateRecurringHomework(props.template.id, attempt.body, generation);
    else await api.createRecurringHomework(props.childId, { ...attempt.body, request_id: attempt.request_id }, generation);
    draft.complete(); emit('saved');
  } catch (err) { draft.failed(err); conflict.value = err.code === 'EDIT_CONFLICT'; error.value = err.message || String(err); }
  finally { saving.value = false; }
}
</script>
