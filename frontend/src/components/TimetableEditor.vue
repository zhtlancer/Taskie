<template>
  <div class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center p-2 sm:p-4 overflow-y-auto" @click.self="$emit('close')">
    <form class="bg-white rounded-3xl p-4 sm:p-6 max-w-5xl w-full shadow-2xl border-2 border-brand-100 space-y-5 my-2 sm:my-6" @submit.prevent="save">
      <div class="flex items-center justify-between gap-2">
        <h3 class="text-xl font-black text-slate-800">🏫 {{ timetable ? '编辑课程表' : '新建课程表' }}</h3>
        <button type="button" class="w-9 h-9 rounded-xl text-slate-400 hover:bg-slate-100 text-lg" aria-label="关闭" @click="$emit('close')">✕</button>
      </div>
      <p v-if="error" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ error }}</p>

      <!-- Term -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">名称</label>
          <input v-model="form.name" type="text" maxlength="30" required placeholder="例如：四年级上学期" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-500 font-chinese" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">开始日期</label>
          <input v-model="form.start_date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-500" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">结束日期</label>
          <input v-model="form.end_date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-500" />
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-2xl border border-indigo-100 bg-indigo-50/40">
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.ab_weeks" type="checkbox" class="w-4 h-4 accent-indigo-500" />
          <span class="text-xs font-bold text-slate-700">有单双周（A/B 周）不同的课</span>
        </label>
        <template v-if="form.ab_weeks">
          <span class="text-xs font-bold text-slate-500">这周是</span>
          <button
            v-for="week in ['A', 'B']"
            :key="week"
            type="button"
            class="px-3 py-1 rounded-lg text-xs font-black border"
            :class="form.this_week === week ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-slate-200 text-slate-600'"
            @click="form.this_week = week"
          >
            {{ week }} 周
          </button>
        </template>
        <span v-else-if="hasAbLessons" class="text-[11px] font-bold text-amber-600">关闭后只保留 A 周的课</span>
      </div>

      <!-- The day's periods -->
      <details class="rounded-2xl border border-slate-200 p-3" :open="!timetable">
        <summary class="cursor-pointer text-sm font-black text-slate-700">⏱ 作息时间（{{ classSlots.length }} 节课）</summary>
        <div class="mt-3 space-y-2">
          <div v-for="slot in sortedSlots" :key="slot.id" class="flex flex-wrap items-center gap-2">
            <select v-model="slot.kind" class="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold bg-white">
              <option value="class">上课</option>
              <option value="break">休息</option>
            </select>
            <input v-model="slot.label" type="text" maxlength="10" required class="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold outline-none focus:border-brand-500 font-chinese" />
            <input v-model="slot.start_time" type="time" required class="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold" />
            <span class="text-xs text-slate-400">–</span>
            <input v-model="slot.end_time" type="time" required class="px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-bold" />
            <button type="button" class="px-2 py-1 text-xs font-bold text-slate-400 hover:text-rose-500" @click="removeSlot(slot)">删除</button>
          </div>
          <div class="flex flex-wrap gap-2 pt-1">
            <button type="button" class="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600" @click="addSlot('class')">＋ 加一节课</button>
            <button type="button" class="px-3 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600" @click="addSlot('break')">＋ 加课间操 / 午休</button>
            <button type="button" class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-500" @click="resetSlots">用常见作息重置</button>
          </div>
        </div>
      </details>

      <!-- Lessons by weekday -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-black text-slate-700">📚 课程（点格子填写）</span>
          <label class="flex items-center gap-1.5 text-xs font-bold text-slate-500 cursor-pointer">
            <input v-model="showWeekend" type="checkbox" class="w-4 h-4 accent-brand-500" /> 显示周末
          </label>
        </div>
        <div class="overflow-x-auto -mx-1 px-1">
          <table class="w-full min-w-[560px] border-separate border-spacing-1">
            <thead>
              <tr>
                <th class="w-20"></th>
                <th v-for="weekday in weekdays" :key="weekday" class="text-xs font-black text-slate-500 py-1">{{ WEEKDAY_NAMES[weekday] }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="slot in sortedSlots" :key="slot.id">
                <td class="align-middle text-[11px] font-bold text-slate-500 leading-tight">
                  <div class="font-chinese" :class="slot.kind === 'class' ? 'text-slate-700' : ''">{{ slot.label }}</div>
                  <div class="tabular-nums text-slate-400">{{ slot.start_time }}</div>
                </td>
                <td v-if="slot.kind === 'break'" :colspan="weekdays.length" class="rounded-lg bg-slate-50 text-center text-[11px] font-bold text-slate-400">{{ slot.label }}</td>
                <template v-else>
                  <td v-for="weekday in weekdays" :key="weekday">
                    <button
                      type="button"
                      class="w-full min-h-[44px] px-1 py-1 rounded-lg border text-xs font-bold font-chinese leading-tight"
                      :class="cellLessons(slot.id, weekday).length ? 'bg-brand-50 border-brand-200 text-slate-800' : 'bg-white border-dashed border-slate-200 text-slate-300 hover:border-brand-300'"
                      @click="openCell(slot, weekday)"
                    >
                      <template v-if="cellLessons(slot.id, weekday).length">
                        <div v-for="lesson in cellLessons(slot.id, weekday)" :key="lesson.week">
                          <span v-if="lesson.week !== 'all'" class="text-indigo-500">{{ lesson.week }} </span>{{ lesson.subject }}
                        </div>
                      </template>
                      <span v-else>＋</span>
                    </button>
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
        <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100" @click="$emit('close')">取消</button>
        <button type="submit" :disabled="saving" class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">{{ saving ? '保存中...' : '保存课程表' }}</button>
      </div>
    </form>

    <!-- One cell: the lesson every week, or separate A and B week lessons -->
    <div v-if="cell" class="fixed inset-0 z-[60] bg-slate-900/30 flex items-center justify-center p-4" @click.self="cell = null">
      <form class="bg-white rounded-3xl p-5 max-w-md w-full shadow-2xl space-y-3" @submit.prevent="applyCell">
        <h4 class="text-base font-black text-slate-800 font-chinese">{{ WEEKDAY_NAMES[cell.weekday] }} · {{ cell.slot.label }}（{{ cell.slot.start_time }}–{{ cell.slot.end_time }}）</h4>
        <div v-if="form.ab_weeks" class="flex gap-2">
          <button type="button" class="flex-1 py-1.5 rounded-lg text-xs font-bold border" :class="cell.mode === 'all' ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200 text-slate-600'" @click="cell.mode = 'all'">每周一样</button>
          <button type="button" class="flex-1 py-1.5 rounded-lg text-xs font-bold border" :class="cell.mode === 'ab' ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-slate-200 text-slate-600'" @click="cell.mode = 'ab'">A/B 周不同</button>
        </div>
        <div v-for="week in cell.mode === 'ab' ? ['A', 'B'] : ['all']" :key="week" class="space-y-2" :class="cell.mode === 'ab' ? 'p-2.5 rounded-2xl bg-indigo-50/50' : ''">
          <div v-if="week !== 'all'" class="text-xs font-black text-indigo-600">{{ week }} 周</div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="subject in SCHOOL_SUBJECTS"
              :key="subject"
              type="button"
              class="px-2 py-1 rounded-lg text-xs font-bold border font-chinese"
              :class="cell.entries[week].subject === subject ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200 text-slate-600'"
              @click="pickSubject(week, subject)"
            >
              {{ subject }}
            </button>
          </div>
          <input v-model="cell.entries[week].subject" type="text" maxlength="10" placeholder="科目（可自己填，空着表示没课）" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-500 font-chinese" @change="pickSubject(week, cell.entries[week].subject)" />
          <div class="grid grid-cols-2 gap-2">
            <input v-model="cell.entries[week].teacher" type="text" maxlength="10" placeholder="老师（可不填）" class="px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-brand-500 font-chinese" />
            <input v-model="cell.entries[week].room" type="text" maxlength="20" placeholder="教室（可不填）" class="px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-brand-500 font-chinese" />
          </div>
          <input v-model="cell.entries[week].bring" type="text" maxlength="30" placeholder="要带的东西，如 水彩笔、调色盘（可不填）" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs outline-none focus:border-brand-500 font-chinese" />
        </div>
        <div class="flex justify-between gap-2 pt-2">
          <button type="button" class="px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-rose-500" @click="clearCell">清空这一格</button>
          <div class="flex gap-2">
            <button type="button" class="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100" @click="cell = null">取消</button>
            <button type="submit" class="px-5 py-2 rounded-xl bg-brand-500 text-white text-xs font-bold">确定</button>
          </div>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import api from '../api/client';
import { SCHOOL_SUBJECTS, WEEKDAY_NAMES, addDays, localDate, mondayOf, presetSlots } from '../utils/schedule.js';

const props = defineProps({
  childId: { type: String, required: true },
  // The timetable being edited, or null for a new one.
  timetable: { type: Object, default: null },
  // A new timetable may start as a copy of another (e.g. last term's).
  copyFrom: { type: Object, default: null }
});
const emit = defineEmits(['close', 'saved']);

const newId = () => `new-${Math.random().toString(36).slice(2)}`;
const today = localDate();
const thisMonday = mondayOf(today);

// Whether this week is an A week, from the stored anchor (whose week is an A week).
function currentWeek(source) {
  if (!source?.ab_weeks) return 'A';
  const weeks = Math.round((new Date(`${thisMonday}T00:00:00Z`) - new Date(`${mondayOf(source.ab_anchor_date)}T00:00:00Z`)) / (7 * 86400000));
  return weeks % 2 === 0 ? 'A' : 'B';
}

function initialForm() {
  const source = props.timetable || props.copyFrom;
  const ids = new Map();
  const slots = source
    ? source.slots.map(slot => {
      ids.set(slot.id, props.timetable ? slot.id : newId());
      return { ...slot, id: ids.get(slot.id) };
    })
    : presetSlots(newId);
  const lessons = source ? source.lessons.map(({ id, ...lesson }) => ({ ...lesson, slot_id: ids.get(lesson.slot_id) })) : [];
  return {
    name: props.timetable?.name ?? '',
    start_date: props.timetable?.start_date ?? today,
    end_date: props.timetable?.end_date ?? addDays(today, 150),
    ab_weeks: Boolean(source?.ab_weeks),
    this_week: currentWeek(source),
    slots,
    lessons
  };
}

const form = ref(initialForm());
const saving = ref(false);
const error = ref('');
const cell = ref(null);
const showWeekend = ref(form.value.lessons.some(lesson => [0, 6].includes(lesson.weekday)));

const sortedSlots = computed(() => [...form.value.slots].sort((a, b) => a.start_time.localeCompare(b.start_time)));
const classSlots = computed(() => form.value.slots.filter(slot => slot.kind === 'class'));
const weekdays = computed(() => showWeekend.value ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5]);
const hasAbLessons = computed(() => form.value.lessons.some(lesson => lesson.week !== 'all'));
const cellLessons = (slotId, weekday) => form.value.lessons.filter(l => l.slot_id === slotId && l.weekday === weekday)
  .sort((a, b) => a.week.localeCompare(b.week));

