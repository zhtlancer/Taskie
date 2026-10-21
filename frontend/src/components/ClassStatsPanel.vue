<template>
  <div data-class-stats class="mt-3 pt-3 border-t border-violet-100 dark:border-violet-800 text-xs font-bold">
    <p v-if="!summary.enrolled" class="mb-2 text-slate-500 dark:text-slate-400">历史课程（当前未分配给这个孩子）</p>
    <div class="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200">
      <span>已上 <b class="text-violet-600 dark:text-violet-300">{{ summary.attended }}</b><template v-if="summary.total_lessons"> / {{ summary.total_lessons }}</template> 次</span>
      <span>待确认 {{ summary.pending }} 次</span>
      <button type="button" class="min-h-[44px] px-3 rounded-xl bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800" @click="open">出勤与学费</button>
    </div>
    <div v-if="summary.total_lessons" role="progressbar" aria-label="上课进度" :aria-valuenow="Math.min(summary.attended, summary.total_lessons)" :aria-valuemax="summary.total_lessons" aria-valuemin="0" class="h-2 mt-1 rounded-full bg-violet-100 dark:bg-violet-950 overflow-hidden">
      <div class="h-full rounded-full bg-violet-500" :style="{ width: `${Math.min(100, summary.attended * 100 / summary.total_lessons)}%` }"></div>
    </div>
    <p class="mt-2 text-slate-500 dark:text-slate-400">已消课 {{ summary.charged_lessons }} 次<template v-if="summary.remaining_credits !== null"> · 剩余 {{ summary.remaining_credits }} 次</template></p>
    <p v-if="summary.total_fee_cents !== null" class="mt-1 text-slate-500 dark:text-slate-400">学费 {{ feeText(summary.total_fee_cents) }}<template v-if="summary.remaining_cents !== null"> · 余额估算 {{ feeText(summary.remaining_cents) }}</template></p>
    <p class="mt-1 text-violet-600 dark:text-violet-300">{{ summary.next_lesson ? `下次 ${summary.next_lesson.actual_date} ${summary.next_lesson.start_time}–${summary.next_lesson.end_time}` : '暂无待上课程' }}</p>
  </div>

  <UiDialog v-if="opened" :title="`${child.name} · ${summary.title}`" wide :busy="busy" @close="opened = false">
    <p v-if="error" role="alert" class="mb-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm font-bold text-rose-600 dark:text-rose-300">{{ error }}</p>
    <p v-if="fetching" class="py-6 text-center text-sm text-slate-500">正在加载出勤记录…</p>
    <template v-if="details">
      <div class="grid grid-cols-3 gap-2 text-center text-sm mb-3">
        <div class="rounded-xl bg-violet-50 dark:bg-violet-950/40 p-3"><b class="block text-xl">{{ details.summary.attended }}</b>已上课</div>
        <div class="rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><b class="block text-xl">{{ details.summary.pending }}</b>待确认</div>
        <div class="rounded-xl bg-slate-50 dark:bg-slate-800 p-3"><b class="block text-xl">{{ details.summary.attendance_rate === null ? '—' : `${details.summary.attendance_rate}%` }}</b>出勤率</div>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">请假 {{ details.summary.leave }} 次 · 缺席 {{ details.summary.absent }} 次 · 本月已上 {{ details.summary.month_attended }} 次。出勤率按已上课与缺席计算，不含请假及未确认。<template v-if="details.summary.enrolled">待确认从 {{ details.summary.pending_since }} 起计算，更早的课仍可在下方补记。</template></p>
      <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">累计上课 {{ details.summary.attended_minutes }} 分钟（按课表时长）<template v-if="details.summary.unknown_duration_lessons">，另 {{ details.summary.unknown_duration_lessons }} 次时长未知</template>。<template v-if="details.summary.estimated_end_date">预计结课 {{ details.summary.estimated_end_date }}。</template></p>

      <form class="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2 mb-4" @submit.prevent="saveFee">
        <label class="block text-sm font-bold" for="class-fee">本期总学费（元，选填）</label>
        <div class="flex gap-2">
          <input id="class-fee" v-model="fee" :disabled="busy" inputmode="decimal" placeholder="未设置" class="min-w-0 flex-1 min-h-[44px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700" />
          <button type="submit" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-violet-500 text-white font-bold disabled:opacity-50">保存学费</button>
        </div>
        <div v-if="details.summary.total_fee_cents !== null" class="text-sm space-y-1">
          <p>总学费 {{ feeText(details.summary.total_fee_cents) }}</p>
          <p v-if="details.summary.per_lesson_cents !== null">平均每次 {{ feeText(details.summary.per_lesson_cents) }} · 已消耗 {{ feeText(details.summary.consumed_cents) }} · 剩余 {{ feeText(details.summary.remaining_cents) }}</p>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">每个孩子单独设置；留空保存可移除。金额按总课次比例估算，不代表机构可退金额。未设总课次时只展示总学费。</p>
        <p v-if="details.summary.overdrawn_lessons" class="text-xs font-bold text-amber-700 dark:text-amber-300">消课已超过总课次 {{ details.summary.overdrawn_lessons }} 次，请核对本期课次和出勤记录。</p>
      </form>

      <div class="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" :disabled="busy || fetching" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="changeRange(-30)">往前 30 天</button>
        <span class="text-xs flex-1">{{ details.from }} 至 {{ details.to }}</span>
        <button type="button" :disabled="busy || fetching" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="changeRange(30)">往后 30 天</button>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">过去的课程不会自动算作出勤。上课打卡默认同步确认，家长更正优先。这里的更正只用于出勤统计，不改变打卡、全勤或积分；只有把今天的课记为请假，会取消今天的上课打卡。请假、缺席是否消课可单独确认。</p>
      <p v-if="!details.lessons.length" class="py-4 text-sm text-slate-500">这段时间没有课程记录。</p>
      <div class="space-y-2">
        <div v-for="lesson in details.lessons" :key="lesson.lesson_date" class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3 text-sm" :data-lesson-date="lesson.lesson_date">
          <div class="flex flex-wrap justify-between gap-2 items-center">
            <div class="min-w-0">
              <p class="font-bold"><span v-if="lesson.lesson_number">第 {{ lesson.lesson_number }} 次 · </span>{{ lesson.actual_date }} <span class="text-xs">{{ lesson.start_time || '时间未知' }}{{ lesson.end_time ? `–${lesson.end_time}` : '' }}</span></p>
              <p class="text-xs mt-1 text-slate-500 dark:text-slate-400">{{ attendanceLabels[lesson.status] }} · {{ lesson.charged ? '消课 1 次' : '未消课' }}<template v-if="lesson.actual_date !== lesson.lesson_date"> · 原定 {{ lesson.lesson_date }}</template><template v-if="lesson.source === 'checkin'"> · 来自上课打卡</template><template v-if="lesson.historical"> · 历史排课</template></p>
              <p v-if="lesson.note" class="text-xs text-slate-500 dark:text-slate-400 break-words mt-1">{{ lesson.note }}</p>
            </div>
            <button type="button" :disabled="busy || fetching || lesson.actual_date > details.summary.today" class="min-h-[44px] px-3 rounded-xl text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/40 font-bold disabled:opacity-40" @click="edit(lesson)">{{ lesson.actual_date > details.summary.today ? '未到上课日' : '记录出勤' }}</button>
          </div>
          <form v-if="draft?.lesson_date === lesson.lesson_date" class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 space-y-3" @submit.prevent="saveAttendance">
            <label class="block text-xs font-bold">出勤状态
              <select v-model="draft.status" aria-label="出勤状态" :disabled="busy" class="block w-full min-h-[44px] mt-1 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700" @change="draft.charged = draft.status === 'attended'">
                <option value="attended">已上课</option><option value="leave">请假</option><option value="absent">缺席</option><option value="pending">恢复未确认</option>
              </select>
            </label>
            <label v-if="draft.status !== 'pending'" class="flex items-center gap-2 min-h-[44px] text-sm"><input v-model="draft.charged" :disabled="busy" type="checkbox" class="w-5 h-5 accent-violet-500" />本次消课（扣 1 次）</label>
            <label v-if="draft.status !== 'pending'" class="block text-xs font-bold">备注
              <input v-model="draft.note" :disabled="busy" aria-label="出勤备注" maxlength="200" class="block w-full min-h-[44px] mt-1 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700" />
            </label>
            <div class="flex justify-end gap-2"><button type="button" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800" @click="draft = null">取消记录</button><button type="submit" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-violet-500 text-white font-bold disabled:opacity-40">{{ busy ? '保存中…' : '保存出勤' }}</button></div>
          </form>
        </div>
      </div>
    </template>
  </UiDialog>
