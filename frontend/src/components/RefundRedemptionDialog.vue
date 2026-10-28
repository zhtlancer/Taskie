<template>
  <UiDialog title="撤销兑换并退分" :busy="saving" @close="$emit('close')">
    <FormDraftNotice :draft="draft" :busy="saving" @retry="save" />
    <p class="mb-3 text-sm">{{ redemption.child_name }} · {{ redemption.icon_emoji }} {{ redemption.title }}</p>
    <p class="mb-4 text-sm text-slate-600 dark:text-slate-300">确认后退回原兑换扣除的 {{ redemption.cost }} 积分，原申请、确认和本次撤销记录都会保留。</p>
    <p v-if="error" role="alert" class="mb-3 rounded-xl p-3 bg-rose-50 dark:bg-rose-950/40 text-sm text-rose-700 dark:text-rose-300">{{ error }}</p>
    <form @submit.prevent="save">
      <fieldset :disabled="saving || draft.available || draft.pending" class="space-y-4">
        <label class="block text-sm font-bold">撤销原因
          <textarea v-model="form.reason" autofocus required maxlength="200" rows="3" placeholder="例如：误确认兑换、活动取消" class="block w-full mt-2 p-3 rounded-xl border border-slate-200 dark:border-slate-700"></textarea>
        </label>
        <div class="flex flex-wrap justify-end gap-2">
          <button type="button" class="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800" @click="$emit('close')">取消</button>
          <button type="submit" class="min-h-[44px] px-4 rounded-xl bg-rose-600 text-white font-bold">{{ saving ? '处理中…' : '确认撤销并退分' }}</button>
        </div>
      </fieldset>
    </form>
  </UiDialog>
</template>
<script setup>
import { reactive, ref } from 'vue';
import api from '../api/client';
import { getDataGeneration } from '../utils/session';
import { useFormDraft } from '../composables/useFormDraft';
import { restoreFormFields } from '../utils/formDrafts';
import UiDialog from './UiDialog.vue';
import FormDraftNotice from './FormDraftNotice.vue';
const props = defineProps({ redemption: { type: Object, required: true } });
const emit = defineEmits(['close', 'saved']);
const form = reactive({ reason: '' }), saving = ref(false), error = ref('');
const generation = getDataGeneration();
const draft = useFormDraft({ kind: 'refund', child_id: props.redemption.child_id, record_id: props.redemption.id }, {
  read: () => ({ form: { ...form } }), hasContent: data => Boolean(data.form.reason.trim()),
  apply: data => restoreFormFields(form, data.form), invalidated: () => emit('close')
});
async function save() {
  if (saving.value) return;
  saving.value = true; error.value = '';
  try {
    const attempt = draft.prepare({ reason: form.reason.trim() });
    const result = await api.refundRedemption(props.redemption.id, attempt.body, generation);
    draft.complete(); emit('saved', result);
  } catch (err) { draft.failed(err); error.value = typeof err === 'string' ? err : err.message; }
  finally { saving.value = false; }
}
</script>
