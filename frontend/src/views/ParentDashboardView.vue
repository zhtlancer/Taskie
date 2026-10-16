<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <!-- Title Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6 [&>*:last-child]:whitespace-nowrap">
        <div>
          <h2 class="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            <span>📊</span>
            <span>今日作业完成概览</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            实时查看所有孩子的打卡与任务进展
          </p>
        </div>

        <router-link
          to="/parent/tasks"
          class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button active:scale-95 transition-all"
        >
          📝 管理任务模板
        </router-link>
      </div>

      <!-- Quick Summary Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-8">
        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">已注册小朋友</span>
            <div class="text-3xl font-black text-slate-800 mt-1">
              {{ childrenStats.length }} <span class="text-sm font-bold text-slate-500">位</span>
            </div>
          </div>
          <span class="text-4xl">👶</span>
        </div>

        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">今日总任务完成率</span>
            <div class="text-3xl font-black text-emerald-600 mt-1">
              {{ overallCompletionRate }}%
            </div>
          </div>
          <span class="text-4xl">🎯</span>
        </div>

        <div class="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-card flex items-center justify-between">
          <div>
            <span class="text-xs font-bold text-slate-400">全员累计发放积分</span>
            <div class="text-3xl font-black text-amber-500 mt-1">
              {{ totalPointsIssued }} <span class="text-sm font-bold text-slate-500">分</span>
            </div>
          </div>
          <span class="text-4xl">🪙</span>
        </div>
      </div>

      <!-- Children's requests to skip a task, waiting for a parent -->
      <section v-if="skipRequests.length" class="mb-8 bg-white rounded-3xl p-5 border-2 border-amber-200 shadow-card">
        <h3 class="text-base font-bold text-slate-700 mb-3 flex items-center gap-2">
          <span>🙋</span>
          <span>跳过任务申请</span>
          <span class="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-xs">{{ skipRequests.length }}</span>
        </h3>
        <p v-if="skipError" class="mb-2 px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ skipError }}</p>
        <ul class="space-y-2">
          <li v-for="r in skipRequests" :key="r.id" class="p-3 rounded-2xl bg-amber-50/60 border border-amber-100 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-2xl">{{ r.child_avatar_emoji }}</span>
            <div class="flex-1 min-w-[180px]">
              <div class="text-sm font-bold text-slate-800 font-chinese">
                {{ r.child_name }} · {{ dayLabel(r.task_date) }} · {{ r.task_subject }} · {{ r.task_title }}
              </div>
              <div class="text-xs font-bold text-amber-700 font-chinese">理由：{{ r.reason }}</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <button type="button" :disabled="skipBusy" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50" @click="resolveSkip(r, 'approve')">同意跳过</button>
              <button type="button" :disabled="skipBusy" class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold disabled:opacity-50" @click="resolveSkip(r, 'reject')">不同意</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Children Detail Progress Grid -->
      <h3 class="text-base font-bold text-slate-700 mb-3 px-1">
        各个小朋友实时看板
      </h3>

      <div v-if="loading" class="text-center py-16 text-brand-500 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在统计今日作业进展...
      </div>

      <div v-else-if="childrenStats.length === 0" class="text-center py-16 bg-white rounded-3xl border border-slate-200">
        <div class="text-5xl mb-2">👶</div>
        <p class="text-slate-500 text-sm mb-4">还没有添加小朋友账号哦</p>
        <router-link
          to="/parent/children"
          class="px-5 py-2.5 rounded-xl bg-brand-500 text-white font-bold text-xs shadow-button"
        >
          立即添加小朋友
        </router-link>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          v-for="item in childrenStats"
          :key="item.child.id"
          class="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-card hover:shadow-card-hover transition-all"
        >
          <!-- Top Row: Avatar, Name, Link -->
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-16 h-16 rounded-2xl bg-brand-50 flex items-center justify-center text-3xl shadow-inner">
                {{ item.child.avatar_emoji || '🐱' }}
              </div>
              <div>
                <h4 class="text-xl font-bold text-slate-800">{{ item.child.name }}</h4>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-xs text-amber-600 font-extrabold flex items-center gap-0.5">
                    <span>🔥</span>
                    <span>连续 {{ item.stats.current_streak || 0 }} 天</span>
                  </span>
                  <span class="text-slate-300">·</span>
                  <span class="text-xs text-slate-500 font-bold">
                    今日积分 +{{ item.stats.today_points || 0 }}
                  </span>
                </div>
              </div>
            </div>

            <router-link
              :to="`/child/${item.child.id}/today`"
              class="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-600 text-xs font-bold transition-all"
            >
              进入看板 →
            </router-link>
          </div>

          <!-- Progress Bar & Count -->
          <div class="bg-slate-50 rounded-2xl p-4 border border-slate-100 mb-4">
            <div class="flex items-center justify-between text-xs font-bold mb-1.5">
              <span class="text-slate-500">今日完成情况</span>
              <span class="text-slate-800">
                完成 {{ item.stats.today_completed_tasks || 0 }} / {{ item.stats.today_total_tasks || 0 }} 项
                ({{ Math.round((item.stats.today_completion_rate || 0) * 100) }}%)
                <span v-if="item.stats.today_skipped_tasks" class="text-slate-400">· 跳过 {{ item.stats.today_skipped_tasks }} 项</span>
              </span>
            </div>

            <div class="w-full bg-slate-200 h-3 rounded-full overflow-hidden p-0.5">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="item.stats.today_completion_rate >= 1 ? 'bg-emerald-500' : 'bg-brand-500'"
                :style="{ width: `${Math.round((item.stats.today_completion_rate || 0) * 100)}%` }"
              ></div>
            </div>
          </div>

          <!-- Quick Stats Summary -->
          <div class="grid grid-cols-3 gap-3 text-center text-xs">
            <div class="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100">
              <span class="text-slate-400 font-semibold block text-[11px]">本周完成度·截至今天</span>
              <span class="text-base font-black text-emerald-600">{{ formatRate(item.week?.current_week?.completion?.completion_rate) }}</span>
              <span class="block text-[10px] font-bold text-slate-400">上周 {{ formatRate(item.week?.last_week?.completion?.completion_rate) }}</span>
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50/60 border border-amber-100">
              <span class="text-slate-400 font-semibold block text-[11px]">累计总积分</span>
              <span class="text-base font-black text-amber-600">{{ item.stats.total_points || 0 }} 分</span>
            </div>
            <div class="p-2.5 rounded-xl bg-indigo-50/60 border border-indigo-100">
              <span class="text-slate-400 font-semibold block text-[11px]">安全验证</span>
              <span class="text-base font-black text-brand-600">{{ item.child.has_pin ? '已设置 PIN' : '免密直登' }}</span>
            </div>
          </div>

          <!-- Active long-term tasks -->
          <div v-if="item.goals.length" class="mt-4 pt-3 border-t border-slate-100">
            <span class="block text-xs font-bold text-slate-500 mb-2">📚 长期任务</span>
            <ul class="space-y-2">
              <li v-for="goal in item.goals" :key="goal.id" class="text-xs">
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="font-bold text-slate-700 font-chinese truncate">{{ goal.title }}</span>
                  <span class="shrink-0 font-bold text-slate-500">
                    {{ goal.mode === 'progress' ? `${goal.done_amount}/${goal.total_amount} ${goal.unit}` : '未完成' }}
                    <span v-if="goal.daily_required" :class="goal.today_logged ? 'text-emerald-600' : 'text-rose-500'">· 今天{{ goal.today_logged ? '已记录' : '未记录' }}</span>
                  </span>
                </div>
                <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-indigo-500" :style="{ width: `${Math.round((goal.done_amount / goal.total_amount) * 100)}%` }"></div>
                </div>
              </li>
            </ul>
          </div>

          <!-- One-off tasks for today and later days -->
          <div class="mt-4 pt-3 border-t border-slate-100">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-slate-500">📌 临时任务</span>
              <button type="button" class="px-3 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold text-xs" @click="openAdhoc(item.child)">
                ➕ 添加
              </button>
            </div>
            <p v-if="!item.adhoc.length" class="text-[11px] text-slate-400">今天及以后没有临时任务，老师临时布置的作业可以加在这里。</p>
            <ul v-else class="space-y-1.5">
              <li v-for="task in item.adhoc" :key="task.id" class="flex items-center gap-2 text-xs">
                <span class="w-12 shrink-0 font-bold" :class="task.date === today ? 'text-orange-600' : 'text-slate-400'">{{ dayLabel(task.date) }}</span>
                <span class="flex-1 truncate font-bold font-chinese" :class="task.is_completed ? 'text-slate-400 line-through' : 'text-slate-700'">{{ task.subject }} · {{ task.title }}</span>
                <span class="text-amber-500 font-black shrink-0">★{{ task.points }}</span>
                <button type="button" class="text-slate-300 hover:text-rose-500 shrink-0" title="删除" @click="removeAdhoc(item, task)">✕</button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>

    <!-- Add One-off Task Modal -->
    <div v-if="adhocForm" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="adhocForm = null">
      <form class="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border-2 border-brand-100 space-y-4" @submit.prevent="saveAdhoc">
        <h3 class="text-xl font-black text-slate-800 font-chinese">➕ 给{{ adhocForm.child.name }}加临时任务</h3>
        <p v-if="adhocError" class="px-3 py-2 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold">{{ adhocError }}</p>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">任务名称</label>
          <input v-model="adhocForm.title" type="text" maxlength="50" required placeholder="例如：订正数学练习、准备手抄报" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-brand-500 outline-none font-chinese" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 mb-1.5">所属学科</label>
          <div class="grid grid-cols-4 gap-2">
            <button v-for="sub in ['语文', '数学', '英语', '其他']" :key="sub" type="button" class="py-2 rounded-xl text-xs font-bold border font-chinese" :class="adhocForm.subject === sub ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-slate-200 text-slate-700'" @click="adhocForm.subject = sub">{{ sub }}</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1.5">哪一天</label>
            <input v-model="adhocForm.date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:border-brand-500" />
            <div class="flex gap-1.5 mt-1.5">
              <button type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600" @click="adhocForm.date = today">今天</button>
              <button type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600" @click="adhocForm.date = addDays(today, 1)">明天</button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 mb-1.5">奖励积分</label>
            <input v-model.number="adhocForm.points" type="number" min="0" max="10000" class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold outline-none focus:border-brand-500" />
          </div>
        </div>
        <TimingFields v-model:track-time="adhocForm.track_time" v-model:expected-minutes="adhocForm.expected_minutes" />
        <div class="flex justify-end gap-3 pt-3 border-t border-slate-100">
          <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100" @click="adhocForm = null">取消</button>
          <button type="submit" :disabled="adhocSaving || !adhocForm.title.trim()" class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">{{ adhocSaving ? '保存中...' : '确认添加' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import TimingFields from '../components/TimingFields.vue';

