<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <ParentPageHeader icon="📅" title="学校与课外班" description="按孩子和学期设置学校课表；课外班可由多个孩子共用，请假与调课分别记录。" />

      <ParentChildPicker :children="children" :model-value="selectedChild" :loading="loading" :failed="Boolean(childrenError)" :disabled="loading || Boolean(childrenError) || modalOpen || writeBusy" @change="changeChild" />
      <ParentSectionNav section="calendar" :child-id="selectedChild?.id" />

      <p v-if="error" role="alert" class="mb-4 px-4 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>
      <ParentPageState v-if="loading" kind="loading" title="正在读取孩子档案…" />
      <ParentPageState v-if="childrenError" kind="error" title="孩子档案未能读取" :description="childrenError" :busy="loading || writeBusy" @retry="loadInitial" />

      <template v-if="!loading && !childrenError && selectedChild">
        <!-- School timetables of the selected child -->
        <section data-schedule-section="school" class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="min-w-0 break-words text-lg font-black text-slate-800 dark:text-slate-100">🏫 {{ selectedChild.name }}的学校课程表</h3>
            <div class="flex flex-wrap min-w-0 gap-2">
              <button v-if="timetables.length" type="button" :disabled="schoolActionsDisabled" class="min-h-11 min-w-11 max-w-full break-words px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800" @click="openTimetable(null, timetables[0])">
                📋 复制「{{ timetables[0].name }}」为新学期
              </button>
              <button type="button" :disabled="schoolActionsDisabled" class="ui-button-primary" @click="openTimetable(null)">➕ 新建课程表</button>
            </div>
          </div>
          <ParentPageState v-if="timetablesRefreshing" kind="loading" title="正在读取学校课程表…" />
          <ParentPageState v-if="timetablesError" kind="error" title="学校课程表未能读取" :description="timetablesError" :busy="timetablesRefreshing || writeBusy" @retry="loadTimetables" />
          <ParentPageState v-if="timetablesReady && !timetablesError && !timetablesRefreshing && !timetables.length" title="还没有课程表" description="新建时会带上常见的小学作息时间，点格子填课就行。">
            <template #actions><button type="button" :disabled="schoolActionsDisabled" class="ui-button-secondary" @click="openTimetable(null)">添加课程表</button></template>
          </ParentPageState>
          <div v-if="timetables.length" class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="timetable in timetables" :key="timetable.id" :data-timetable-id="timetable.id" class="min-w-0 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
              <div class="flex items-center justify-between gap-2">
                <span class="text-base font-black text-slate-800 dark:text-slate-100 font-chinese truncate">{{ timetable.name }}</span>
                <span class="shrink-0 px-2 py-0.5 rounded-lg text-xs font-black" :class="termStatus(timetable).class">{{ termStatus(timetable).label }}</span>
              </div>
              <div class="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                {{ timetable.start_date }} 至 {{ timetable.end_date }} · {{ timetable.slots.filter(s => s.kind === 'class').length }} 节 / 天 · 共 {{ timetable.lessons.length }} 节课
                <span v-if="timetable.ab_weeks" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300">单双周</span>
              </div>
              <div class="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-2">
                <button type="button" :disabled="schoolActionsDisabled" class="min-h-11 min-w-11 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300" @click="openTimetable(timetable)">✏️ 编辑</button>
                <button type="button" :disabled="schoolActionsDisabled" class="ml-auto min-h-11 min-w-11 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400" @click="removeTimetable(timetable)">删除</button>
              </div>
            </div>
          </div>
        </section>

        <!-- Outside classes (shared between children) -->
        <section data-schedule-section="outside" class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-lg font-black text-slate-800 dark:text-slate-100">🎨 课外班</h3>
            <button type="button" :disabled="classActionsDisabled" class="ui-button-primary" @click="openClass()">➕ 新增课外班</button>
          </div>
          <ParentPageState v-if="classesRefreshing" kind="loading" title="正在读取课外班…" />
          <div v-if="courseDataFailed" role="alert" class="mb-3 rounded-xl p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">
            <p>课程数据刷新失败，请刷新后再操作</p>
            <p class="mt-1">{{ classesError || scheduleError }}</p>
            <button type="button" :disabled="courseRefreshing || writeBusy" class="min-h-11 min-w-11 px-3 py-2 disabled:opacity-50" @click="reloadCourses">刷新课程数据</button>
          </div>
          <ParentPageState v-if="statsRefreshing && !statsError" kind="loading" title="正在读取出勤与学费统计…" />
          <div v-if="statsError" role="status" class="mb-3 rounded-xl p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold">
            <p>出勤与学费统计刷新失败，请重试</p>
            <button type="button" :disabled="statsRefreshing || writeBusy" class="min-h-11 min-w-11 px-3 py-2" @click="refreshClassStats">刷新统计</button>
          </div>
          <ParentPageState v-if="classesReady && !classesRefreshing && !classesError && !classes.length" title="还没有课外班" description="例如：钢琴课，每周三 16:30–17:30，少年宫。">
            <template #actions><button type="button" :disabled="classActionsDisabled" class="ui-button-secondary" @click="openClass()">添加课外班</button></template>
          </ParentPageState>
          <div v-if="classes.length" class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div v-for="cls in classes" :key="cls.id" :data-class-id="cls.id" class="min-w-0 p-4 rounded-2xl border border-violet-100 dark:border-violet-800 bg-violet-50/30 dark:bg-violet-950/40">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-base font-black text-slate-800 dark:text-slate-100 font-chinese truncate">{{ cls.title }}</div>
                  <div class="text-xs font-bold text-violet-600 dark:text-violet-300">
                    每{{ WEEK_ORDER.filter(d => cls.days_of_week.includes(d)).map(d => WEEKDAY_NAMES[d]).join('、') }} {{ timeRange(cls.start_time, cls.end_time) }}
                  </div>
                </div>
              </div>
              <div class="mt-1.5 space-y-0.5 break-words text-xs font-bold text-slate-500 dark:text-slate-400 font-chinese">
                <div v-if="cls.institution || cls.location">📍 {{ [cls.institution, cls.location].filter(Boolean).join(' · ') }}</div>
                <div v-if="cls.teacher || cls.bring">{{ [cls.teacher && `老师：${cls.teacher}`, cls.bring && `带：${cls.bring}`].filter(Boolean).join(' · ') }}</div>
                <div>
                  👶 {{ cls.child_ids === null ? '全部孩子' : children.filter(c => cls.child_ids.includes(c.id)).map(c => c.name).join('、') }}
                  <span v-if="cls.create_task" class="ml-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">打卡 ★{{ cls.points }}</span>
                  <span v-if="cls.auto_homework" class="ml-1 px-1.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200">确认上课后生成作业</span>
                  <span class="ml-1 text-slate-400">{{ cls.start_date }} 起{{ cls.end_date ? `，到 ${cls.end_date}` : '' }}</span>
                  <span v-if="cls.total_lessons" class="ml-1">共 {{ cls.total_lessons }} 次</span>
                </div>
              </div>

              <ClassStatsPanel v-if="statsFor(cls)" :key="`${cls.id}:${selectedChild.id}`" :summary="statsFor(cls)" :child="selectedChild" :disabled="writeBusy || statsRefreshing || statsError" @opened="statsOpened = $event" @busy="statsBusy = $event" @changed="reload" />

              <!-- The selected child's next four weeks: tap a lesson to ask for leave or move it -->
              <div class="mt-3 pt-2 border-t border-violet-100 dark:border-violet-800">
                <div class="text-xs font-bold text-slate-400 mb-1.5">{{ selectedChild.name }}接下来的课（点一下请假或调课）</div>
                <p v-if="!attends(cls)" class="text-xs font-bold text-slate-400">{{ selectedChild.name }}不上这门课</p>
                <p v-else-if="scheduleRefreshing" role="status" class="text-xs font-bold text-slate-400">正在读取待上课程…</p>
                <p v-else-if="scheduleError" class="text-xs font-bold text-slate-400">待上课程尚未读取成功，请刷新课程数据。</p>
                <p v-else-if="scheduleReady && !upcomingLessons(cls).length" class="text-xs font-bold text-slate-400">四周内没有课</p>
                <div v-if="attends(cls) && upcomingLessons(cls).length" class="flex flex-wrap gap-1.5">
                  <button
                    v-for="lesson in upcomingLessons(cls)"
                    :key="lesson.date"
                    :data-source-date="lesson.date"
                    type="button"
                    :disabled="courseActionsDisabled"
                    class="min-h-11 min-w-11 px-2 py-1 rounded-lg border text-xs font-bold font-chinese disabled:opacity-50"
                    :class="lesson.status === 'scheduled' ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 dark:hover:border-violet-700' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'"
                    @click="openException(cls, lesson)"
                  >
                    <span v-if="lesson.lesson_number">第 {{ lesson.lesson_number }} 次 · </span>{{ shortDate(lesson.date) }} {{ WEEKDAY_NAMES[weekdayOf(lesson.date)] }}<template v-if="lesson.status !== 'scheduled'"> · {{ lessonNote(lesson) }}</template>
                  </button>
                </div>
              </div>
              <div class="mt-3 pt-3 border-t border-violet-100 dark:border-violet-800 flex flex-wrap gap-2">
                <button type="button" :disabled="courseActionsDisabled" class="min-h-11 min-w-11 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50" @click="openClass(cls)">编辑</button>
                <button type="button" :disabled="classActionsDisabled" class="ml-auto min-h-11 min-w-11 px-3 rounded-xl text-xs font-bold text-slate-400 hover:text-rose-500 dark:hover:text-rose-400" @click="removeClass(cls)">删除</button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </main>

    <TimetableEditor
      v-if="timetableModal"
      :child-id="selectedChild.id"
      :timetable="timetableModal.timetable"
      :copy-from="timetableModal.copyFrom"
      @busy="modalSaving = $event"
      @close="timetableModal = null"
      @saved="afterSave(() => { timetableModal = null; })"
    />
    <OutsideClassModal
      v-if="classModal"
      :cls="classModal.cls"
      :children="children"
      @busy="modalSaving = $event"
      @close="classModal = null"
      @saved="afterClassSave"
    />
    <ClassExceptionModal
      v-if="exceptionModal"
      :cls="exceptionModal.cls"
      :child="selectedChild"
      :lesson="exceptionModal.lesson"
      @busy="modalSaving = $event"
      @close="exceptionModal = null"
      @saved="afterClassSave"
    />
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { confirmAction } from '../utils/confirmation';
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { hasSession } from '../utils/session';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import ParentPageHeader from '../components/ParentPageHeader.vue';
import ParentPageState from '../components/ParentPageState.vue';
import ParentChildPicker from '../components/ParentChildPicker.vue';
import ParentSectionNav from '../components/ParentSectionNav.vue';
import { useParentChildSelection } from '../composables/useParentChildSelection';
import TimetableEditor from '../components/TimetableEditor.vue';
import OutsideClassModal from '../components/OutsideClassModal.vue';
import ClassExceptionModal from '../components/ClassExceptionModal.vue';
import ClassStatsPanel from '../components/ClassStatsPanel.vue';
import { WEEKDAY_NAMES, WEEK_ORDER, addDays, lessonNote, shortDate, timeRange } from '../utils/schedule.js';
const calendar = useCalendarStore();

