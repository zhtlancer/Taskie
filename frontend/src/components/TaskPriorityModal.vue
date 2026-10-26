<template>
  <UiDialog title="调整优先级" :busy="saving" @close="$emit('close')">
    <form class="space-y-4" @submit.prevent="save(priority)">
      <p class="font-bold break-words">{{ task.title }}</p>
      <p class="text-xs text-slate-500 dark:text-slate-400">只调整这一次任务，后续任务继续使用来源的默认优先级。</p>
      <fieldset :disabled="saving" class="space-y-4">
        <PriorityFields v-model="priority" />
        <button v-if="task.priority_override !== null" type="button" class="min-h-[44px] px-3 rounded-xl text-sm text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40" @click="save(null)">恢复默认（{{ labels[task.default_priority ?? 1] }}）</button>
        <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="min-h-[44px] px-4 rounded-xl text-slate-500 dark:text-slate-400" @click="$emit('close')">取消</button>
          <button type="submit" class="min-h-[44px] px-5 rounded-xl bg-brand-500 text-white font-bold">{{ saving ? '保存中…' : '保存' }}</button>
        </div>
      </fieldset>
    </form>
  </UiDialog>
</template>
<script setup>
import { ref } from 'vue';
import api from '../api/client';
import { getDataGeneration } from '../utils/session.js';
import UiDialog from './UiDialog.vue';
import PriorityFields from './PriorityFields.vue';
const props = defineProps({ task: { type: Object, required: true } });
const emit = defineEmits(['close', 'saved']);
const priority = ref(props.task.priority ?? 1), saving = ref(false), error = ref('');
const generation = getDataGeneration();
const labels = ['低', '普通', '高'];
async function save(value) {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  try { await api.setTaskPriority(props.task.id, value, generation); emit('saved'); }
  catch (err) { error.value = typeof err === 'string' ? err : '保存失败，请重试'; }
  finally { saving.value = false; }
}
</script>