const childrenStats = ref([]);
const loading = ref(true);
const adhocForm = ref(null);
const adhocSaving = ref(false);
const adhocError = ref('');
const skipRequests = ref([]);
const skipBusy = ref(false);
const skipError = ref('');

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

function dayLabel(date) {
  if (date === today) return '今天';
  if (date === addDays(today, 1)) return '明天';
  return date.slice(5).replace('-', '/');
}

function openAdhoc(child) {
  adhocError.value = '';
  adhocForm.value = { child, title: '', subject: '语文', date: today, points: 10, track_time: false, expected_minutes: null };
}

const activeGoals = goals => goals.filter(goal => goal.status === 'active');

async function refreshChild(item) {
  const [stats, adhoc] = await Promise.all([api.getChildStats(item.child.id), api.getAdhocTasks(item.child.id)]);
  item.stats = stats;
  item.adhoc = adhoc;
}

async function saveAdhoc() {
  adhocSaving.value = true;
  adhocError.value = '';
  try {
    const { child, title, subject, date, points, track_time, expected_minutes } = adhocForm.value;
    await api.createAdhocTask(child.id, { title, subject, date, points: points || 0, track_time, expected_minutes: track_time ? expected_minutes : null });
    await refreshChild(childrenStats.value.find(item => item.child.id === child.id));
    adhocForm.value = null;
  } catch (err) {
    adhocError.value = typeof err === 'string' ? err : '添加失败，请重试';
  } finally {
    adhocSaving.value = false;
  }
}

