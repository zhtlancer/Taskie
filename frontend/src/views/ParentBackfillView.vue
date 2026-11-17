<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 pb-12">
    <ParentNavBar />
    <main class="max-w-3xl mx-auto p-4 sm:p-6 space-y-5">
      <ParentPageHeader :title="`${childName} · 家长补卡`" description="选择过去日期，为当天的普通任务补记完成，或标记跳过。未记录的日期按现有规则推算任务，请核对后补记。积分和完成度计入任务所属日期，补卡不计入当天完成时间统计。">
        <template #actions><router-link to="/parent/dashboard" class="ui-button-secondary inline-flex items-center">← 返回数据总览</router-link></template>
      </ParentPageHeader>
      <section aria-label="补卡日期" class="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
        <label class="block min-w-0 text-sm font-bold text-slate-700 dark:text-slate-200 sm:max-w-xs">
          任务日期
          <input :value="date" type="date" :max="yesterday" :disabled="locked || Boolean(studyTask)" class="ui-input ui-date-time mt-2" @change="changeDate" />
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">按家庭时区 {{ calendar.timeZone }} 选择日期，仅可补记昨天及更早的任务。</p>
      </section>
      <p v-if="notice" role="status" class="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-4 text-sm text-emerald-800 dark:text-emerald-200 break-words">{{ notice }}</p>
      <p v-if="actionError" role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-700 dark:text-rose-300 break-words">{{ actionError }}</p>
      <p v-if="busy" role="status" class="text-sm font-bold text-brand-600 dark:text-brand-300">正在保存补卡操作，请稍候…</p>
      <ParentPageState v-if="loading" kind="loading" title="正在读取补卡任务…" />
      <ParentPageState v-if="loadError" kind="error" title="补卡任务未能读取" :description="loadError" :busy="loading || locked" @retry="load" />
      <template v-if="!loading && !loadError && loadedContext === contextKey">
        <ParentPageState v-if="!tasks.length" title="当天没有需要完成的任务" description="长期任务请到“学习安排 → 长期任务”补记进度。">
          <template #actions><router-link :to="{ path: '/parent/goals', query: { child: childId } }" class="ui-button-secondary inline-flex items-center">查看长期任务</router-link></template>
        </ParentPageState>
        <article v-for="task in tasks" :key="task.id" :data-backfill-task="task.id" class="min-w-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 space-y-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1 basis-48">
              <h3 class="font-bold text-slate-800 dark:text-slate-100 break-words">{{ task.subject }} · {{ task.title }}</h3>
              <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400 mt-1">
                {{ task.is_completed ? (task.completion_source === 'parent_backfill' ? '已完成 · 家长补记' : '已完成') : task.is_skipped ? '已跳过，请先撤销跳过再补卡' : '未完成' }}
                · {{ task.is_completed ? task.earned_points ?? task.points : task.award_points ?? task.points }} 积分
                <span v-if="task.is_extra" class="text-violet-600 dark:text-violet-300"> · 额外挑战（不影响考核）</span>
                <template v-if="task.schedule_type === 'weekly_times'"> · 每周目标 {{ task.weekly_target_times }} 次</template>
                <template v-if="task.duration_seconds"> · 用时 {{ Math.round(task.duration_seconds / 60) }} 分钟</template>
                <span v-if="task.projected" class="text-amber-700 dark:text-amber-300"> · 按现有规则推算，请核对</span>
              </p>
            </div>
            <button v-if="canAct(task, 'undo')" type="button" :disabled="actionsDisabled" class="min-h-11 min-w-11 px-3 shrink-0 text-sm font-bold text-rose-600 dark:text-rose-300 disabled:opacity-50" @click="act(task, 'undo')">撤销补卡</button>
            <button v-else-if="canAct(task, 'unskip')" type="button" :disabled="actionsDisabled" class="min-h-11 min-w-11 px-3 shrink-0 text-sm font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50" @click="act(task, 'unskip')">撤销跳过</button>
            <button v-else-if="canAct(task, 'skip')" type="button" :disabled="actionsDisabled" class="min-h-11 min-w-11 px-3 shrink-0 text-sm font-bold text-slate-500 dark:text-slate-400 disabled:opacity-50" @click="act(task, 'skip')">标记跳过</button>
          </div>
          <p v-if="!task.is_completed && task.is_extra && !task.allow_extra" class="text-xs text-slate-500 dark:text-slate-400">本周目标已完成，该任务未开启额外完成。</p>
          <p v-if="task.origin === 'study' && !task.is_completed && !task.is_skipped" class="text-xs text-slate-500 dark:text-slate-400">字词学习需当天逐项练习，不能补记；确实没学可标记跳过，不影响全勤和连续打卡。</p>
          <button v-if="!task.projected && task.origin !== 'study' && (task.track_time || task.study_sessions)" type="button" :disabled="actionsDisabled" class="min-h-11 px-3 text-sm font-bold text-indigo-600 dark:text-indigo-300 disabled:opacity-50" @click="openStudy(task)">学习记录 / 补记用时</button>
          <p v-if="task.study_sessions?.managed" class="text-xs text-slate-500 dark:text-slate-400">已保存 {{ task.study_sessions.count }} 次学习 · 累计 {{ Math.round(task.study_sessions.seconds / 60) }} 分钟，补卡保留已有记录。</p>
          <form v-if="canAct(task, 'complete')" @submit.prevent="act(task, 'complete')">
            <fieldset :disabled="actionsDisabled" class="min-w-0 flex flex-wrap items-end gap-3">
              <label v-if="task.track_time && !task.study_sessions?.managed" class="block min-w-0 text-sm text-slate-600 dark:text-slate-300">
                实际用时（分钟，可不填）
                <input v-model="minutes[draftKey(task)]" type="number" min="1" max="720" step="1" class="ui-input block mt-2 w-32 max-w-full" />
              </label>
              <button :disabled="actionsDisabled" type="submit" class="ui-button-primary">补记完成</button>
            </fieldset>
          </form>
        </article>
        <section v-if="events.length" class="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4">
          <h3 class="font-bold mb-3">补卡操作记录</h3>
          <ul class="space-y-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            <li v-for="event in events" :key="event.id" class="break-words">{{ formatTime(event.created_at) }} · 家长{{ event.action === 'complete' ? '补记完成' : '撤销补卡' }}「{{ event.task_title }}」 · 积分 {{ event.points >= 0 ? '+' : '' }}{{ event.points }}</li>
          </ul>
        </section>
      </template>
    </main>
    <StudySessionsModal v-if="studyTask" :key="studyTask.id" :task-id="studyTask.homework ? undefined : studyTask.id" :record-id="studyTask.homework?.id" as-parent @close="closeStudy" @saved="load" />
  </div>