const today = computed(() => calendar.today);
const route = useRoute();
const children = ref([]);
const selectedChild = ref(null);
const { initialChild, changeChild } = useParentChildSelection(children, selectedChild, selectChild);
const timetables = ref([]);
const classes = ref([]);
const classStats = ref([]);
const statsFor = cls => classStats.value.find(item => item.class_id === cls.id);
let alive = true, childSerial = 0, classSerial = 0, timetableSerial = 0, scheduleSerial = 0, statsSerial = 0, initialSerial = 0;
const classesReady = ref(false);
const scheduleReady = ref(false);
const timetablesReady = ref(false);
const classesRefreshing = ref(false);
const scheduleRefreshing = ref(false);
const timetablesRefreshing = ref(false), statsRefreshing = ref(false);
const classesError = ref(''), scheduleError = ref(''), timetablesError = ref(''), childrenError = ref('');
const statsError = ref(false);
const courseRefreshing = computed(() => classesRefreshing.value || scheduleRefreshing.value);
const courseDataFailed = computed(() => Boolean(classesError.value || scheduleError.value));
const modalSaving = ref(false), deleting = ref(false), statsBusy = ref(false), statsOpened = ref(false);
const writeBusy = computed(() => modalSaving.value || deleting.value || statsBusy.value);
const courseActionsDisabled = computed(() => classActionsDisabled.value || !scheduleReady.value || scheduleRefreshing.value || Boolean(scheduleError.value));
const classActionsDisabled = computed(() => writeBusy.value || !classesReady.value || classesRefreshing.value || Boolean(classesError.value));
const schoolActionsDisabled = computed(() => writeBusy.value || !timetablesReady.value || timetablesRefreshing.value || Boolean(timetablesError.value));
const upcoming = ref([]);
const loading = ref(true);
const error = ref('');
const timetableModal = ref(null);
const classModal = ref(null);
const exceptionModal = ref(null);
const modalOpen = computed(() => Boolean(timetableModal.value || classModal.value || exceptionModal.value || statsOpened.value));
onBeforeRouteLeave(to => !hasSession('parent') || ['/parent/login', '/parent/setup-pin'].includes(to.path) || !writeBusy.value);
onBeforeRouteUpdate(() => { if (writeBusy.value) return false; closeForms(); });
function closeForms() { timetableModal.value = null; classModal.value = null; exceptionModal.value = null; }