</template>
<script setup>
import { ref } from 'vue';
import UiDialog from './UiDialog.vue';
import api from '../api/client';
import { addDays } from '../utils/schedule.js';
import { attendanceLabels, feeText, parseFee } from '../utils/classStats.js';
const props = defineProps({ summary: { type: Object, required: true }, child: { type: Object, required: true } });
const emit = defineEmits(['changed']);
const opened = ref(false), details = ref(null), draft = ref(null), fee = ref(''), error = ref(''), busy = ref(false), fetching = ref(false);
let serial = 0;
const showError = err => { error.value = typeof err === 'string' ? err : err.message || '操作失败，请重试'; };
async function load(from, to) {
  const request = ++serial;
  fetching.value = true;
  try {
    const data = await api.getOutsideClassDetails(props.summary.class_id, props.child.id, from, to);
    if (request === serial) details.value = data;
  } finally { if (request === serial) fetching.value = false; }
}
async function open() {
  opened.value = true; details.value = null; draft.value = null; error.value = '';
  fee.value = props.summary.total_fee_cents === null ? '' : (props.summary.total_fee_cents / 100).toFixed(2);
  try { await load(); } catch (err) { showError(err); }
}
async function changeRange(days) {
  if (busy.value || fetching.value) return;
  error.value = ''; draft.value = null;
  try { await load(addDays(details.value.from, days), addDays(details.value.to, days)); } catch (err) { showError(err); }
}
function edit(lesson) { error.value = ''; draft.value = { ...lesson, status: lesson.status === 'pending' ? 'attended' : lesson.status, charged: lesson.status === 'pending' ? true : lesson.charged }; }
async function saveFee() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    details.value.summary = await api.setClassFee(props.summary.class_id, { child_id: props.child.id, total_fee_cents: parseFee(fee.value) });
    if (!details.value.summary.available) opened.value = false;
    emit('changed');
  } catch (err) { showError(err); } finally { busy.value = false; }
}
async function saveAttendance() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    const summary = await api.setClassAttendance(props.summary.class_id, { child_id: props.child.id, lesson_date: draft.value.lesson_date, status: draft.value.status, charged: draft.value.charged, note: draft.value.note });
    draft.value = null;
    if (!summary.available) { opened.value = false; emit('changed'); return; }
    emit('changed');
    await load(details.value.from, details.value.to);
  } catch (err) { showError(err); } finally { busy.value = false; }
}
</script>
