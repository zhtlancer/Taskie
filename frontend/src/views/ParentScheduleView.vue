<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <span>📅</span>
            <span>课程表</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">每个孩子按学期设置学校课程表；课外班可以几个孩子共用，单独给某个孩子请假或调课</p>
        </div>
      </div>

      <!-- Child Selector -->
      <div class="flex flex-wrap gap-2 mb-5">
        <button
          v-for="child in children"
          :key="child.id"
          type="button"
          class="px-4 py-2 rounded-xl text-sm font-bold border transition-all font-chinese"
          :class="selectedChild?.id === child.id ? 'bg-brand-500 border-brand-500 text-white shadow-button' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'"
          @click="selectChild(child)"
        >
          {{ child.avatar_emoji }} {{ child.name }}
        </button>
      </div>

      <p v-if="error" class="mb-4 px-4 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>
      <div v-if="loading" class="text-center py-20 text-brand-500 dark:text-brand-400 font-bold"><span class="animate-spin mr-2">⏳</span> 正在加载...</div>

      <template v-else-if="selectedChild">
        <!-- School timetables of the selected child -->
        <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-lg font-black text-slate-800 dark:text-slate-100">🏫 {{ selectedChild.name }}的学校课程表</h3>
            <div class="flex flex-wrap gap-2">
              <button v-if="timetables.length" type="button" class="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" @click="openTimetable(null, timetables[0])">
                📋 复制「{{ timetables[0].name }}」为新学期
              </button>
              <button type="button" class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button" @click="openTimetable(null)">➕ 新建课程表</button>
            </div>
          </div>
          <p v-if="!timetables.length" class="text-xs font-bold text-slate-400 py-2">还没有课程表。新建时会带上常见的小学作息时间，点格子填课就行。</p>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="timetable in timetables" :key="timetable.id" class="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
              <div class="flex items-center justify-between gap-2">
                <span class="text-base font-black text-slate-800 dark:text-slate-100 font-chinese truncate">{{ timetable.name }}</span>
                <span class="shrink-0 px-2 py-0.5 rounded-lg text-xs font-black" :class="termStatus(timetable).class">{{ termStatus(timetable).label }}</span>
              </div>
              <div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                {{ timetable.start_date }} 至 {{ timetable.end_date }} · {{ timetable.slots.filter(s => s.kind === 'class').length }} 节 / 天 · 共 {{ timetable.lessons.length }} 节课
                <span v-if="timetable.ab_weeks" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300">单双周</span>
              </div>
              <div class="mt-3 flex gap-2">
                <button type="button" class="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300" @click="openTimetable(timetable)">✏️ 编辑</button>
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400" @click="removeTimetable(timetable)">删除</button>
              </div>
            </div>
          </div>
        </section>

        <!-- Outside classes (shared between children) -->
        <section class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-lg font-black text-slate-800 dark:text-slate-100">🎨 课外班</h3>
            <button type="button" class="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold" @click="classModal = { cls: null }">➕ 新增课外班</button>
          </div>
          <div v-if="courseDataFailed" role="alert" class="mb-3 rounded-xl p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">
            <p>课程数据刷新失败，请刷新后再操作</p>
            <button type="button" :disabled="courseRefreshing" class="min-h-11 min-w-11 px-3 py-2 disabled:opacity-50" @click="reload">刷新课程数据</button>
          </div>
          <div v-if="statsError" role="status" class="mb-3 rounded-xl p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold">
            <p>出勤与学费统计刷新失败，请重试</p>
            <button type="button" class="min-h-11 min-w-11 px-3 py-2" @click="refreshClassStats">刷新统计</button>
          </div>
          <p v-if="!classes.length" class="text-xs font-bold text-slate-400 py-2">还没有课外班。例如“钢琴课 每周三 16:30–17:30 少年宫”。</p>
          <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div v-for="cls in classes" :key="cls.id" :data-class-id="cls.id" class="p-4 rounded-2xl border border-violet-100 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/40">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-base font-black text-slate-800 dark:text-slate-100 font-chinese truncate">{{ cls.title }}</div>
                  <div class="text-xs font-bold text-violet-600 dark:text-violet-300">
                    每{{ WEEK_ORDER.filter(d => cls.days_of_week.includes(d)).map(d => WEEKDAY_NAMES[d]).join('、') }} {{ timeRange(cls.start_time, cls.end_time) }}
                  </div>
                </div>
                <div class="flex shrink-0 gap-1">
                  <button type="button" :disabled="courseActionsDisabled" class="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50" @click="classModal = { cls }">编辑</button>
                  <button type="button" class="px-2 py-1 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400" @click="removeClass(cls)">删除</button>
                </div>
              </div>
              <div class="mt-1.5 space-y-0.5 text-xs font-bold text-slate-500 dark:text-slate-400 font-chinese">
                <div v-if="cls.institution || cls.location">📍 {{ [cls.institution, cls.location].filter(Boolean).join(' · ') }}</div>
                <div v-if="cls.teacher || cls.bring">{{ [cls.teacher && `老师：${cls.teacher}`, cls.bring && `带：${cls.bring}`].filter(Boolean).join(' · ') }}</div>
                <div>
                  👶 {{ cls.child_ids === null ? '全部孩子' : children.filter(c => cls.child_ids.includes(c.id)).map(c => c.name).join('、') }}
                  <span v-if="cls.create_task" class="ml-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">打卡 ★{{ cls.points }}</span>
                  <span class="ml-1 text-slate-400">{{ cls.start_date }} 起{{ cls.end_date ? `，到 ${cls.end_date}` : '' }}</span>
                  <span v-if="cls.total_lessons" class="ml-1">共 {{ cls.total_lessons }} 次</span>
                </div>
              </div>

              <ClassStatsPanel v-if="statsFor(cls)" :key="`${cls.id}:${selectedChild.id}`" :summary="statsFor(cls)" :child="selectedChild" @changed="refreshClassStats" />

              <!-- The selected child's next four weeks: tap a lesson to ask for leave or move it -->
              <div class="mt-3 pt-2 border-t border-violet-100 dark:border-violet-800">
                <div class="text-xs font-bold text-slate-400 mb-1.5">{{ selectedChild.name }}接下来的课（点一下请假或调课）</div>
                <p v-if="!attends(cls)" class="text-xs font-bold text-slate-400">{{ selectedChild.name }}不上这门课</p>
                <p v-else-if="!upcomingLessons(cls).length" class="text-xs font-bold text-slate-400">四周内没有课</p>
                <div v-else class="flex flex-wrap gap-1.5">
                  <button
                    v-for="lesson in upcomingLessons(cls)"
                    :key="lesson.date"
                    :data-source-date="lesson.date"
                    type="button"
                    :disabled="courseActionsDisabled"
                    class="px-2 py-1 rounded-lg border text-xs font-bold font-chinese disabled:opacity-50"
                    :class="lesson.status === 'scheduled' ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 dark:hover:border-violet-700' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'"
                    @click="openException(cls, lesson)"
                  >
                    <span v-if="lesson.lesson_number">第 {{ lesson.lesson_number }} 次 · </span>{{ shortDate(lesson.date) }} {{ WEEKDAY_NAMES[weekdayOf(lesson.date)] }}<template v-if="lesson.status !== 'scheduled'"> · {{ lessonNote(lesson) }}</template>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
      <p v-else class="text-center py-16 text-sm font-bold text-slate-400">请先在“孩子账号”里添加孩子</p>
    </main>

    <TimetableEditor
      v-if="timetableModal"
      :child-id="selectedChild.id"
      :timetable="timetableModal.timetable"
      :copy-from="timetableModal.copyFrom"
      @close="timetableModal = null"
      @saved="afterSave(() => { timetableModal = null; })"
    />
    <OutsideClassModal
      v-if="classModal"
      :cls="classModal.cls"
      :children="children"
      @close="classModal = null"
      @saved="afterClassSave"
    />
    <ClassExceptionModal
      v-if="exceptionModal"
      :cls="exceptionModal.cls"
      :child="selectedChild"
      :lesson="exceptionModal.lesson"
      @close="exceptionModal = null"
      @saved="afterClassSave"
    />
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { businessDate } from '../utils/businessDate.js';
import { confirmAction } from '../utils/confirmation';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import TimetableEditor from '../components/TimetableEditor.vue';
import OutsideClassModal from '../components/OutsideClassModal.vue';
import ClassExceptionModal from '../components/ClassExceptionModal.vue';
import ClassStatsPanel from '../components/ClassStatsPanel.vue';
import { WEEKDAY_NAMES, WEEK_ORDER, addDays, lessonNote, shortDate, timeRange } from '../utils/schedule.js';
const calendar = useCalendarStore();

