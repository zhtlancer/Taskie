<template>
  <UiDialog title="今天的课" :busy="busy" wide @close="$emit('close')">
    <template #title>
      今天的课
      <span v-if="today.week" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 text-xs">{{ today.week }}周</span>
    </template>
    <div class="space-y-4">
      <p v-if="asParent" class="text-sm font-bold text-violet-700 dark:text-violet-300">只对 {{ childName }} 生效</p>
      <div v-if="dateChanged" role="status" class="rounded-xl p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-sm">
        <p>日期已变化，请重新操作</p>
        <button v-if="staleSchedule" type="button" :disabled="busy" class="min-h-11 min-w-11 underline font-bold" @click="refreshOnly">刷新日程和打卡任务</button>
      </div>
      <div v-if="sessionExpired" role="alert" class="rounded-xl p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-sm">
        <p>家长登录已过期，请重新登录</p>
        <router-link v-if="!busy" :to="{ path: '/parent/login', query: { returnTo: `/child/${childId}/today` } }" class="inline-flex items-center min-h-11 underline font-bold">重新登录</router-link>
      </div>
      <div v-if="error" role="alert" class="rounded-xl p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm">
        <p>{{ error }}</p>
        <button type="button" :disabled="busy" class="min-h-11 min-w-11 underline font-bold" @click="refreshOnly">刷新日程和打卡任务</button>
      </div>

      <!-- Outside classes first: when and where the child has to be -->
      <section v-if="today.outside.length">
        <h4 class="text-xs font-black text-violet-600 dark:text-violet-300 mb-1.5">🎨 课外班</h4>
        <DaySchedule :day="{ ...today, holiday: null, school: [] }">
          <template #outside="{ lesson, date }">
            <BoardClassControls :lesson="lesson" :date="date" :today="today.date" :as-parent="asParent" :disabled="busy || needsRefresh || staleSchedule" @action="action => act(action, lesson, date)" />
          </template>
        </DaySchedule>
      </section>

      <section>
        <h4 class="text-xs font-black text-slate-500 dark:text-slate-400 mb-1.5">🏫 学校的课</h4>
        <DaySchedule :day="{ ...today, outside: [] }" />
      </section>

      <section v-if="tomorrow" class="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
        <h3 class="text-base font-black text-slate-800 dark:text-slate-100 font-chinese">
          📅 明天的课
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">{{ shortDate(tomorrow.date) }} · {{ WEEKDAY_NAMES[tomorrow.weekday] }}</span>
          <span v-if="tomorrow.week" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 text-xs">{{ tomorrow.week }}周</span>
        </h3>

        <section>
          <h4 class="text-xs font-black text-violet-600 dark:text-violet-300 mb-1.5">🎨 明天的课外班</h4>
          <DaySchedule v-if="tomorrow.outside.length" :day="{ ...tomorrow, holiday: null, makeup: null, school: [] }">
            <template #outside="{ lesson, date }">
              <BoardClassControls :lesson="lesson" :date="date" :today="today.date" :as-parent="asParent" :disabled="busy || needsRefresh || staleSchedule" @action="action => act(action, lesson, date)" />
            </template>
          </DaySchedule>
          <p v-else class="px-2 py-2 text-xs font-bold text-slate-400">明天没有课外班</p>
        </section>

        <section>
          <h4 class="text-xs font-black text-slate-500 dark:text-slate-400 mb-1.5">🏫 明天学校的课</h4>
          <DaySchedule :day="{ ...tomorrow, outside: [] }" />
        </section>

        <div class="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3">
          <h4 class="text-xs font-black text-amber-700 dark:text-amber-300 mb-1">🎒 明天要带</h4>
          <ul v-if="tomorrow.bring.length" class="space-y-0.5">
            <li v-for="item in tomorrow.bring" :key="item.for + item.items" class="text-sm font-bold text-slate-700 dark:text-slate-200 font-chinese">
              <span class="text-amber-600 dark:text-amber-300">{{ item.for }}：</span>{{ item.items }}
            </li>
          </ul>
          <p v-else class="text-xs font-bold text-slate-400">没有特别要带的东西</p>
        </div>
      </section>

      <router-link v-if="!busy" :to="`/child/${childId}/schedule`" class="block text-center py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-bold text-slate-600 dark:text-slate-300" @click="$emit('close')">
        查看整周课程表 →
      </router-link>
    </div>
  </UiDialog>
  <UiDialog v-if="moveTarget" title="调整这节课" :busy="busy" @close="moveTarget = null">
    <p class="mb-3 text-sm font-bold text-violet-700 dark:text-violet-300">只对 {{ childName }} 生效 · {{ moveTarget.lesson.title }}</p>
    <form id="board-move-class" class="space-y-3" @submit.prevent="saveMove">
      <label class="block text-sm font-bold">新日期<input v-model="moveForm.date" type="date" required :disabled="busy" class="input-field mt-1 w-full min-h-11" /></label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm font-bold">开始时间<input v-model="moveForm.start" type="time" required :disabled="busy" class="input-field mt-1 w-full min-h-11" /></label>
        <label class="block text-sm font-bold">结束时间<input v-model="moveForm.end" type="time" required :disabled="busy" class="input-field mt-1 w-full min-h-11" /></label>
      </div>
      <div v-if="moveError" role="alert" class="text-sm text-rose-600 dark:text-rose-300"><p>{{ moveError }}</p><button v-if="needsRefresh" type="button" :disabled="busy" class="min-h-11 underline" @click="refreshOnly">刷新日程和打卡任务</button></div>
      <router-link v-if="!busy && asParent" :to="{ path: '/parent/schedule', query: { child: childId, class: moveTarget.lesson.class_id, date: moveTarget.lesson.source_date || moveTarget.lesson.moved_from || moveTarget.date } }" class="inline-flex items-center min-h-11 text-sm font-bold text-violet-700 dark:text-violet-300 underline">更多设置 →</router-link>
    </form>
    <template #footer>
      <button type="button" :disabled="busy" class="min-h-11 px-4 rounded-xl bg-slate-100 dark:bg-slate-800" @click="moveTarget = null">取消</button>
      <button type="submit" form="board-move-class" :disabled="busy || needsRefresh" class="min-h-11 px-4 rounded-xl bg-violet-600 text-white font-bold disabled:opacity-40">确认调课</button>
    </template>
  </UiDialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import api from '../api/client.js';
