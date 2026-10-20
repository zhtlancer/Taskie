<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-3" @click.self="!busy && $emit('close')">
    <section class="bg-white rounded-3xl p-5 max-w-xl w-full max-h-[92dvh] overflow-y-auto space-y-4" role="dialog" aria-modal="true" :aria-label="taskId ? '分次学习' : '分次做作业'">
      <header class="flex items-center justify-between gap-3"><h3 class="font-black text-lg">📒 {{ taskId ? '分次学习' : '分次做作业' }}</h3><button :disabled="busy" class="p-3 disabled:opacity-50" aria-label="关闭" @click="$emit('close')">✕</button></header>
      <p v-if="error" role="alert" class="bg-rose-50 text-rose-600 rounded-xl p-3 text-sm">{{ error }}</p>
      <p v-if="!study" class="text-slate-400">正在加载学习记录…</p>
      <template v-else>
        <p class="whitespace-pre-line text-sm font-bold">{{ study.record.subject }}：{{ study.record.content }}</p>
        <p class="text-xs text-slate-500">{{ taskId ? '任务' : '作业' }}截止 {{ study.record.task.due_date }} · 已保存累计 {{ formatDuration(study.total_seconds) }} · {{ study.sessions.length }} 次学习</p>
        <p v-if="study.record.task.expected_minutes" class="text-xs text-slate-500">整项任务预计 {{ study.record.task.expected_minutes }} 分钟<span v-if="pace"> · {{ pace.text }}</span></p>
        <p v-if="study.legacy_seconds" class="text-xs text-slate-400">其中旧累计用时 {{ formatDuration(study.legacy_seconds) }}，保留原值，没有分次明细。</p>
        <p v-if="study.record.completion_requested_at && !study.record.task.is_completed" class="bg-amber-50 rounded-xl p-3 text-sm text-amber-700">已申请全部完成，等待家长确认。仍可继续学习、记录用时。</p>
        <p v-if="study.record.task.is_completed" class="text-emerald-600 font-bold">✓ {{ taskId ? '任务已完成' : '作业已全部完成' }}</p>
        <p v-else-if="overdue && !taskId" class="text-amber-700 text-xs">已过截止日期，可以继续学习；全部完成需家长确认。</p>

        <p v-if="taskId && overdue && !asParent" class="text-amber-700 text-xs">任务已超期，请由家长补卡。已有学习记录和用时保留。</p>
        <div v-if="!study.record.task.is_completed && !study.record.task.is_skipped" class="rounded-2xl bg-indigo-50 p-4 space-y-3">
          <div class="text-2xl font-black tabular-nums">{{ formatClock(elapsed) }} <span class="text-xs font-normal">{{ study.active ? (study.active.timer_started_at ? '正在计时' : '已暂停') : '本次学习' }}</span></div>
          <div class="flex flex-wrap gap-2">
            <button v-if="!study.active?.timer_started_at && canStart" :disabled="busy" class="rounded-xl px-4 py-3 bg-indigo-600 text-white disabled:opacity-50" @click="act(() => studyApi.start())">{{ study.active ? '继续本次' : '开始本次' }}</button>
            <button v-else-if="study.active?.timer_started_at" :disabled="busy" class="rounded-xl px-4 py-3 bg-white border disabled:opacity-50" @click="act(() => studyApi.pause(study.active.id))">暂停</button>
            <button v-if="study.active" :disabled="busy" class="rounded-xl px-4 py-3 bg-white border disabled:opacity-50" @click="finish(false)">结束本次学习</button>
          </div>
          <label class="block text-xs">本次进展（选填）<textarea v-model="note" maxlength="500" rows="2" placeholder="例如：写完第一部分，剩下两题明天做" class="mt-1 w-full rounded-xl border p-3 text-sm" /></label>
          <button v-if="canComplete" :disabled="busy" class="rounded-xl px-4 py-3 bg-emerald-600 text-white disabled:opacity-50" @click="finish(true)">{{ taskId ? (study.active ? '结束计时并完成任务' : '完成任务') : overdue && !asParent ? '申请作业全部完成' : '作业全部完成' }}</button>
          <p class="text-xs text-slate-500">暂停后继续属于同一次；结束后再开始是新的一次。同一天可记录多次，完成奖励只结算一次。关闭此窗口后，正在进行的计时仍继续。</p>
        </div>
        <div class="flex flex-wrap gap-3">
          <button :disabled="busy" class="text-sm text-indigo-600 py-2" @click="manualOpen = !manualOpen">＋ 手动补记学习</button>
          <button v-if="study.record.task.is_completed && (asParent || !overdue)" :disabled="busy" class="text-sm text-slate-500 py-2" @click="undo">撤销全部完成</button>
          <template v-if="asParent && study.record.completion_requested_at && !study.record.task.is_completed">
            <button :disabled="busy || Boolean(study.active)" class="text-sm text-emerald-700 py-2" @click="act(() => api.completeHomework(recordId))">确认全部完成</button>
            <button :disabled="busy" class="text-sm text-slate-500 py-2" @click="act(() => api.rejectHomeworkCompletion(recordId))">暂不确认</button>
          </template>
        </div>
        <form v-if="manualOpen" class="rounded-xl border p-3 space-y-2" @submit.prevent="manual">
          <label class="block text-sm">学习日期 <input v-model="manualDate" type="date" :disabled="!asParent" :min="study.record.assigned_date" :max="today" required class="border rounded-lg p-2" /></label>
          <label class="block text-sm">本次用时（分钟）<input v-model.number="manualMinutes" type="number" min="0" max="720" step="0.1" required class="border rounded-lg p-2 w-24" /></label>
          <textarea v-model="manualNote" maxlength="500" placeholder="本次进展（选填）" class="border rounded-xl p-2 w-full" />
          <button :disabled="busy" class="bg-indigo-600 text-white rounded-xl px-4 py-2">保存本次</button>
        </form>
        <div class="space-y-3">
          <h4 class="font-bold">学习记录</h4>
          <p v-if="!study.sessions.length" class="text-xs text-slate-400">还没有已结束的学习记录。</p>
          <article v-for="session in study.sessions" :key="session.id" class="border rounded-xl p-3 text-sm space-y-2">
            <div>{{ session.days.length ? session.days.map(day => day.date).join(' / ') : dateOf(session.started_at) }} · {{ formatDuration(session.duration_seconds) }}</div>
            <p v-if="session.days.length > 1" class="text-xs text-slate-400">跨日用时：{{ session.days.map(day => `${day.date} ${formatDuration(day.seconds)}`).join('；') }}</p>
            <p class="whitespace-pre-line text-slate-600">{{ session.note || '未填写进展' }}</p>
            <button v-if="canEdit(session)" :disabled="busy" class="text-indigo-600 text-xs py-2" @click="openEdit(session)">更正本次记录</button>
            <form v-if="editing?.id === session.id" class="space-y-2" @submit.prevent="saveEdit">
              <label v-for="day in editing.days" :key="day.date" class="block text-xs">{{ day.date }} 用时（分钟）<input v-model.number="day.minutes" type="number" min="0" max="720" step="0.1" required class="border rounded-lg p-2 w-24" /></label>
              <textarea v-model="editing.note" maxlength="500" class="border rounded-xl p-2 w-full" />
              <button :disabled="busy" class="bg-indigo-600 text-white rounded-lg px-3 py-2">保存更正</button>
              <button type="button" class="px-3 py-2" @click="editing = null">取消</button>
            </form>
          </article>
        </div>
      </template>
    </section>
  </div>
