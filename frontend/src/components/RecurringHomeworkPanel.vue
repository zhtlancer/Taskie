<template>
  <section data-recurring-panel aria-label="周期作业模板">
    <div class="space-y-3">
      <p class="text-sm text-slate-500 dark:text-slate-400">每周自动生成作业，内容可之后补充。停用或删除模板会保留已经生成的作业。</p>
      <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      <button v-if="showCreateButton" type="button" :disabled="busy || loading || Boolean(loadError)" class="ui-button-primary" @click="openCreate">新增周期作业</button>
      <ParentPageState v-if="loading" kind="loading" title="正在读取周期作业…" />
      <ParentPageState v-if="loadError" kind="error" title="周期作业未能读取" :description="loadError" :busy="loading" @retry="load" />
      <ParentPageState v-if="!loading && !loadError && !templates.length" title="还没有周期作业模板。" description="设置课程、每周生成日和周期起止日期，内容可在每一期生成后补充。" />
      <ul v-if="!loading && templates.length" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <li v-for="item in templates" :key="item.id" :data-recurring-id="item.id" class="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div class="flex flex-wrap justify-between gap-2 font-bold"><span class="break-words">{{ item.subject }}</span><span class="text-sm text-slate-500 dark:text-slate-400">{{ item.end_date && item.end_date < today ? '已结束' : item.enabled ? '已启用' : '已停用' }}</span></div>
          <p class="text-sm text-slate-500 dark:text-slate-400">每{{ WEEKDAY_NAMES[item.weekday] }}生成 · {{ item.start_date }} 起<template v-if="item.end_date">，至 {{ item.end_date }}</template> · {{ item.points }} 分</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">本期 {{ item.period_date }} · {{ item.occurrence?.skipped ? '已跳过' : item.occurrence?.homework_id ? '已生成作业' : item.occurrence ? '作业已删除' : '尚未生成' }}</p>
          <div class="flex flex-wrap gap-2 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button type="button" :disabled="busy || Boolean(loadError)" class="min-h-11 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="form = { template: item }">修改模板</button>
            <button type="button" :disabled="busy || Boolean(loadError) || item.occurrence?.skipped || Boolean(item.end_date && item.period_date > item.end_date)" class="min-h-11 px-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold disabled:opacity-40" @click="skip(item)">跳过本期</button>
            <button type="button" :disabled="busy || Boolean(loadError)" class="min-h-11 px-3 rounded-xl text-rose-600 dark:text-rose-300 font-bold" @click="remove(item)">删除模板</button>
          </div>
        </li>
      </ul>
    </div>
  </section>
  <RecurringHomeworkForm v-if="form" :child-id="childId" :today="today" :template="form.template" @close="form = null; load()" @saved="saved" />
</template>
<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client';
import RecurringHomeworkForm from './RecurringHomeworkForm.vue';
import ParentPageState from './ParentPageState.vue';
import { WEEKDAY_NAMES } from '../utils/schedule';
import { confirmAction } from '../utils/confirmation';
import { getDataGeneration } from '../utils/session';
const props = defineProps({ childId: { type: String, required: true }, today: { type: String, required: true }, showCreateButton: { type: Boolean, default: true } });
const emit = defineEmits(['saved', 'busy']);
const templates = ref([]), loading = ref(true), loadError = ref(''), busy = ref(false), error = ref(''), form = ref(null);
const generation = getDataGeneration();
watch(() => busy.value || Boolean(form.value), value => emit('busy', value));
function openCreate() { if (!loading.value && !busy.value && !loadError.value) form.value = { template: null }; }
defineExpose({ openCreate, loading, loadError });
let alive = true;
async function load() {
  loading.value = true;
  try { const rows = await api.getRecurringHomework(props.childId); if (alive) { templates.value = rows; loadError.value = ''; } }
  catch (err) { if (alive) { loadError.value = err.message || String(err); } }
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
const restored = () => { form.value = null; load(); };
onMounted(() => { load(); window.addEventListener('taskie:data-restored', restored); });
onBeforeUnmount(() => { alive = false; window.removeEventListener('taskie:data-restored', restored); });
</script>