import UiDialog from './UiDialog.vue';
import DaySchedule from './DaySchedule.vue';
import BoardClassControls from './BoardClassControls.vue';
import { shortDate, WEEKDAY_NAMES } from '../utils/schedule.js';
import { boardClassActions, classActionLabels } from '../utils/boardClassActions.js';
import { currentRole } from '../utils/session.js';
import { useParentSession } from '../composables/useParentSession.js';
import { cancelConfirmations, confirmAction } from '../utils/confirmation.js';

const props = defineProps({
  childId: { type: String, required: true },
  childName: { type: String, required: true },
  businessDate: { type: String, required: true },
  today: { type: Object, required: true },
  tomorrow: { type: Object, default: null },
  refresh: { type: Function, required: true }
});
defineEmits(['close']);
const { asParent, refreshParentSession } = useParentSession();
const sessionExpired = ref(!asParent.value && currentRole() === 'parent');
const busy = ref(false), error = ref(''), needsRefresh = ref(false);
const moveTarget = ref(null), moveForm = ref({ date: '', start: '', end: '' }), moveError = ref('');
const writeOptions = { preserveError: true, networkErrorMessage: '操作未确认，请刷新后核对' };
const staleSchedule = computed(() => props.today.date !== props.businessDate);
const dateChanged = ref(staleSchedule.value);
let awaitingConfirmation = false;

watch(() => props.businessDate, () => {
  // Cancel before the replacement schedule arrives: a failed/delayed read must
  // never leave yesterday's confirmation or move draft actionable.
  if (awaitingConfirmation) cancelConfirmations();
  moveTarget.value = null;
  error.value = ''; moveError.value = ''; needsRefresh.value = false;
  dateChanged.value = true;
}, { flush: 'sync' });