</template>
<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import api from '../api/client';
import { formatDuration, formatClock, paceLabel } from '../utils/taskTimer.js';
import { localDate } from '../utils/schedule.js';
const props = defineProps({ recordId: String, taskId: String, asParent: Boolean });
const studyApi = {
  get: () => props.taskId ? api.getTaskStudy(props.taskId) : api.getHomeworkStudy(props.recordId),
  start: () => props.taskId ? api.startTaskStudy(props.taskId) : api.startHomeworkStudy(props.recordId),
  pause: sid => props.taskId ? api.pauseTaskStudy(props.taskId, sid) : api.pauseHomeworkStudy(props.recordId, sid),
  finish: (sid, data) => props.taskId ? api.finishTaskStudy(props.taskId, sid, data) : api.finishHomeworkStudy(props.recordId, sid, data),
  complete: () => props.taskId ? api.completeTaskStudy(props.taskId) : api.completeHomework(props.recordId),
  add: data => props.taskId ? api.addTaskStudy(props.taskId, data) : api.addHomeworkStudy(props.recordId, data),
  edit: (sid, data) => props.taskId ? api.editTaskStudy(props.taskId, sid, data) : api.editHomeworkStudy(props.recordId, sid, data)
};
const emit = defineEmits(['close', 'saved']);
const requestId = () => globalThis.crypto?.randomUUID?.() || `study_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const study = ref(null), error = ref(''), busy = ref(false), note = ref(''), now = ref(Date.now());
const manualOpen = ref(false), manualDate = ref(localDate()), manualMinutes = ref(0), manualNote = ref(''), manualId = ref(requestId()), editing = ref(null);
const today = computed(() => localDate(new Date(now.value)));
const dateOf = iso => localDate(new Date(iso));
const overdue = computed(() => study.value && study.value.record.task.due_date < today.value);
const canStart = computed(() => !props.taskId || (study.value?.record.task.track_time && !overdue.value && study.value?.record.assigned_date <= today.value));
const canComplete = computed(() => !props.taskId || props.asParent || !overdue.value);
const elapsed = computed(() => {
  const active = study.value?.active;
  if (!active) return 0;
  return Math.min(43200, active.timer_seconds + (active.timer_started_at ? Math.max(0, Math.floor((now.value - active.loaded_at) / 1000)) : 0));
});
const pace = computed(() => {
  if (!study.value) return null;
  const seconds = study.value.total_seconds + elapsed.value;
  const expected = study.value.record.task.expected_minutes;
  return expected && seconds === expected * 60 ? { text: '已达到预计用时' } : paceLabel(seconds, expected);
});
let clock, refresh, requestSerial = 0;
const hydrate = value => ({ ...value, active: value.active ? { ...value.active, loaded_at: Date.now() } : null });
async function load() {
  const serial = ++requestSerial;
  const result = await studyApi.get();
  if (serial === requestSerial && !busy.value) study.value = hydrate(result);
}
async function act(fn) {
  if (busy.value) return;
  busy.value = true; requestSerial += 1; error.value = '';
  try { study.value = hydrate(await fn()); emit('saved'); }
  catch (err) { error.value = typeof err === 'string' ? err : '操作失败，请重试'; }
  finally { busy.value = false; }
}
async function finish(complete) {
  await act(() => study.value.active ? studyApi.finish(study.value.active.id, { note: note.value, complete }) : studyApi.complete());
  if (!error.value) note.value = '';
}
async function manual() {
  await act(() => studyApi.add({ request_id: manualId.value, date: manualDate.value, duration_seconds: Math.round(manualMinutes.value * 60), note: manualNote.value }));
  if (!error.value) { manualId.value = requestId(); manualOpen.value = false; manualNote.value = ''; manualMinutes.value = 0; }
}
const canEdit = session => props.asParent || (session.days.length ? session.days.every(day => day.date === today.value) : dateOf(session.started_at) === today.value);
function openEdit(session) { editing.value = { id: session.id, note: session.note, days: (session.days.length ? session.days : [{ date: dateOf(session.started_at), seconds: 0 }]).map(day => ({ ...day, minutes: day.seconds / 60 })) }; }
async function saveEdit() {
  const days = editing.value.days.map(day => ({ date: day.date, seconds: Math.round(day.minutes * 60) }));
  await act(() => studyApi.edit(editing.value.id, { duration_seconds: days.reduce((n, day) => n + day.seconds, 0), days, note: editing.value.note }));
  if (!error.value) editing.value = null;
}
async function undo() { await act(async () => { await api.uncompleteDailyTask(study.value.record.task.id); return studyApi.get(); }); }
onMounted(async () => {
  try { await load(); } catch (err) { error.value = typeof err === 'string' ? err : '读取失败'; }
  clock = setInterval(() => { now.value = Date.now(); }, 1000);
  refresh = setInterval(() => { if (!busy.value) load().catch(() => {}); }, 10000);
});
onUnmounted(() => { clearInterval(clock); clearInterval(refresh); });
</script>