const today = businessDate(Date.now(), calendar.timeZone);
const route = useRoute();
const children = ref([]);
const selectedChild = ref(null);
const timetables = ref([]);
const classes = ref([]);
const classStats = ref([]);
const statsFor = cls => classStats.value.find(item => item.class_id === cls.id);
let childSerial = 0;
let classSerial = 0;
const classesReady = ref(false);
const scheduleReady = ref(false);
const classesRefreshing = ref(false);
const scheduleRefreshing = ref(false);
const classesFailed = ref(false);
const scheduleFailed = ref(false);
const statsError = ref(false);
const courseRefreshing = computed(() => classesRefreshing.value || scheduleRefreshing.value);
const courseDataFailed = computed(() => classesFailed.value || scheduleFailed.value);
const courseActionsDisabled = computed(() => !classesReady.value || !scheduleReady.value);
const upcoming = ref([]);
const loading = ref(true);
const error = ref('');
const timetableModal = ref(null);
const classModal = ref(null);
const exceptionModal = ref(null);

const weekdayOf = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const attends = cls => cls.child_ids === null || cls.child_ids.includes(selectedChild.value.id);
// Lessons on their usual dates (also when on leave or moved away), from the next four weeks.
const upcomingLessons = cls => upcoming.value.flatMap(day => day.outside)
  .filter(lesson => lesson.class_id === cls.id && lesson.status !== 'moved_in');