watch(asParent, (valid, previous) => {
  if (!valid && previous) expireSession();
});
function expireSession() {
  sessionExpired.value = true;
  moveTarget.value = null;
}
function requireParent() {
  if (refreshParentSession()) return true;
  expireSession();
  return false;
}

async function refreshOnly() {
  if (busy.value) return;
  busy.value = true;
  try { await props.refresh(); needsRefresh.value = false; error.value = ''; moveTarget.value = null; }
  catch { error.value = '刷新失败，请刷新后核对'; }
  finally { busy.value = false; }
}

async function act(action, lesson, date) {
  if (busy.value || needsRefresh.value || staleSchedule.value || !requireParent() || !boardClassActions(lesson, date, props.today.date, asParent.value).includes(action)) return;
  if (action === 'move') {
    moveTarget.value = { lesson, date };
    moveForm.value = { date, start: lesson.start_time, end: lesson.end_time };
    moveError.value = '';
    return;
  }
  await perform(action, lesson, date);
}

async function saveMove() {
  if (busy.value || needsRefresh.value || staleSchedule.value || !requireParent() || !moveTarget.value) return;
  if (moveForm.value.end <= moveForm.value.start) { moveError.value = '结束时间要晚于开始时间'; return; }
  const { lesson, date } = moveTarget.value;
  await perform('move', lesson, date, { ...moveForm.value });
}

async function perform(action, lesson, date, moved) {
  const childId = props.childId, day = props.businessDate;
  const source = lesson.source_date || lesson.moved_from || date;
  busy.value = true;
  error.value = '';
  moveError.value = '';
  const detail = action === 'leave' ? '今天请假会取消当天还没完成的打卡任务；请假默认不扣课时，如需扣课时请到课外班统计修改。'
    : action === 'move' ? `调到 ${moved.date} ${moved.start}–${moved.end}。`
    : action === 'attended' ? '将按默认规则扣除本次课时。' : '';
  try {
    awaitingConfirmation = true;
    if (!await confirmAction(`确定${classActionLabels[action]}「${lesson.title}」（${date} ${lesson.start_time}–${lesson.end_time}）吗？只对 ${props.childName} 生效。${detail}`)) return;
    awaitingConfirmation = false;
    if (props.childId !== childId || props.businessDate !== day || staleSchedule.value) return;
    if (!requireParent()) return;
    try {
      if (action === 'leave' || action === 'move') {
        await api.setClassException(lesson.class_id, {
          child_id: childId, date: source, kind: action === 'leave' ? 'leave' : 'moved',
          expected_exception_id: lesson.exception_id ?? null,
          ...(moved ? { new_date: moved.date, new_start_time: moved.start, new_end_time: moved.end } : {}),
          note: lesson.exception_note || ''
        }, writeOptions);
      } else if (action === 'undoLeave' || action === 'undoMove') {
        await api.deleteClassException(lesson.exception_id, writeOptions);
      } else {
        await api.setClassAttendance(lesson.class_id, {
          child_id: childId, lesson_date: source,
          status: action === 'undoAttendance' ? 'pending' : action,
          expected_revision: lesson.attendance_revision
        }, writeOptions);
      }
    } catch (err) {
      if (err.status === 401) { refreshParentSession(); expireSession(); return; }
      error.value = err.message || String(err);
      if (moveTarget.value) moveError.value = error.value;
      const conflict = err.status === 409 || err.status === 404;
      needsRefresh.value = !err.status || conflict;
      if (conflict) {
        moveTarget.value = null;
        try { await props.refresh(); needsRefresh.value = false; }
        catch { error.value += '；刷新失败，请刷新后核对'; }
      }
      return;
    }
    moveTarget.value = null;
    try { await props.refresh(); needsRefresh.value = false; }
    catch { needsRefresh.value = true; error.value = '操作已保存，但刷新失败，请刷新后核对'; }
  } finally { awaitingConfirmation = false; busy.value = false; }
}
</script>
