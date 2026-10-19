<template>
  <div class="min-h-screen bg-slate-50 pb-12">
    <ParentNavBar />
    <main class="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <router-link to="/parent/dashboard" class="text-sm font-bold text-brand-600">← 返回数据总览</router-link>
      <h2 class="text-xl font-black text-slate-800">{{ childName }} · 家长补卡</h2>
      <p class="text-sm text-slate-500">选择过去日期，为当天的普通任务补记完成。孩子当天没打开 App 的任务也会列出。积分和完成度计入任务所属日期，补卡不计入当天完成时间统计。</p>
      <label class="flex items-center gap-3 text-sm font-bold text-slate-700">
        任务日期
        <input v-model="date" type="date" :max="yesterday" :disabled="busy" class="rounded-xl border p-2" @change="load" />
      </label>
      <p v-if="error" role="alert" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>
      <p v-if="loading" class="text-slate-500">正在加载…</p>
      <template v-else>
        <p v-if="!tasks.length" class="bg-white rounded-2xl p-5 text-sm text-slate-500">当天没有需要完成的任务。长期任务请到「假期与长期任务」补记进度。</p>
        <article v-for="task in tasks" :key="task.id" class="bg-white border rounded-2xl p-4 space-y-3">
          <div class="flex justify-between gap-3">
            <div>
              <h3 class="font-bold text-slate-800">{{ task.subject }} · {{ task.title }}</h3>
              <p class="text-xs text-slate-500 mt-1">
                {{ task.is_completed ? (task.completion_source === 'parent_backfill' ? '已完成 · 家长补记' : '已完成') : task.is_skipped ? '已跳过，请先撤销跳过再补卡' : '未完成' }}
                · {{ task.is_completed ? task.earned_points ?? task.points : task.award_points ?? task.points }} 积分
                <span v-if="task.is_extra" class="text-violet-600"> · 额外挑战（不影响考核）</span>
                <template v-if="task.schedule_type === 'weekly_times'"> · 每周目标 {{ task.weekly_target_times }} 次</template>
                <template v-if="task.duration_seconds"> · 用时 {{ Math.round(task.duration_seconds / 60) }} 分钟</template>
                <span v-if="task.projected" class="text-amber-600"> · 当天未打开 App</span>
              </p>
            </div>
            <button v-if="task.is_completed && task.completion_source === 'parent_backfill'" :disabled="busy || loading" class="text-sm font-bold text-rose-600 disabled:opacity-50" @click="act(task, 'undo')">撤销补卡</button>
            <button v-else-if="task.is_skipped" :disabled="busy || loading" class="text-sm font-bold text-slate-600 disabled:opacity-50" @click="act(task, 'unskip')">撤销跳过</button>
          </div>
          <p v-if="!task.is_completed && task.is_extra && !task.allow_extra" class="text-xs text-slate-400">本周目标已完成，该任务未开启额外完成。</p>
          <form v-if="!task.is_completed && !task.is_skipped && (!task.is_extra || task.allow_extra)" class="flex flex-wrap items-center gap-3" @submit.prevent="act(task, 'complete')">
            <label v-if="task.track_time" class="text-xs text-slate-600">
              实际用时（可不填）
              <input v-model="minutes[task.id]" type="number" min="1" max="720" step="1" :disabled="busy" class="w-20 p-2 border rounded-lg ml-1" /> 分钟
            </label>
            <button :disabled="busy || loading" type="submit" class="px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50">补记完成</button>
          </form>
        </article>
        <section v-if="events.length" class="rounded-2xl bg-white border p-4">
          <h3 class="font-bold mb-3">补卡操作记录</h3>
          <ul class="space-y-2 text-xs text-slate-500">
            <li v-for="event in events" :key="event.id">{{ formatTime(event.created_at) }} · 家长{{ event.action === 'complete' ? '补记完成' : '撤销补卡' }}「{{ event.task_title }}」 · 积分 {{ event.points >= 0 ? '+' : '' }}{{ event.points }}</li>
          </ul>
        </section>
      </template>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';

const route = useRoute();
const d = new Date();
d.setDate(d.getDate() - 1);
const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const date = ref(yesterday), childName = ref('孩子');
const tasks = ref([]), events = ref([]), minutes = ref({});
const loading = ref(false), busy = ref(false), error = ref('');
let requestId = 0;
const formatTime = value => new Date(value).toLocaleString('zh-CN', { hour12: false });

async function load() {
  const id = ++requestId;
  loading.value = true;
  error.value = '';
  tasks.value = [];
  events.value = [];
  minutes.value = {};
  try {
    const result = await api.getBackfillTasks(route.params.id, date.value);
    if (id !== requestId) return;
    tasks.value = result.tasks;
    events.value = result.events;
  } catch (err) {
    if (id === requestId) error.value = typeof err === 'string' ? err : '加载失败，请重新选择日期重试';
  } finally {
    if (id === requestId) loading.value = false;
  }
}

async function materialize(task) {
  const result = await api.materializeBackfillDay(route.params.id, task.date);
  const row = result.tasks.find(item => !item.projected && (task.class_id
    ? item.class_id === task.class_id && item.class_lesson_date === task.class_lesson_date
    : item.template_id === task.template_id));
  if (!row) throw '当天的任务已变化，请刷新后重试';
  return row;
}

async function act(task, action) {
  if (busy.value || loading.value) return;
  const message = action === 'complete'
    ? `为${childName.value}补记 ${task.date} 的「${task.title}」完成？${task.is_extra ? '额外完成，' : ''}将增加 ${task.award_points ?? task.points} 积分。`
    : action === 'undo'
      ? `撤销${childName.value} ${task.date} 的「${task.title}」补卡？将扣回 ${task.earned_points ?? task.points} 积分，已兑换时余额可能为负。`
      : `撤销 ${task.date} 的「${task.title}」跳过状态？`;
  if (!confirm(message)) return;
  const value = minutes.value[task.id];
  busy.value = true;
  error.value = '';
  try {
    // A task of a day the child never opened exists only once the parent acts on it.
    if (task.projected) task = await materialize(task);
    if (action === 'complete') {
      await api.backfillDailyTask(task.id, { duration_seconds: value ? Number(value) * 60 : null });
    } else if (action === 'undo') await api.undoBackfillDailyTask(task.id);
    else await api.unskipDailyTask(task.id);
    await load();
  } catch (err) {
    const message = typeof err === 'string' ? err : '操作失败，请重试';
    await load();
    error.value = message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await load();
  try {
    const children = await api.getChildren();
    childName.value = children.find(child => child.id === route.params.id)?.name || '孩子';
  } catch { /* Task loading reports access errors independently. */ }
});
</script>