function termStatus(timetable) {
  if (today < timetable.start_date) return { label: '未开始', class: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' };
  if (today > timetable.end_date) return { label: '已结束', class: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' };
  return { label: '使用中', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' };
}

function showError(err) {
  error.value = typeof err === 'string' ? err : '操作失败，请重试';
}

async function loadChild() {
  const id = selectedChild.value.id, serial = ++childSerial;
  const current = () => selectedChild.value?.id === id && serial === childSerial;
  scheduleReady.value = false;
  scheduleRefreshing.value = true;
  // Apply each response independently: neither slow nor failed statistics may hold up lessons.
  await Promise.allSettled([
    api.getTimetables(id).then(list => { if (current()) timetables.value = list; })
      .catch(err => { if (current()) showError(err); }),
    api.getChildSchedule(id, today, addDays(today, 27)).then(days => {
      if (!current()) return;
      upcoming.value = days;
      scheduleReady.value = true;
      scheduleFailed.value = false;
    }).catch(() => { if (current()) scheduleFailed.value = true; })
      .finally(() => { if (current()) scheduleRefreshing.value = false; }),
    api.getOutsideClassStats(id).then(stats => {
      if (!current()) return;
      classStats.value = stats;
      statsError.value = false;
    }).catch(() => {
      if (!current()) return;
      classStats.value = [];
      statsError.value = true;
    })
  ]);
}

async function selectChild(child) {
  selectedChild.value = child;
  classStats.value = [];
  upcoming.value = [];
  timetables.value = [];
  exceptionModal.value = null;
  classModal.value = null;
  error.value = '';
  try {
    await loadChild();
  } catch (err) {
    showError(err);
  }
}

async function reload() {
  const serial = ++classSerial;
  classesReady.value = false;
  classesRefreshing.value = true;
  await Promise.allSettled([
    api.getOutsideClasses().then(list => {
      if (serial !== classSerial) return;
      classes.value = list;
      classesReady.value = true;
      classesFailed.value = false;
    }).catch(() => { if (serial === classSerial) classesFailed.value = true; })
      .finally(() => { if (serial === classSerial) classesRefreshing.value = false; }),
    loadChild()
  ]);
}

function openException(cls, lesson) {
  if (!courseActionsDisabled.value) exceptionModal.value = { cls, lesson };
}

async function openLinkedLesson() {
  const { child, class: classId, date } = route.query;
  // Do not select a different child's lesson when any part of the target is invalid.
  if (child !== selectedChild.value?.id || typeof classId !== 'string' || typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
  const cls = classes.value.find(item => item.id === classId);
  if (!cls || !attends(cls) || courseActionsDisabled.value) return;
  // A lesson moved into today may have its original date outside the usual four weeks.
  let lesson = upcoming.value.flatMap(day => day.outside).find(item => item.class_id === classId && item.date === date && item.status !== 'moved_in');
  if (!lesson) {
    try {
      const days = await api.getChildSchedule(child, date, date);
      lesson = days.flatMap(day => day.outside).find(item => item.class_id === classId && item.status !== 'moved_in');
    } catch { return; }
  }
  if (!lesson || selectedChild.value?.id !== child || courseActionsDisabled.value) return;
  await nextTick();
  [...document.querySelectorAll('[data-class-id]')].find(node => node.dataset.classId === classId)?.scrollIntoView({ block: 'center' });
  openException(cls, lesson);
}
async function refreshClassStats() {
  try { await reload(); } catch (err) { showError(err); }
}

async function afterSave(close) {
  close();
  error.value = '';
  try {
    await reload();
  } catch (err) {
    showError(err);
  }
}

function afterClassSave(savedClass) {
  // Both save and restore return the full class, including the newly rotated exception IDs.
  const index = classes.value.findIndex(cls => cls.id === savedClass.id);
  if (index < 0) classes.value.push(savedClass);
  else classes.value[index] = savedClass;
  // Update the manager's source lessons immediately, before any refresh can fail or stall.
  upcoming.value = upcoming.value.map(day => ({ ...day, outside: day.outside.map(lesson => {
    if (lesson.class_id !== savedClass.id || lesson.status === 'moved_in') return lesson;
    const exception = savedClass.exceptions.find(e => e.child_id === selectedChild.value.id && e.date === lesson.date);
    return { ...lesson, title: savedClass.title, start_time: savedClass.start_time, end_time: savedClass.end_time,
      exception_id: exception?.id ?? null, exception_note: exception?.note ?? null,
      status: exception ? (exception.kind === 'leave' ? 'leave' : 'moved_out') : 'scheduled',
      moved_to: exception?.kind === 'moved' ? { date: exception.new_date, start_time: exception.new_start_time, end_time: exception.new_end_time } : null };
  }) }));
  return afterSave(() => { classModal.value = null; exceptionModal.value = null; });
}

function openTimetable(timetable, copyFrom = null) {
  timetableModal.value = { timetable, copyFrom };
}

async function removeTimetable(timetable) {
  if (!await confirmAction(`确定删除课程表「${timetable.name}」吗？`)) return;
  try {
    await api.deleteTimetable(timetable.id);
    await reload();
  } catch (err) {
    showError(err);
  }
}

async function removeClass(cls) {
  if (!await confirmAction(`确定删除课外班「${cls.title}」吗？本班的出勤、学费和未完成打卡任务会一起删除；已完成的打卡、作业记录和积分保留。`)) return;
  try {
    await api.deleteOutsideClass(cls.id);
    classes.value = classes.value.filter(item => item.id !== cls.id);
    upcoming.value = upcoming.value.map(day => ({ ...day, outside: day.outside.filter(item => item.class_id !== cls.id) }));
    classStats.value = classStats.value.filter(item => item.class_id !== cls.id);
    await reload();
  } catch (err) {
    showError(err);
  }
}

onMounted(async () => {
  try {
    children.value = await api.getChildren();
    if (children.value.length) {
      selectedChild.value = children.value.find(child => child.id === route.query.child) || children.value[0];
      await reload();
    }
  } catch (err) {
    showError(err);
  } finally {
    loading.value = false;
  }
  await openLinkedLesson();
});
</script>
