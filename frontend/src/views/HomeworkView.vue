<template>
  <div class="min-h-screen bg-[#F4F6FB] p-3 pb-24 sm:p-6 lg:pb-6 select-none">
    <div class="max-w-5xl w-full mx-auto">
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            class="hidden lg:flex w-12 h-12 rounded-2xl bg-white border border-slate-200 items-center justify-center text-xl text-slate-600 hover:border-brand-300 shadow-sm active:scale-95 transition-all"
            title="返回今日看板"
            @click="playClick"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <span>📒</span>
              <span>作业本</span>
            </h1>
            <p class="text-xs font-bold text-slate-400">每门课布置了什么作业，记下来随时查</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2.5 whitespace-nowrap">
          <button
            v-if="asParent"
            type="button"
            class="h-11 px-3.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold text-xs shadow-sm active:scale-95 transition-all"
            @click="pointsOpen = true"
          >
            ⚙️ 课程默认积分
          </button>
          <button
            type="button"
            class="h-11 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 text-white font-black text-xs shadow-button active:scale-95 transition-all"
            @click="openForm(null)"
          >
            ➕ 记作业
          </button>
        </div>
      </header>

      <!-- Course and status filters, and a search over the content -->
      <div class="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200/80 shadow-sm mb-4 space-y-3">
        <div class="flex gap-2 overflow-x-auto whitespace-nowrap -mx-1 px-1">
          <button
            v-for="option in courseFilters"
            :key="option.key"
            type="button"
            class="shrink-0 px-3 py-1.5 rounded-xl text-xs font-bold border font-chinese"
            :class="courseFilter === option.key ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200 text-slate-600'"
            @click="courseFilter = option.key"
          >
            {{ option.label }}
          </button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="option in [{ key: 'all', label: '全部' }, { key: 'todo', label: '还没完成' }]"
            :key="option.key"
            type="button"
            class="px-3 py-1.5 rounded-xl text-xs font-bold"
            :class="statusFilter === option.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'"
            @click="statusFilter = option.key"
          >
            {{ option.label }}
          </button>
          <input v-model="search" type="search" placeholder="搜索作业内容" class="flex-1 min-w-[160px] px-3 py-1.5 rounded-xl border border-slate-200 text-xs outline-none focus:border-brand-500 font-chinese" />
        </div>
      </div>

      <p v-if="actionError" class="mb-3 px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ actionError }}</p>

      <div v-if="loading" class="text-center py-16 text-brand-500 font-bold"><span class="animate-spin mr-2">⏳</span> 正在加载作业本...</div>

      <div v-else-if="!shown.length" class="text-center py-16 bg-white rounded-3xl border border-slate-200">
        <div class="text-5xl mb-2">📒</div>
        <p class="text-slate-500 text-sm font-bold">{{ records.length ? '没有符合条件的作业' : '还没有作业记录，点“记作业”记下老师布置的作业吧' }}</p>
      </div>

      <div v-else class="space-y-4">
        <section v-for="group in groups" :key="group.date">
          <h3 class="px-1 mb-2 text-xs font-black text-slate-500">{{ group.date === today ? '今天' : dayName(group.date) }} 布置</h3>
          <ul class="space-y-2">
            <li v-for="record in group.records" :key="record.id" class="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-sm">
              <div class="flex flex-wrap items-center gap-2 mb-1.5">
                <span class="px-2 py-0.5 rounded-lg text-xs font-bold font-chinese" :class="record.course_kind === 'class' ? 'bg-violet-100 text-violet-700' : 'bg-brand-50 text-brand-700'">{{ record.subject }}</span>
                <span class="text-[11px] font-bold" :class="dueClass(record)">{{ dueText(record) }}</span>
                <span class="ml-auto px-2 py-0.5 rounded-lg text-[11px] font-black" :class="STATE[record.task_state].class">{{ STATE[record.task_state].label }}</span>
              </div>
              <p class="text-sm font-bold text-slate-700 whitespace-pre-line break-words font-chinese">{{ record.content }}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
                <span class="text-slate-400">{{ record.created_by === 'child' ? '孩子记录' : '家长记录' }}<template v-if="record.task || record.task_requested"> · ★{{ record.task ? record.task.points : record.points }}</template></span>
                <span class="flex-1"></span>
                <template v-if="asParent && record.task_state === 'pending'">
                  <button type="button" :disabled="busy" class="px-3 py-1.5 rounded-lg bg-emerald-500 text-white disabled:opacity-50" @click="createTask(record)">生成任务</button>
                  <button type="button" :disabled="busy" class="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50" @click="rejectTask(record)">不需要</button>
                </template>
                <button v-else-if="asParent && record.can_create_task" type="button" :disabled="busy" class="px-3 py-1.5 rounded-lg bg-orange-50 text-orange-700 disabled:opacity-50" @click="createTask(record)">➕ 生成打卡任务</button>
                <template v-if="editable(record)">
                  <button type="button" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600" @click="openForm(record)">修改</button>
                  <button type="button" class="px-3 py-1.5 rounded-lg text-slate-400 hover:text-rose-500" @click="deleteTarget = record">删除</button>
                </template>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <HomeworkFormModal
      v-if="form"
      :child-id="childId"
      :courses="courses"
      :as-parent="asParent"
      :record="form.record"
      @close="form = null"
      @saved="onSaved"
    />

    <!-- Deleting a record with a task: keep the task or delete it too -->
    <div v-if="deleteTarget" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="deleteTarget = null">
      <div class="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
        <h3 class="text-lg font-black text-slate-800 font-chinese">删除这条作业记录？</h3>
        <p class="text-xs font-bold text-slate-500 font-chinese whitespace-pre-line line-clamp-3">{{ deleteTarget.subject }}：{{ deleteTarget.content }}</p>
        <p v-if="deleteTarget.task" class="text-xs font-bold text-amber-600">它已经生成了打卡任务{{ deleteTarget.task.is_completed ? '，而且已经完成，一起删除会扣回积分' : '' }}。</p>
        <div class="flex flex-col gap-2">
          <button v-if="deleteTarget.task" type="button" :disabled="busy" class="px-4 py-2.5 rounded-xl bg-rose-500 text-white text-xs font-bold disabled:opacity-50" @click="remove(true)">删除记录和打卡任务</button>
          <button type="button" :disabled="busy" class="px-4 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50" :class="deleteTarget.task ? 'bg-slate-100 text-slate-700' : 'bg-rose-500 text-white'" @click="remove(false)">
            {{ deleteTarget.task ? '只删除记录，保留任务' : '删除' }}
          </button>
          <button type="button" class="px-4 py-2 rounded-xl text-xs font-bold text-slate-500" @click="deleteTarget = null">取消</button>
        </div>
      </div>
    </div>

    <!-- Default points of each course's homework task -->
    <div v-if="pointsOpen" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="pointsOpen = false">
      <div class="bg-white rounded-3xl p-6 max-w-md w-full max-h-[92dvh] overflow-y-auto shadow-2xl space-y-4">
        <div>
          <h3 class="text-lg font-black text-slate-800">⚙️ 课程默认积分</h3>
          <p class="text-[11px] font-bold text-slate-400">记作业时按课程自动填写，每条作业还可以单独修改。所有孩子通用，没设置的课程默认 10 分。</p>
        </div>
        <p v-if="pointsError" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ pointsError }}</p>
        <p v-if="!courses.length" class="text-xs font-bold text-slate-400">还没有课程表或课外班。</p>
        <ul class="space-y-2">
          <li v-for="course in courses" :key="course.course_key" class="flex items-center gap-3">
            <span class="flex-1 text-sm font-bold text-slate-700 font-chinese">{{ course.kind === 'class' ? '🎹 ' : '' }}{{ course.subject }}</span>
            <input :value="course.points" type="number" min="0" max="10000" class="w-24 px-3 py-1.5 rounded-xl border border-slate-200 text-sm font-bold text-center outline-none focus:border-brand-500" @change="savePoints(course, $event.target.value)" />
            <span class="text-xs font-bold text-slate-400">分</span>
          </li>
        </ul>
        <div class="flex justify-end pt-2 border-t border-slate-100">
          <button type="button" class="px-5 py-2.5 rounded-xl bg-brand-500 text-white text-xs font-bold" @click="pointsOpen = false">完成</button>
        </div>
      </div>
    </div>

    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import ChildTabBar from '../components/ChildTabBar.vue';