function addSlot(kind) {
  const last = sortedSlots.value.at(-1);
  const start = last ? last.end_time : '08:00';
  const [h, m] = start.split(':').map(Number);
  const endMinutes = Math.min(h * 60 + m + (kind === 'class' ? 40 : 20), 23 * 60 + 59);
  const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;
  form.value.slots.push({ id: newId(), kind, label: kind === 'class' ? `第${classSlots.value.length + 1}节` : '课间', start_time: start, end_time: end });
}

function removeSlot(slot) {
  form.value.slots = form.value.slots.filter(s => s.id !== slot.id);
  form.value.lessons = form.value.lessons.filter(l => l.slot_id !== slot.id);
}

function resetSlots() {
  if (form.value.lessons.length && !confirm('重置作息时间会清空已填的课程，确定吗？')) return;
  form.value.slots = presetSlots(newId);
  form.value.lessons = [];
}

const emptyEntry = () => ({ subject: '', teacher: '', room: '', bring: '' });

function openCell(slot, weekday) {
  const existing = cellLessons(slot.id, weekday);
  const entries = { all: emptyEntry(), A: emptyEntry(), B: emptyEntry() };
  for (const lesson of existing) entries[lesson.week] = { subject: lesson.subject, teacher: lesson.teacher || '', room: lesson.room || '', bring: lesson.bring || '' };
  cell.value = { slot, weekday, mode: existing.some(l => l.week !== 'all') ? 'ab' : 'all', entries };
}

