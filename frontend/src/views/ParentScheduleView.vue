<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
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
          :class="selectedChild?.id === child.id ? 'bg-brand-500 border-brand-500 text-white shadow-button' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'"
          @click="selectChild(child)"
        >
          {{ child.avatar_emoji }} {{ child.name }}
        </button>
      </div>

      <p v-if="error" class="mb-4 px-4 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ error }}</p>
      <div v-if="loading" class="text-center py-20 text-brand-500 font-bold"><span class="animate-spin mr-2">⏳</span> 正在加载...</div>

      <template v-else-if="selectedChild">
        <!-- School timetables of the selected child -->
        <section class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-lg font-black text-slate-800">🏫 {{ selectedChild.name }}的学校课程表</h3>
            <div class="flex flex-wrap gap-2">
              <button v-if="timetables.length" type="button" class="px-3 py-2 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50" @click="openTimetable(null, timetables[0])">
                📋 复制「{{ timetables[0].name }}」为新学期
              </button>
              <button type="button" class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button" @click="openTimetable(null)">➕ 新建课程表</button>
            </div>
          </div>
          <p v-if="!timetables.length" class="text-xs font-bold text-slate-400 py-2">还没有课程表。新建时会带上常见的小学作息时间，点格子填课就行。</p>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div v-for="timetable in timetables" :key="timetable.id" class="p-4 rounded-2xl border border-slate-200 bg-slate-50/50">
              <div class="flex items-center justify-between gap-2">
                <span class="text-base font-black text-slate-800 font-chinese truncate">{{ timetable.name }}</span>
                <span class="shrink-0 px-2 py-0.5 rounded-lg text-[11px] font-black" :class="termStatus(timetable).class">{{ termStatus(timetable).label }}</span>
              </div>
              <div class="mt-1 text-xs font-bold text-slate-500">
                {{ timetable.start_date }} 至 {{ timetable.end_date }} · {{ timetable.slots.filter(s => s.kind === 'class').length }} 节 / 天 · 共 {{ timetable.lessons.length }} 节课
                <span v-if="timetable.ab_weeks" class="ml-1 px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-600">单双周</span>
              </div>
              <div class="mt-3 flex gap-2">
                <button type="button" class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600" @click="openTimetable(timetable)">✏️ 编辑</button>
                <button type="button" class="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-500" @click="removeTimetable(timetable)">删除</button>
              </div>
            </div>
          </div>
        </section>

        <!-- Outside classes (shared between children) -->
        <section class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card mb-5">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 class="text-lg font-black text-slate-800">🎨 课外班</h3>
            <button type="button" class="px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-white text-xs font-bold" @click="classModal = { cls: null }">➕ 新增课外班</button>
          </div>
          <p v-if="!classes.length" class="text-xs font-bold text-slate-400 py-2">还没有课外班。例如“钢琴课 每周三 16:30–17:30 少年宫”。</p>
          <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div v-for="cls in classes" :key="cls.id" class="p-4 rounded-2xl border border-violet-100 bg-violet-50/30">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="text-base font-black text-slate-800 font-chinese truncate">{{ cls.title }}</div>
                  <div class="text-xs font-bold text-violet-600">
                    每{{ WEEK_ORDER.filter(d => cls.days_of_week.includes(d)).map(d => WEEKDAY_NAMES[d]).join('、') }} {{ timeRange(cls.start_time, cls.end_time) }}
                  </div>
                </div>
                <div class="flex shrink-0 gap-1">
                  <button type="button" class="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600" @click="classModal = { cls }">编辑</button>
                  <button type="button" class="px-2 py-1 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-500" @click="removeClass(cls)">删除</button>
                </div>
              </div>
              <div class="mt-1.5 space-y-0.5 text-xs font-bold text-slate-500 font-chinese">
                <div v-if="cls.institution || cls.location">📍 {{ [cls.institution, cls.location].filter(Boolean).join(' · ') }}</div>
                <div v-if="cls.teacher || cls.bring">{{ [cls.teacher && `老师：${cls.teacher}`, cls.bring && `带：${cls.bring}`].filter(Boolean).join(' · ') }}</div>
                <div>
                  👶 {{ cls.child_ids === null ? '全部孩子' : children.filter(c => cls.child_ids.includes(c.id)).map(c => c.name).join('、') }}
                  <span v-if="cls.create_task" class="ml-1 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700">打卡 ★{{ cls.points }}</span>
                  <span class="ml-1 text-slate-400">{{ cls.start_date }} 起{{ cls.end_date ? `，到 ${cls.end_date}` : '' }}</span>
                </div>
              </div>

              <!-- The selected child's next four weeks: tap a lesson to ask for leave or move it -->
              <div class="mt-3 pt-2 border-t border-violet-100">
                <div class="text-[11px] font-bold text-slate-400 mb-1.5">{{ selectedChild.name }}接下来的课（点一下请假或调课）</div>
                <p v-if="!attends(cls)" class="text-[11px] font-bold text-slate-400">{{ selectedChild.name }}不上这门课</p>
                <p v-else-if="!upcomingLessons(cls).length" class="text-[11px] font-bold text-slate-400">四周内没有课</p>
                <div v-else class="flex flex-wrap gap-1.5">
                  <button
                    v-for="lesson in upcomingLessons(cls)"
                    :key="lesson.date"
                    type="button"
                    class="px-2 py-1 rounded-lg border text-[11px] font-bold font-chinese"
                    :class="lesson.status === 'scheduled' ? 'bg-white border-slate-200 text-slate-600 hover:border-violet-300' : 'bg-amber-50 border-amber-200 text-amber-700'"
                    @click="exceptionModal = { cls, lesson }"
                  >
                    {{ shortDate(lesson.date) }} {{ WEEKDAY_NAMES[weekdayOf(lesson.date)] }}<template v-if="lesson.status !== 'scheduled'"> · {{ lessonNote(lesson) }}</template>
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
      @saved="afterSave(() => { classModal = null; })"
    />
    <ClassExceptionModal
      v-if="exceptionModal"
      :cls="exceptionModal.cls"
      :child="selectedChild"
      :lesson="exceptionModal.lesson"
      @close="exceptionModal = null"
      @saved="afterSave(() => { exceptionModal = null; })"
    />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import TimetableEditor from '../components/TimetableEditor.vue';