</template>

<script setup>
import { addDays } from '../utils/schedule.js';
import { useCalendarStore } from '../stores/calendar';
import { confirmAction, promptAction } from '../utils/confirmation';
import { getToken, getDataGeneration, hasSession } from '../utils/session.js';
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import ParentPageHeader from '../components/ParentPageHeader.vue';
import ParentPageState from '../components/ParentPageState.vue';
import StudySessionsModal from '../components/StudySessionsModal.vue';
const calendar = useCalendarStore(), route = useRoute();
const childId = computed(() => route.params.id);
const yesterday = computed(() => addDays(calendar.today, -1));
const date = ref(yesterday.value), childName = ref('孩子');
const contextKey = computed(() => `${childId.value}/${date.value}`);
const tasks = ref([]), events = ref([]), minutes = ref({}), loadedContext = ref('');
const studyTask = ref(null), loading = ref(true), busy = ref(false), confirming = ref(false);
const loadError = ref(''), actionError = ref(''), notice = ref('');
const locked = computed(() => busy.value || confirming.value);
const actionsDisabled = computed(() => locked.value || loading.value || Boolean(loadError.value) || loadedContext.value !== contextKey.value || Boolean(studyTask.value));
let alive = true, requestId = 0, contextVersion = 0, nameRequest = 0, controller;
const errorText = err => typeof err === 'string' ? err : err?.message || '操作失败，请重试';
const formatTime = value => new Date(value).toLocaleString('zh-CN', { hour12: false, timeZone: calendar.timeZone });
const silent = { silentError: true };
// Projections get real IDs on materialization. A draft belongs to its source within this child/day.
const draftKey = task => task.class_id ? `class:${task.class_id}:${task.class_lesson_date}` : task.template_id ? `template:${task.template_id}` : task.id;

