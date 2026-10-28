<template>
  <UiDialog :title="record ? '✏️ 修改错题记录' : '✍️ 添加纯文字错题记录'" :busy="saving" @close="$emit('close')">
    <FormDraftNotice :draft="draft" :busy="saving" @retry="save" />
    <p v-if="error" role="alert" class="mb-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ error }}</p>
    <button v-if="conflict" type="button" :disabled="saving" class="min-h-[44px] mb-3 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold" @click="reload">重新读取错题</button>
    <form @submit.prevent="save">
      <fieldset :disabled="saving || draft.available || draft.pending" class="space-y-4 min-w-0">
        <label class="block text-sm font-bold">选择学科
          <select v-model="form.subject" class="block w-full min-h-[44px] mt-1 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <option v-for="subject in subjects" :key="subject">{{ subject }}</option>
          </select>
        </label>
        <label class="block text-sm font-bold">题目内容与错误原因描述
          <textarea v-model="form.description" autofocus rows="5" required maxlength="10000" class="block w-full mt-1 p-3 rounded-xl border border-slate-200 dark:border-slate-700 resize-y font-chinese"></textarea>
        </label>
        <div class="flex justify-end gap-2">
          <button type="button" class="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800" @click="$emit('close')">取消</button>
          <button type="submit" :disabled="conflict" class="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white font-bold disabled:opacity-40">{{ saving ? '保存中…' : record ? '保存修改' : '保存记录' }}</button>
        </div>
      </fieldset>
    </form>
  </UiDialog>
</template>
<script setup>
import { computed, reactive, ref } from 'vue';
import api from '../api/client';
import { getDataGeneration } from '../utils/session';
import UiDialog from './UiDialog.vue';
import FormDraftNotice from './FormDraftNotice.vue';
import { useFormDraft } from '../composables/useFormDraft';
import { restoreFormFields } from '../utils/formDrafts';
import { confirmAction } from '../utils/confirmation';
const props = defineProps({ childId: { type: String, required: true }, record: { type: Object, default: null } });
const emit = defineEmits(['close', 'saved']);
const baseline = ref(props.record);
let generation = getDataGeneration();
const form = reactive({ subject: props.record?.subject || '数学', description: props.record?.description || '' });
const subjects = computed(() => [...new Set(['语文', '数学', '英语', '其他', form.subject])]);
const saving = ref(false), error = ref(''), conflict = ref(false);
const draft = useFormDraft({ kind: 'mistake', child_id: props.childId, record_id: props.record?.id ?? null }, {
  read: () => ({ form: { ...form }, baseVersion: baseline.value?.edit_version }),
  hasContent: data => Boolean(data.form.description.trim()),
  apply: data => {
    if (props.record && !/^[a-f0-9]{64}$/.test(data.baseVersion)) throw new Error('草稿版本信息不完整，请重新读取错题');
    restoreFormFields(form, data.form);
    if (props.record) baseline.value = { ...baseline.value, edit_version: data.baseVersion };
  }, invalidated: () => emit('close')
});
async function reload() {
  if (!await confirmAction('重新读取会用服务器中的最新内容替换当前输入，并丢弃这份本机草稿。需要保留的文字请先复制。确定继续吗？')) return;
  saving.value = true;
  try {
    const fresh = await api.getMistake(props.record.id);
    baseline.value = fresh; generation = getDataGeneration();
    Object.assign(form, { subject: fresh.subject, description: fresh.description });
    draft.discard();
    conflict.value = false; error.value = '';
  } catch (err) { error.value = typeof err === 'string' ? err : err.message; }
  finally { saving.value = false; }
}
async function save() {
  if (saving.value || conflict.value) return;
  saving.value = true; error.value = '';
  try {
    const attempt = draft.prepare(props.record ? { ...form, expected_version: baseline.value.edit_version } : { ...form, child_id: props.childId });
    const saved = props.record
      ? await api.updateMistake(props.record.id, attempt.body, generation)
      : await api.createMistake({ ...attempt.body, request_id: attempt.request_id });
    draft.complete();
    emit('saved', saved);
  } catch (err) {
    draft.failed(err);
    error.value = typeof err === 'string' ? err : err.message;
    conflict.value = ['EDIT_CONFLICT', 'DATA_RESTORED'].includes(err.code);
  } finally { saving.value = false; }
}
</script>
