<template>
  <UiDialog :title="restoring ? '恢复为待完成' : '确认未完成'" :busy="saving" @close="$emit('close')">
    <form class="space-y-4" @submit.prevent="save">
      <p class="font-bold break-words">{{ task.title }}</p>
      <p class="text-sm text-slate-500 dark:text-slate-400">{{ restoring
        ? '恢复后孩子可以继续完成。只退还本次额外扣分，完成奖励需重新完成后获得。'
        : '确认后结束这一次任务，计入未完成；孩子需等家长恢复后才能继续完成。已有计时记录保留。' }}</p>
      <fieldset :disabled="saving || uncertain" class="space-y-4 min-w-0">
        <template v-if="!restoring">
          <label class="block text-sm font-bold">未完成原因（必填）
            <textarea v-model="reason" required maxlength="150" rows="2" placeholder="例如：未在学校记录作业" class="ui-input mt-1 w-full" />
          </label>
          <label class="flex items-center gap-2 min-h-11 text-sm font-bold"><input v-model="deduct" type="checkbox" class="w-5 h-5 shrink-0" />额外扣分（可选）</label>
          <label v-if="deduct" class="block text-sm font-bold">额外扣除积分
            <input v-model.number="penalty" type="number" min="1" max="10000" step="1" required class="ui-input mt-1 w-full" />
          </label>
        </template>
        <p v-else class="text-sm break-words">确认原因：{{ task.failure_reason }}</p>
      </fieldset>
      <p class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200" role="status">{{ impact }}</p>
      <p v-if="uncertain" class="text-sm text-amber-700 dark:text-amber-300">保存结果尚未确认，请按原内容重试。</p>
      <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <button type="button" :disabled="saving" class="ui-button-secondary" @click="$emit('close')">取消</button>
        <button type="submit" :disabled="saving || invalidated || (!restoring && (!reason.trim() || (deduct && !validPenalty)))" class="ui-button-primary">{{ saving ? '保存中…' : uncertain ? '重试确认' : restoring ? '恢复为待完成' : '确认未完成' }}</button>
      </div>
    </form>
  </UiDialog>
</template>
<script setup>
import { computed, ref } from 'vue';
import UiDialog from './UiDialog.vue';
import api from '../api/client';
import { getDataGeneration } from '../utils/session.js';
import { newRequestId } from '../utils/requestId.js';
import { useAsyncScope } from '../composables/useAsyncScope.js';
const props = defineProps({ task: { type: Object, required: true } });
const emit = defineEmits(['close', 'saved']);
const restoring = Boolean(props.task.is_failed), generation = getDataGeneration();
const reason = ref(''), deduct = ref(false), penalty = ref(1), saving = ref(false), uncertain = ref(false), error = ref('');
const invalidated = ref(false);
const validPenalty = computed(() => Number.isSafeInteger(penalty.value) && penalty.value >= 1 && penalty.value <= 10000);
const impact = computed(() => restoring ? `退还额外扣分 ${props.task.failure_penalty || 0} 分。`
  : `收回完成奖励 ${props.task.is_completed ? props.task.earned_points ?? props.task.points : 0} 分，额外扣除 ${deduct.value && validPenalty.value ? penalty.value : 0} 分。积分不足时余额可能为负。`);
let attempt;
const { capture } = useAsyncScope(() => [props.task.id], () => { invalidated.value = true; error.value = '会话或数据已变化，请关闭后重新打开。'; });
async function save() {
  if (saving.value || invalidated.value) return;
  saving.value = true; error.value = '';
  const current = capture();
  try {
    attempt ||= restoring ? { failure_id: props.task.failure_id } : {
      request_id: newRequestId(), reason: reason.value.trim(), penalty: deduct.value ? penalty.value : 0,
      expected_completed_at: props.task.completed_at ?? null
    };
    await api[restoring ? 'restoreTaskFailure' : 'confirmTaskFailure'](props.task.id, attempt, generation);
    if (current()) emit('saved');
  } catch (err) {
    if (!current()) return;
    uncertain.value = Boolean(err?.networkFailure);
    error.value = err?.message || (typeof err === 'string' ? err : '保存失败，请重试');
    if (!uncertain.value) attempt = null;
  } finally { saving.value = false; }
}
</script>