function canAct(task, action) {
  if (action === 'complete') return task.origin !== 'study' && task.origin !== 'goal' && !task.is_completed && !task.is_skipped && (!task.is_extra || task.allow_extra);
  if (action === 'undo') return Boolean(task.is_completed && task.completion_source === 'parent_backfill');
  if (action === 'skip') return !task.is_completed && !task.is_skipped && !task.is_extra;
  return action === 'unskip' && Boolean(task.is_skipped);
}

async function load() {
  if (!alive || busy.value) return;
  const id = ++requestId, key = contextKey.value, owner = getToken('parent');
  controller?.abort(); controller = new AbortController();
  const current = () => alive && id === requestId && key === contextKey.value && owner === getToken('parent');
  loading.value = true; loadError.value = '';
  const parsed = new Date(`${date.value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date.value || date.value > yesterday.value) {
    loadError.value = '请选择早于今天的有效日期'; loading.value = false; return;
  }
  try {
    const result = await api.getBackfillTasks(childId.value, date.value, controller.signal, silent);
    if (!current()) return;
    tasks.value = result.tasks; events.value = result.events; loadedContext.value = key;
    for (const task of result.tasks) if (task.is_completed) delete minutes.value[draftKey(task)];
  } catch (err) { if (current()) loadError.value = errorText(err); }
  finally { if (current()) loading.value = false; }
}

async function loadName() {
  const id = ++nameRequest, child = childId.value, owner = getToken('parent');
  try {
    const rows = await api.getChildren(undefined, silent);
    if (alive && id === nameRequest && child === childId.value && owner === getToken('parent')) childName.value = rows.find(row => row.id === child)?.name || '孩子';
  } catch { /* The task endpoint reports child access errors independently. */ }
}

function changeDate(event) {
  if (locked.value || studyTask.value) { event.target.value = date.value; return; }
  date.value = event.target.value;
}
function resetContext() {
  ++contextVersion; ++requestId; controller?.abort();
  tasks.value = []; events.value = []; minutes.value = {}; loadedContext.value = '';
  studyTask.value = null; loadError.value = ''; actionError.value = ''; notice.value = '';
  load();
}
watch([childId, date], ([child], [previous]) => {
  if (child !== previous) { childName.value = '孩子'; loadName(); }
  resetContext();
}, { flush: 'sync' });
watch(yesterday, (value, previous) => {
  if (date.value === previous && !locked.value && !studyTask.value && !Object.values(minutes.value).some(value => value !== '' && value != null)) date.value = value;
});

function openStudy(task) { if (!actionsDisabled.value && tasks.value.includes(task)) studyTask.value = task; }
function closeStudy() { studyTask.value = null; load(); }
const authDestination = to => !hasSession('parent') || ['/parent/login', '/parent/setup-pin'].includes(to.path);
onBeforeRouteLeave(to => authDestination(to) || (!busy.value && !studyTask.value));
onBeforeRouteUpdate(() => { if (busy.value || studyTask.value) return false; });

// A generated row must still describe the operation the parent just confirmed.
const confirmationKey = task => JSON.stringify([task.title, task.subject, task.award_points ?? task.points, Boolean(task.track_time), Boolean(task.study_sessions?.managed), Boolean(task.is_extra), Boolean(task.allow_extra)]);
async function act(task, action) {
  if (actionsDisabled.value || !tasks.value.includes(task) || !canAct(task, action)) return;
  const scope = { version: contextVersion, read: requestId, key: contextKey.value, child: childId.value, date: date.value,
    owner: getToken('parent'), generation: getDataGeneration() };
  const current = () => alive && scope.version === contextVersion && scope.read === requestId && scope.key === contextKey.value && scope.owner === getToken('parent') && scope.generation === getDataGeneration();
  const value = minutes.value[draftKey(task)];
  const directDuration = task.track_time && !task.study_sessions?.managed;
  if (action === 'complete' && directDuration && value !== '' && value != null && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 720)) {
    actionError.value = '实际用时请填写 1 至 720 的整数分钟，或留空'; return;
  }
  confirming.value = true; actionError.value = ''; notice.value = '';
  let reason = '', accepted;
  try {
    if (action === 'skip') {
      reason = await promptAction(`标记${childName.value} ${task.date} 的「${task.title}」为跳过，请写下理由（不超过 50 字）：`, '家长补登请假');
      accepted = reason !== null;
    } else {
      const message = action === 'complete'
        ? `为${childName.value}补记 ${task.date} 的「${task.title}」完成？${task.is_extra ? '额外完成，' : ''}将增加 ${task.award_points ?? task.points} 积分。`
        : action === 'undo'
          ? `撤销${childName.value} ${task.date} 的「${task.title}」补卡？将扣回 ${task.earned_points ?? task.points} 积分，已兑换时余额可能为负。`
          : `撤销 ${task.date} 的「${task.title}」跳过状态？`;
      accepted = await confirmAction(message);
    }
  } finally { confirming.value = false; }
  if (!accepted || !alive) return;
  if (!current() || loading.value || loadError.value || !tasks.value.includes(task) || !canAct(task, action)) {
    if (scope.key === contextKey.value) actionError.value = '当前孩子、日期或任务已变化，请核对后重新操作';
    return;
  }
  busy.value = true;
  try {
    let target = task;
    if (task.projected) {
      const result = await api.materializeBackfillDay(scope.child, scope.date, silent);
      if (!current()) return;
      target = result.tasks.find(item => !item.projected && draftKey(item) === draftKey(task));
      if (!target || !canAct(target, action) || confirmationKey(target) !== confirmationKey(task)) throw '当天的任务已变化，请核对最新任务后重试';
    }
    if (!current()) return;
    if (action === 'complete') await api.backfillDailyTask(target.id, { duration_seconds: directDuration && value !== '' && value != null ? Number(value) * 60 : null }, silent);
    else if (action === 'undo') await api.undoBackfillDailyTask(target.id, silent);
    else if (action === 'skip') await api.skipDailyTask(target.id, reason, silent);
    else await api.unskipDailyTask(target.id, silent);
    if (current()) {
      const label = { complete: '补记完成', undo: '撤销补卡', skip: '标记跳过', unskip: '撤销跳过' }[action];
      notice.value = `已保存「${task.title}」的${label}操作。`;
      if (action === 'complete') delete minutes.value[draftKey(task)];
    }
  } catch (err) { if (current()) actionError.value = errorText(err); }
  finally {
    busy.value = false;
    if (alive && scope.version !== contextVersion) load();
  }
  // Reading has its own error state; a failed refresh never replaces an accepted write's result.
  if (current()) load();
}

const dataRestored = () => { resetContext(); loadName(); };
onMounted(() => { load(); loadName(); window.addEventListener('taskie:data-restored', dataRestored); });
onBeforeUnmount(() => {
  alive = false; ++contextVersion; ++requestId; ++nameRequest; controller?.abort();
  window.removeEventListener('taskie:data-restored', dataRestored);
});
</script>
