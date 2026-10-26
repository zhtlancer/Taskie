<template>
  <HomeworkFormModal v-if="record" :record="record" :child-id="childId" :today="today" as-parent
    @close="$emit('close')" @saved="$emit('saved')" />
  <UiDialog v-else title="修改作业记录" @close="$emit('close')">
    <p v-if="loading" role="status" class="text-sm text-slate-500 dark:text-slate-400">正在读取作业记录…</p>
    <div v-else class="space-y-3">
      <p role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      <button type="button" class="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white font-bold" @click="load">重新读取</button>
    </div>
  </UiDialog>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client';
import UiDialog from './UiDialog.vue';
import HomeworkFormModal from './HomeworkFormModal.vue';
const props = defineProps({ recordId: { type: String, required: true }, childId: { type: String, required: true }, today: { type: String, required: true } });
const emit = defineEmits(['close', 'saved']);
const record = ref(null), loading = ref(true), error = ref('');
let controller;
async function load() {
  controller?.abort();
  const current = controller = new AbortController();
  loading.value = true; error.value = '';
  try {
    const result = await api.getHomeworkRecord(props.recordId, current.signal);
    if (current.signal.aborted) return;
    if (result.child_id !== props.childId) throw '这条作业不属于当前孩子，请重新读取任务';
    record.value = result;
  } catch (err) {
    if (!current.signal.aborted) error.value = typeof err === 'string' ? err : '作业记录读取失败，请重试';
  } finally { if (!current.signal.aborted) loading.value = false; }
}
const restored = () => emit('close');
onMounted(() => { load(); window.addEventListener('taskie:data-restored', restored); });
onBeforeUnmount(() => { controller?.abort(); window.removeEventListener('taskie:data-restored', restored); });
</script>