// Picking a subject fills in the teacher, room and things to bring it has elsewhere in the timetable.
function pickSubject(week, subject) {
  const entry = cell.value.entries[week];
  entry.subject = subject;
  const other = form.value.lessons.find(l => l.subject === subject);
  if (!other) return;
  for (const field of ['teacher', 'room', 'bring']) if (!entry[field] && other[field]) entry[field] = other[field];
}

function applyCell() {
  const { slot, weekday, mode, entries } = cell.value;
  const rest = form.value.lessons.filter(l => !(l.slot_id === slot.id && l.weekday === weekday));
  const added = (mode === 'ab' ? ['A', 'B'] : ['all'])
    .filter(week => entries[week].subject.trim())
    .map(week => ({ slot_id: slot.id, weekday, week, ...entries[week], subject: entries[week].subject.trim() }));
  form.value.lessons = [...rest, ...added];
  cell.value = null;
}

function clearCell() {
  const { slot, weekday } = cell.value;
  form.value.lessons = form.value.lessons.filter(l => !(l.slot_id === slot.id && l.weekday === weekday));
  cell.value = null;
}

async function save() {
  saving.value = true;
  error.value = '';
  const { name, start_date, end_date, ab_weeks, this_week, slots } = form.value;
  const classIds = new Set(slots.filter(slot => slot.kind === 'class').map(slot => slot.id));
  // Without alternating weeks, A week lessons become every-week ones and B week ones go.
  const lessons = form.value.lessons
    .filter(l => classIds.has(l.slot_id) && (ab_weeks || l.week !== 'B'))
    .map(l => ({ ...l, week: ab_weeks ? l.week : 'all', teacher: l.teacher || null, room: l.room || null, bring: l.bring || null }));
  const payload = {
    name, start_date, end_date, ab_weeks,
    ab_anchor_date: ab_weeks ? (this_week === 'A' ? thisMonday : addDays(thisMonday, -7)) : null,
    slots, lessons
  };
  try {
    const saved = props.timetable ? await api.updateTimetable(props.timetable.id, payload) : await api.createTimetable(props.childId, payload);
    emit('saved', saved);
  } catch (err) {
    error.value = typeof err === 'string' ? err : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}
</script>