import OutsideClassModal from '../components/OutsideClassModal.vue';
import ClassExceptionModal from '../components/ClassExceptionModal.vue';
import { WEEKDAY_NAMES, WEEK_ORDER, addDays, lessonNote, localDate, shortDate, timeRange } from '../utils/schedule.js';

const today = localDate();
const children = ref([]);
const selectedChild = ref(null);
const timetables = ref([]);
const classes = ref([]);
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
  if (today < timetable.start_date) return { label: '未开始', class: 'bg-sky-100 text-sky-700' };
  if (today > timetable.end_date) return { label: '已结束', class: 'bg-slate-100 text-slate-500' };
  return { label: '使用中', class: 'bg-emerald-100 text-emerald-700' };
}

function showError(err) {
  error.value = typeof err === 'string' ? err : '操作失败，请重试';
}

async function loadChild() {
  const id = selectedChild.value.id;
  const [list, days] = await Promise.all([api.getTimetables(id), api.getChildSchedule(id, today, addDays(today, 27))]);
  if (selectedChild.value?.id !== id) return;
  timetables.value = list;
  upcoming.value = days;
}

async function selectChild(child) {
  selectedChild.value = child;
  error.value = '';
  try {
    await loadChild();
  } catch (err) {
    showError(err);
  }
}

async function reload() {
  [classes.value] = await Promise.all([api.getOutsideClasses(), loadChild()]);
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

function openTimetable(timetable, copyFrom = null) {
  timetableModal.value = { timetable, copyFrom };
}

async function removeTimetable(timetable) {
  if (!confirm(`确定删除课程表「${timetable.name}」吗？`)) return;
  try {
    await api.deleteTimetable(timetable.id);
    await reload();
  } catch (err) {
    showError(err);
  }
}

async function removeClass(cls) {
  if (!confirm(`确定删除课外班「${cls.title}」吗？还没完成的打卡任务会一起删除，已完成的记录和积分保留。`)) return;
  try {
    await api.deleteOutsideClass(cls.id);
    await reload();
  } catch (err) {
    showError(err);
  }
}

onMounted(async () => {
  try {
    children.value = await api.getChildren();
    if (children.value.length) {
      selectedChild.value = children.value[0];
      await reload();
    }
  } catch (err) {
    showError(err);
  } finally {
    loading.value = false;
  }
});
</script>