const weekdayOf = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const attends = cls => cls.child_ids === null || cls.child_ids.includes(selectedChild.value.id);
// Lessons on their usual dates (also when on leave or moved away), from the next four weeks.
const upcomingLessons = cls => upcoming.value.flatMap(day => day.outside)
  .filter(lesson => lesson.class_id === cls.id && lesson.status !== 'moved_in');

function termStatus(timetable) {
  if (today.value < timetable.start_date) return { label: '未开始', class: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' };
  if (today.value > timetable.end_date) return { label: '已结束', class: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' };
  return { label: '使用中', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' };
}

function showError(err) {
  error.value = message(err);
}
const message = err => typeof err === 'string' ? err : err.message || '操作失败，请重试';
function childRequest() {
  const id = selectedChild.value?.id, epoch = childSerial, date = today.value, timeZone = calendar.timeZone;
  return { id, date, current: () => alive && selectedChild.value?.id === id && epoch === childSerial && date === today.value && timeZone === calendar.timeZone };
}

async function loadTimetables() {
  const request = childRequest(), serial = ++timetableSerial;
  if (!request.id) return;
  const current = () => request.current() && serial === timetableSerial;
  timetablesRefreshing.value = true;
  try {
    const rows = await api.getTimetables(request.id);
    if (current()) { timetables.value = rows; timetablesReady.value = true; timetablesError.value = ''; }
  } catch (err) { if (current()) timetablesError.value = message(err); }
  finally { if (current()) timetablesRefreshing.value = false; }
}

async function loadSchedule() {
  const request = childRequest(), serial = ++scheduleSerial;
  if (!request.id) return;
  const current = () => request.current() && serial === scheduleSerial;
  scheduleRefreshing.value = true;
  try {
    const rows = await api.getChildSchedule(request.id, request.date, addDays(request.date, 27));
    if (current()) { upcoming.value = rows; scheduleReady.value = true; scheduleError.value = ''; }
  } catch (err) { if (current()) scheduleError.value = message(err); }
  finally { if (current()) scheduleRefreshing.value = false; }
}

async function loadClasses() {
  const serial = ++classSerial;
  const current = () => alive && serial === classSerial;
  classesRefreshing.value = true;
  try {
    const rows = await api.getOutsideClasses();
    if (current()) { classes.value = rows; classesReady.value = true; classesError.value = ''; }
  } catch (err) { if (current()) classesError.value = message(err); }
  finally { if (current()) classesRefreshing.value = false; }
}

async function refreshClassStats() {
  const request = childRequest(), serial = ++statsSerial;
  if (!request.id) return;
  const current = () => request.current() && serial === statsSerial;
  statsRefreshing.value = true;
  try {
    const rows = await api.getOutsideClassStats(request.id);
    if (current()) { classStats.value = rows; statsError.value = false; }
  } catch { if (current()) statsError.value = true; }
  finally { if (current()) statsRefreshing.value = false; }
}

function loadChild() {
  // Summary requests must never hold up either editor or the next lessons.
  refreshClassStats();
  return Promise.allSettled([loadTimetables(), loadSchedule()]);
}
watch(() => [today.value, calendar.timeZone], () => { if (selectedChild.value) loadChild(); });

async function selectChild(child) {
  if (writeBusy.value) return;
  childSerial++;
  selectedChild.value = child;
  classStats.value = [];
  upcoming.value = [];
  timetables.value = [];
  timetablesReady.value = false; scheduleReady.value = false;
  timetablesError.value = ''; scheduleError.value = ''; statsError.value = false;
  statsOpened.value = false;
  closeForms();
  error.value = '';
  await loadChild();
}

async function reload() {
  await Promise.allSettled([loadClasses(), loadChild()]);
}
async function reloadCourses() {
  await Promise.allSettled([loadClasses(), loadSchedule()]);
  await openLinkedLesson();
}
function openClass(cls = null) {
  if (cls ? courseActionsDisabled.value : classActionsDisabled.value) return;
  classModal.value = { cls };
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
  if (!cls || !attends(cls) || courseActionsDisabled.value || modalOpen.value) return;
  const epoch = childSerial;
  const current = () => alive && epoch === childSerial && route.query.child === child && route.query.class === classId && route.query.date === date;
  // A lesson moved into today may have its original date outside the usual four weeks.
  let lesson = upcoming.value.flatMap(day => day.outside).find(item => item.class_id === classId && item.date === date && item.status !== 'moved_in');
  if (!lesson) {
    try {
      const days = await api.getChildSchedule(child, date, date);
      lesson = days.flatMap(day => day.outside).find(item => item.class_id === classId && item.status !== 'moved_in');
    } catch { return; }
  }
  if (!lesson || !current() || selectedChild.value?.id !== child || courseActionsDisabled.value || modalOpen.value) return;
  await nextTick();
  if (!current() || courseActionsDisabled.value || modalOpen.value) return;
  [...document.querySelectorAll('[data-class-id]')].find(node => node.dataset.classId === classId)?.scrollIntoView({ block: 'center' });
  openException(cls, lesson);
}
async function afterSave(close) {
  close();
  modalSaving.value = false;
  error.value = '';
  try {
    await reload();
  } catch (err) {
    showError(err);
  }
}

function afterClassSave(savedClass) {
  if (!alive) return;
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
  if (schoolActionsDisabled.value) return;
  timetableModal.value = { timetable, copyFrom };
}

async function removeTimetable(timetable) {
  if (schoolActionsDisabled.value) return;
  const childId = selectedChild.value?.id;
  if (!await confirmAction(`确定删除课程表「${timetable.name}」吗？`)) return;
  if (!alive || schoolActionsDisabled.value || selectedChild.value?.id !== childId) return;
  deleting.value = true; error.value = '';
  try {
    await api.deleteTimetable(timetable.id);
    timetables.value = timetables.value.filter(item => item.id !== timetable.id);
    await reload();
  } catch (err) {
    showError(err);
  } finally { deleting.value = false; }
}

async function removeClass(cls) {
  if (classActionsDisabled.value) return;
  if (!await confirmAction(`确定删除课外班「${cls.title}」吗？本班的出勤、学费和未完成打卡任务会一起删除；已完成的打卡、作业记录和积分保留。`)) return;
  if (!alive || classActionsDisabled.value) return;
  deleting.value = true; error.value = '';
  try {
    await api.deleteOutsideClass(cls.id);
    classes.value = classes.value.filter(item => item.id !== cls.id);
    upcoming.value = upcoming.value.map(day => ({ ...day, outside: day.outside.filter(item => item.class_id !== cls.id) }));
    classStats.value = classStats.value.filter(item => item.class_id !== cls.id);
    await reload();
  } catch (err) {
    showError(err);
  } finally { deleting.value = false; }
}

async function loadInitial() {
  const serial = ++initialSerial;
  loading.value = true;
  try {
    const rows = await api.getChildren();
    if (!alive || serial !== initialSerial) return;
    children.value = rows; childrenError.value = ''; loading.value = false;
    if (children.value.length) {
      await Promise.allSettled([selectChild(initialChild()), loadClasses()]);
    } else { selectedChild.value = null; closeForms(); }
  } catch (err) {
    if (alive && serial === initialSerial) childrenError.value = message(err);
  } finally {
    if (alive && serial === initialSerial) loading.value = false;
  }
  if (alive && serial === initialSerial) await openLinkedLesson();
}
function restored() {
  childSerial++; classSerial++; timetableSerial++; scheduleSerial++; statsSerial++;
  closeForms(); statsOpened.value = false; modalSaving.value = false;
  timetables.value = []; classes.value = []; classStats.value = []; upcoming.value = [];
  classesReady.value = false; scheduleReady.value = false; timetablesReady.value = false;
  error.value = ''; loadInitial();
}
onMounted(() => { loadInitial(); window.addEventListener('taskie:data-restored', restored); });
onBeforeUnmount(() => {
  alive = false; childSerial++; classSerial++; timetableSerial++; scheduleSerial++; statsSerial++; initialSerial++;
  window.removeEventListener('taskie:data-restored', restored);
});
</script>