async function removeAdhoc(item, task) {
  const warning = task.is_completed ? '，孩子因此获得的积分也会扣回' : '';
  if (!confirm(`确定删除临时任务「${task.title}」吗${warning}？`)) return;
  try {
    await api.deleteAdhocTask(task.id);
    await refreshChild(item);
  } catch (err) {
    console.error('Failed to delete one-off task:', err);
  }
}

async function loadSkipRequests() {
  skipRequests.value = await api.getSkipRequests('pending', { limit: 200 });
}

// Approving a skip changes that child's progress for the day, so their card is refreshed too.
async function resolveSkip(request, action) {
  skipBusy.value = true;
  skipError.value = '';
  try {
    await (action === 'approve' ? api.approveSkipRequest(request.id) : api.rejectSkipRequest(request.id));
    const item = childrenStats.value.find(entry => entry.child.id === request.child_id);
    await Promise.all([loadSkipRequests(), item && refreshChild(item)]);
  } catch (err) {
    skipError.value = typeof err === 'string' ? err : '操作失败，请重试';
    await loadSkipRequests().catch(() => {});
  } finally {
    skipBusy.value = false;
  }
}

const overallCompletionRate = computed(() => {
  if (childrenStats.value.length === 0) return 0;
  let totalTasks = 0;
  let completedTasks = 0;
  for (const item of childrenStats.value) {
    totalTasks += (item.stats.today_total_tasks || 0);
    completedTasks += (item.stats.today_completed_tasks || 0);
  }
  if (totalTasks === 0) return 0;
  return Math.round((completedTasks / totalTasks) * 100);
});

function formatRate(rate) {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

const totalPointsIssued = computed(() => {
  return childrenStats.value.reduce((sum, item) => sum + (item.stats.total_points || 0), 0);
});

onMounted(async () => {
  try {
    const children = await api.getChildren();
    const statsPromises = children.map(async (child) => {
      const [stats, week, adhoc, goals] = await Promise.all([api.getChildStats(child.id), api.getWeeklySummary(child.id),
        api.getAdhocTasks(child.id), api.getChildGoals(child.id)]);
      return { child, stats, week, adhoc, goals: activeGoals(goals) };
    });
    [childrenStats.value] = await Promise.all([Promise.all(statsPromises), loadSkipRequests()]);
  } catch (err) {
    console.error('Failed to load parent dashboard:', err);
  } finally {
    loading.value = false;
  }
});
</script>
