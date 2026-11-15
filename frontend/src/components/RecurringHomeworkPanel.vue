<template>
  <UiDialog title="周期作业" wide :busy="busy" @close="$emit('close')">
    <div class="space-y-3">
      <p class="text-sm text-slate-500 dark:text-slate-400">每周自动生成作业，内容可之后补充。停用或删除模板会保留已经生成的作业。</p>
      <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      <button type="button" :disabled="busy || loading" class="min-h-11 px-4 rounded-xl bg-brand-500 text-white font-bold disabled:opacity-50" @click="form = { template: null }">新增周期作业</button>
      <p v-if="loading" role="status">正在读取…</p>
      <button v-else-if="loadFailed" type="button" class="min-h-11 px-4 rounded-xl border border-slate-300 dark:border-slate-700" @click="load">重新读取</button>
      <p v-else-if="!templates.length" class="text-sm text-slate-500 dark:text-slate-400">还没有周期作业模板。</p>
      <ul v-else class="space-y-3">
        <li v-for="item in templates" :key="item.id" :data-recurring-id="item.id" class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <div class="flex flex-wrap justify-between gap-2 font-bold"><span class="break-words">{{ item.subject }}</span><span class="text-sm text-slate-500 dark:text-slate-400">{{ item.end_date && item.end_date < today ? '已结束' : item.enabled ? '已启用' : '已停用' }}</span></div>
          <p class="text-sm text-slate-500 dark:text-slate-400">每{{ WEEKDAY_NAMES[item.weekday] }}生成 · {{ item.start_date }} 起<template v-if="item.end_date">，至 {{ item.end_date }}</template> · {{ item.points }} 分</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">本期 {{ item.period_date }} · {{ item.occurrence?.skipped ? '已跳过' : item.occurrence?.homework_id ? '已生成作业' : item.occurrence ? '作业已删除' : '尚未生成' }}</p>
          <div class="flex flex-wrap gap-2">
            <button type="button" :disabled="busy" class="min-h-11 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="form = { template: item }">修改模板</button>
            <button type="button" :disabled="busy || item.occurrence?.skipped || Boolean(item.end_date && item.period_date > item.end_date)" class="min-h-11 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold disabled:opacity-40" @click="skip(item)">跳过本期</button>
            <button type="button" :disabled="busy" class="min-h-11 px-3 rounded-xl text-rose-600 dark:text-rose-300 font-bold" @click="remove(item)">删除模板</button>
          </div>
        </li>
      </ul>
    </div>
  </UiDialog>
  <RecurringHomeworkForm v-if="form" :child-id="childId" :today="today" :template="form.template" @close="form = null; load()" @saved="saved" />
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client';
import UiDialog from './UiDialog.vue';
import RecurringHomeworkForm from './RecurringHomeworkForm.vue';
import { WEEKDAY_NAMES } from '../utils/schedule';
import { confirmAction } from '../utils/confirmation';
import { getDataGeneration } from '../utils/session';
const props = defineProps({ childId: { type: String, required: true }, today: { type: String, required: true } });
const emit = defineEmits(['close', 'saved']);
const templates = ref([]), loading = ref(true), loadFailed = ref(false), busy = ref(false), error = ref(''), form = ref(null);
const generation = getDataGeneration();
let alive = true;
async function load() {
  loading.value = true; loadFailed.value = false;
  try { const rows = await api.getRecurringHomework(props.childId); if (alive) templates.value = rows; }
  catch (err) { if (alive) { loadFailed.value = true; error.value = err.message || String(err); } }
  finally { if (alive) loading.value = false; }
}
async function act(fn) {
  busy.value = true; error.value = '';
  try { await fn(); await load(); emit('saved'); }
  catch (err) { error.value = err.message || String(err); await load(); }
  finally { busy.value = false; }
}
async function skip(item) {
  if (!await confirmAction(`跳过 ${item.period_date} 的「${item.subject}」作业？已生成且未完成的任务会标记为跳过，学习记录保留。`)) return;
  await act(() => api.skipRecurringHomework(item.id, { date: item.period_date, expected_version: item.edit_version }, generation));
}
async function remove(item) {
  if (!await confirmAction(`删除「${item.subject}」周期模板？已生成的作业和学习记录会保留，之后不再自动生成。`)) return;
  await act(() => api.deleteRecurringHomework(item.id, item.edit_version, generation));
}
async function saved() { form.value = null; await load(); emit('saved'); }
const restored = () => emit('close');
onMounted(() => { load(); window.addEventListener('taskie:data-restored', restored); });
onBeforeUnmount(() => { alive = false; window.removeEventListener('taskie:data-restored', restored); });
</script>