import HomeworkFormModal from '../components/HomeworkFormModal.vue';
import { playClick } from '../utils/sound';
import { currentRole } from '../utils/session.js';
import { WEEKDAY_NAMES, addDays, localDate, shortDate } from '../utils/schedule.js';

// What became of a record's task.
const STATE = {
  none: { label: '仅记录', class: 'bg-slate-100 text-slate-500' },
  pending: { label: '等家长确认', class: 'bg-amber-100 text-amber-700' },
  open: { label: '待完成', class: 'bg-orange-100 text-orange-700' },
  done: { label: '已完成', class: 'bg-emerald-100 text-emerald-700' },
  skipped: { label: '已跳过', class: 'bg-slate-100 text-slate-500' },
  missed: { label: '没按时完成', class: 'bg-rose-100 text-rose-600' }
};

const route = useRoute();
const childId = computed(() => route.params.id);
// A parent opening the child's pages records and settles homework as the parent.
const asParent = currentRole() === 'parent';
const today = localDate();
const dayName = date => `${shortDate(date)} ${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

const records = ref([]);
const courses = ref([]);
const loading = ref(true);
const form = ref(null);
const deleteTarget = ref(null);
const pointsOpen = ref(false);
const pointsError = ref('');
const actionError = ref('');
const busy = ref(false);
const courseFilter = ref('all');
const statusFilter = ref('all');
const search = ref('');

const courseFilters = computed(() => {
  const options = [{ key: 'all', label: '全部' }];
  for (const item of [...courses.value, ...records.value]) {
    if (!options.some(option => option.key === item.course_key)) options.push({ key: item.course_key, label: item.subject });
  }
  return options;
});

const shown = computed(() => {
  const words = search.value.trim();
  return records.value.filter(record => (courseFilter.value === 'all' || record.course_key === courseFilter.value) &&
    (statusFilter.value === 'all' || ['open', 'pending'].includes(record.task_state) || (record.task_state === 'none' && record.due_date >= today)) &&
    (!words || record.content.includes(words)));
});

const groups = computed(() => {
  const byDate = [];
  for (const record of shown.value) {
    const group = byDate.at(-1);
    if (group?.date === record.assigned_date) group.records.push(record);
    else byDate.push({ date: record.assigned_date, records: [record] });
  }
  return byDate;
});

function dueText(record) {
  if (!record.due_date) return '没有截止日期';
  if (record.due_date === today) return '今天要完成';
  if (record.due_date === addDays(today, 1)) return '明天前完成';
  return `${dayName(record.due_date)}${record.due_date < today ? ' 截止' : ' 前完成'}`;
}
const dueClass = record => !record.due_date || record.due_date < today ? 'text-slate-400'
  : record.due_date <= addDays(today, 1) ? 'text-rose-500' : 'text-sky-600';

// A child may change only what they recorded themselves, until it has a task.
const editable = record => asParent || (record.created_by === 'child' && !record.task);

async function load() {
  try {
    [records.value, courses.value] = await Promise.all([api.getHomework(childId.value), api.getHomeworkCourses(childId.value)]);
  } catch (err) {
    actionError.value = typeof err === 'string' ? err : '加载失败，请刷新重试';
  } finally {
    loading.value = false;
  }
}

function openForm(record) {
  playClick();
  form.value = { record };
}

async function onSaved() {
  form.value = null;
  await load();
}

async function act(fn) {
  busy.value = true;
  actionError.value = '';
  try {
    await fn();
    await load();
  } catch (err) {
    actionError.value = typeof err === 'string' ? err : '操作失败，请重试';
  } finally {
    busy.value = false;
  }
}

const createTask = record => act(() => api.createHomeworkTask(record.id));
const rejectTask = record => act(() => api.rejectHomeworkTask(record.id));

async function remove(withTask) {
  const record = deleteTarget.value;
  deleteTarget.value = null;
  await act(() => api.deleteHomework(record.id, withTask));
}

async function savePoints(course, value) {
  pointsError.value = '';
  const points = Number(value);
  try {
    await api.setHomeworkCoursePoints(course.course_key, points);
    course.points = points;
  } catch (err) {
    pointsError.value = typeof err === 'string' ? err : '保存失败，请重试';
  }
}

onMounted(load);
</script>
