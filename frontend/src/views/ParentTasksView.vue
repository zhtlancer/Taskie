<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <!-- Title & Actions Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6 [&>*:last-child]:whitespace-nowrap">
        <div>
          <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <span>📝</span>
            <span>任务模板管理</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            配置固定星期重复或每周频次目标任务，系统自动生成每日任务实例
          </p>
        </div>

        <div class="flex items-center gap-2">
          <router-link to="/parent/periods" class="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
            🏖️ 假期与长期任务
          </router-link>
          <button
            type="button"
            @click="openAddModal"
            class="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs shadow-button active:scale-95 transition-all"
          >
            <span>➕</span>
            <span>新增任务模板</span>
          </button>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="text-center py-20 text-brand-500 dark:text-brand-400 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在加载任务模板...
      </div>

      <!-- Empty State -->
      <div v-else-if="templates.length === 0" class="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700">
        <div class="text-5xl mb-3">📝</div>
        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">暂无任务模板</h3>
        <p class="text-xs text-slate-400 mb-6">点击右上角“新增任务模板”为孩子们配置日常作业吧</p>
      </div>

      <!-- Templates Grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="tmpl in templates"
          :key="tmpl.id"
          class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card flex flex-col justify-between hover:shadow-card-hover transition-all"
        >
          <div>
            <!-- Top Subject & Points -->
            <div class="flex items-center justify-between mb-3">
              <span
                class="px-2.5 py-1 rounded-xl text-xs font-black font-chinese"
                :class="subjectClass(tmpl.subject)"
              >
                {{ tmpl.subject }}
              </span>

              <PriorityBadge :priority="tmpl.priority" />
              <span class="text-sm font-black text-amber-500 dark:text-amber-400 flex items-center gap-1">
                <span>★</span>
                <span>{{ tmpl.points }} 积分</span>
              </span>
            </div>

            <!-- Title with child-friendly Chinese typography -->
            <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-3 font-chinese">
              {{ tmpl.title }}
            </h3>
            <div v-if="tmpl.track_time || tmpl.carry_over" class="-mt-2 mb-3 flex flex-wrap gap-x-3 text-xs font-bold">
              <span v-if="tmpl.track_time" class="text-violet-600 dark:text-violet-300">⏱ 记录用时{{ tmpl.expected_minutes ? ` · 预计 ${tmpl.expected_minutes} 分钟` : '' }}</span>
              <span v-if="tmpl.carry_over" class="text-sky-600 dark:text-sky-300">🏖️ 放假前的可在假期补完</span>
            </div>

            <!-- Schedule Type / Cycle Display -->
            <div class="mb-4">
              <!-- Weekly Target Frequency Task -->
              <div v-if="tmpl.schedule_type === 'weekly_times'">
                <span class="text-xs font-bold text-slate-400 block mb-1.5">任务频次：</span>
                <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/80 text-indigo-700 dark:text-indigo-300 text-xs font-black">
                  <span>🎯</span>
                  <span>每周完成特定次数：每周 {{ tmpl.weekly_target_times || 3 }} 次</span>
                  <span v-if="tmpl.allow_extra" class="block text-violet-600 dark:text-violet-300 text-xs">可额外完成 · {{ tmpl.extra_points && tmpl.extra_reward_limit ? `额外每次 +${tmpl.extra_points} 分，每周奖励最多 ${tmpl.extra_reward_limit} 次` : '额外不加分' }}</span>
                </div>
                <div v-if="Array.isArray(tmpl.days_of_week) && tmpl.days_of_week.length < 7" class="mt-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
                  仅限 {{ [1, 2, 3, 4, 5, 6, 0].filter(day => tmpl.days_of_week.includes(day)).map(day => dayNames[day]).join('、') }} 完成
                </div>
              </div>

              <p v-else class="text-sm font-bold text-slate-600 dark:text-slate-300">{{ scheduleLabel(tmpl.days_of_week) }}</p>
            </div>

            <!-- Assigned Children -->
            <div class="mb-4">
              <span class="text-xs font-bold text-slate-400 block mb-1.5">适用孩子：</span>
              <div class="flex flex-wrap gap-1">
                <span
                  v-if="tmpl.child_ids === null || tmpl.child_ids === undefined"
                  class="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold"
                >
                  👨‍👩‍👧 全部孩子
                </span>
                <span
                  v-else-if="assignedChildren(tmpl).length === 0"
                  class="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold"
                >
                  ⚠️ 未分配，不会生成任务
                </span>
                <span
                  v-for="child in assignedChildren(tmpl)"
                  v-else
                  :key="child.id"
                  class="px-2.5 py-1 rounded-lg bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-bold font-chinese"
                >
                  {{ child.avatar_emoji }} {{ child.name }}
                </span>
              </div>
            </div>
          </div>

          <!-- Actions Footer -->
          <div class="pt-3 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <button
              type="button"
              @click="openEditModal(tmpl)"
              class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
            >
              ✏️ 编辑模板
            </button>

            <button
              type="button"
              @click="handleDelete(tmpl.id)"
              class="px-3 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-bold text-xs transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- Add/Edit Template Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in"
      @click.self="showModal = false"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border-2 border-brand-100 dark:border-brand-800">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>{{ isEditing ? '✏️ 编辑任务模板' : '➕ 新增任务模板' }}</span>
          </h3>
          <button
            type="button"
            @click="showModal = false"
            class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold text-lg"
          >
            ✕
          </button>
        </div>

        <form @submit.prevent="submitTemplateForm" class="space-y-4">
          <!-- Title Input -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">任务名称</label>
            <input
              v-model="form.title"
              type="text"
              required
              placeholder="例如：课外阅读20页、跳绳300个、数学计算练习"
              class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none font-chinese"
            />
          </div>

          <!-- Subject Select -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">所属学科</label>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="sub in ['语文', '数学', '英语', '其他']"
                :key="sub"
                type="button"
                @click="form.subject = sub"
                class="py-2 rounded-xl text-xs font-bold border transition-all font-chinese"
                :class="[
                  form.subject === sub
                    ? 'bg-brand-500 border-brand-500 text-white shadow-button'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                ]"
              >
                {{ sub }}
              </button>
            </div>
          </div>

          <PriorityFields v-model="form.priority" />

          <!-- Assigned Children -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">适用孩子</label>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                @click="form.child_ids = null"
                class="px-3 py-2 rounded-xl text-xs font-bold border transition-all"
                :class="[
                  form.child_ids === null
                    ? 'bg-brand-500 border-brand-500 text-white shadow-button'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                ]"
              >
                👨‍👩‍👧 全部孩子
              </button>
              <button
                v-for="child in children"
                :key="child.id"
                type="button"
                @click="toggleChild(child.id)"
                class="px-3 py-2 rounded-xl text-xs font-bold border transition-all font-chinese"
                :class="[
                  form.child_ids?.includes(child.id)
                    ? 'bg-brand-500 border-brand-500 text-white shadow-button'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                ]"
              >
                {{ child.avatar_emoji }} {{ child.name }}
              </button>
            </div>
            <p v-if="form.child_ids?.length === 0" class="text-xs text-rose-500 dark:text-rose-400 font-bold mt-1.5">请至少选择一个孩子</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-1.5">分配变更立即作用于未完成的今日任务，已完成任务和历史记录保留。</p>
          </div>

          <!-- Repeat Cycle Type (按固定星期重复 VS 每周完成特定次数) -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">周期重复规则</label>
            <div class="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
              <button
                type="button"
                @click="form.schedule_type = 'fixed_days'"
                class="py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                :class="[
                  form.schedule_type === 'fixed_days'
                    ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-300 shadow-sm font-black'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
                ]"
              >
                <span>🗓️ 按固定星期重复</span>
              </button>
              <button
                type="button"
                @click="selectWeeklyTimes"
                class="py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                :class="[
                  form.schedule_type === 'weekly_times'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-300 shadow-sm font-black'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'
                ]"
              >
                <span>🎯 每周完成特定次数</span>
              </button>
            </div>
          </div>

          <!-- Mode A: Weekly Target Frequency Selector -->
          <div v-if="form.schedule_type === 'weekly_times'" class="bg-indigo-50/60 dark:bg-indigo-950/40 p-3 rounded-2xl border border-indigo-100 dark:border-indigo-800">
            <div class="flex items-center justify-between mb-2">
              <label class="text-xs font-bold text-indigo-900 dark:text-indigo-200">每周目标完成次数</label>
              <span class="text-xs text-indigo-600 dark:text-indigo-300 font-medium">孩子每周自主规划天数</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                v-for="times in [1, 2, 3, 4, 5]"
                :key="times"
                type="button"
                :disabled="times > form.days_of_week.length"
                @click="form.weekly_target_times = times"
                class="px-3 py-1.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-40"
                :class="[
                  form.weekly_target_times === times
                    ? 'bg-indigo-600 border-indigo-600 text-white font-black shadow-sm'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                ]"
              >
                每周 {{ times }} 次
              </button>
              <div class="flex items-center gap-1 ml-auto">
                <span class="text-xs text-slate-500 dark:text-slate-400 font-bold">自定义:</span>
                <input
                  v-model.number="form.weekly_target_times"
                  type="number"
                  min="1"
                  max="7"
                  class="w-14 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-center focus:border-indigo-500 outline-none bg-white dark:bg-slate-900"
                />
              </div>
            </div>
          </div>

          <div v-if="form.schedule_type === 'weekly_times'" class="p-3 rounded-2xl border border-violet-100 dark:border-violet-800 space-y-3">
            <label class="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
              <input v-model="form.allow_extra" type="checkbox" class="w-4 h-4 accent-violet-500" /> 达标后允许额外完成
            </label>
            <template v-if="form.allow_extra">
              <p class="text-xs text-slate-500 dark:text-slate-400">每天最多一次。达标后进入自愿的“额外挑战”，不影响完成率、全勤和连续打卡。</p>
              <div class="flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
                <label>额外每次奖励 <input v-model.number="form.extra_points" type="number" min="0" max="10000" required class="w-20 border rounded-lg p-2" /> 分</label>
                <label>每周最多奖励 <input v-model.number="form.extra_reward_limit" type="number" min="0" max="7" required class="w-16 border rounded-lg p-2" /> 次</label>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400">任一项为 0 则额外完成不加分；超过奖励次数仍可记录。修改后作用于今天起未完成的任务，历史记录和已得积分保留。</p>
            </template>
          </div>

          <!-- Days of Week: when a fixed task repeats, or which days a weekly task may be done -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="text-xs font-bold text-slate-600 dark:text-slate-300">
                {{ form.schedule_type === 'weekly_times' ? '可在哪几天完成' : '适用星期' }}
              </label>
              <div class="flex gap-2">
                <button
                  type="button"
                  @click="setWeekPreset('workdays')"
                  class="text-xs text-brand-600 dark:text-brand-300 font-bold hover:underline"
                >
                  工作日
                </button>
                <span class="text-slate-300">|</span>
                <button
                  type="button"
                  @click="setWeekPreset('weekend')"
                  class="text-xs text-brand-600 dark:text-brand-300 font-bold hover:underline"
                >
                  周末
                </button>
                <span class="text-slate-300">|</span>
                <button
                  type="button"
                  @click="setWeekPreset('everyday')"
                  class="text-xs text-brand-600 dark:text-brand-300 font-bold hover:underline"
                >
                  每天
                </button>
              </div>
            </div>

            <div class="grid grid-cols-7 gap-1.5 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-2xl border border-slate-100 dark:border-slate-700">
              <button
                v-for="(day, idx) in [1, 2, 3, 4, 5, 6, 0]"
                :key="day"
                type="button"
                @click="toggleDay(day)"
                class="h-10 rounded-xl text-xs font-bold flex flex-col items-center justify-center transition-all"
                :class="[
                  form.days_of_week.includes(day)
                    ? 'bg-brand-500 text-white shadow-button scale-105'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                ]"
              >
                <span>{{ dayNames[day] }}</span>
              </button>
            </div>
          </div>

          <!-- Points Input -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">单次完成奖励积分</label>
            <div class="flex items-center gap-2">
              <button
                v-for="pts in [5, 10, 15, 20]"
                :key="pts"
                type="button"
                @click="form.points = pts"
                class="px-3.5 py-1.5 rounded-xl text-xs font-bold border transition-all"
                :class="[
                  form.points === pts
                    ? 'bg-amber-400 border-amber-400 text-amber-950 font-black shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                ]"
              >
                ★ {{ pts }}分
              </button>
              <input
                v-model.number="form.points"
                type="number"
                min="1"
                class="w-20 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-center focus:border-brand-500 outline-none"
              />
            </div>
          </div>

          <details class="rounded-xl border border-slate-200 dark:border-slate-700 p-3" :open="isEditing && (form.track_time || form.carry_over)">
            <summary class="cursor-pointer min-h-[44px] py-3 text-sm font-bold text-slate-600 dark:text-slate-300">更多设置 · 计时与假期补完</summary>
            <div class="space-y-3">
          <!-- Tasks of the last school day before a weekend or holiday may wait until it ends -->
          <label v-if="form.schedule_type === 'fixed_days'" class="flex items-start gap-2 px-3 py-2.5 rounded-2xl border border-sky-100 dark:border-sky-800 bg-sky-50/40 dark:bg-sky-950/40 cursor-pointer">
            <input v-model="form.carry_over" type="checkbox" class="mt-0.5 w-4 h-4 accent-sky-500" />
            <span>
              <span class="block text-xs font-bold text-slate-700 dark:text-slate-200">🏖️ 放假前一天的可以在假期里补完</span>
              <span class="block text-xs font-bold text-slate-400">周五的可以周末补，节假日前的可以在假期里补，假期最后一天前完成就行；像“学校记事”这样当天要交的不要勾</span>
            </span>
          </label>

          <TimingFields v-model:track-time="form.track_time" v-model:expected-minutes="form.expected_minutes" />

            </div>
          </details>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              @click="showModal = false"
              class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="submitting || !form.title.trim() || form.child_ids?.length === 0 || form.days_of_week.length === 0 || (form.schedule_type === 'weekly_times' && form.weekly_target_times > form.days_of_week.length)"
              class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50 transition-all"
            >
              {{ submitting ? '保存中...' : '确认保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
const scheduleLabel = days => {
  const list = Array.isArray(days) ? days : [1,2,3,4,5];
  if (list.length === 7) return '每天';
  if (list.length === 5 && [1,2,3,4,5].every(day => list.includes(day))) return '工作日';
  if (list.length === 2 && [0,6].every(day => list.includes(day))) return '周末';
  return [1,2,3,4,5,6,0].filter(day => list.includes(day)).map(day => ['周日','周一','周二','周三','周四','周五','周六'][day]).join('、');
};
import { confirmAction } from '../utils/confirmation';
import { ref, onMounted } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import TimingFields from '../components/TimingFields.vue';
import PriorityFields from '../components/PriorityFields.vue';
import PriorityBadge from '../components/PriorityBadge.vue';

const templates = ref([]);
const children = ref([]);
const loading = ref(true);

const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const submitting = ref(false);

const dayNames = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  0: '周日'
};

const form = ref({
  title: '',
  subject: '语文',
  schedule_type: 'fixed_days',
  weekly_target_times: 3,
  allow_extra: false,
  extra_points: 0,
  extra_reward_limit: 0,
  points: 10,
  priority: 1,
  days_of_week: [1, 2, 3, 4, 5],
  child_ids: null,
  track_time: false,
  expected_minutes: null,
  carry_over: false
});

onMounted(async () => {
  await loadTemplates();
});

async function loadTemplates() {
  loading.value = true;
  try {
    [templates.value, children.value] = await Promise.all([api.getTaskTemplates(), api.getChildren()]);
  } catch (err) {
    console.error('Failed to load templates:', err);
  } finally {
    loading.value = false;
  }
}

function isDayActive(days, day) {
  if (!Array.isArray(days)) return false;
  return days.includes(day);
}

function subjectClass(sub) {
  switch (sub) {
    case '语文': return 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300';
    case '数学': return 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300';
    case '英语': return 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300';
    default: return 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200';
  }
}

function assignedChildren(tmpl) {
  return children.value.filter(child => tmpl.child_ids?.includes(child.id));
}

function toggleChild(id) {
  const ids = form.value.child_ids || [];
  form.value.child_ids = ids.includes(id) ? ids.filter(childId => childId !== id) : [...ids, id];
}

function toggleDay(day) {
  const idx = form.value.days_of_week.indexOf(day);
  if (idx > -1) {
    form.value.days_of_week.splice(idx, 1);
  } else {
    form.value.days_of_week.push(day);
  }
}

// New weekly tasks may be done any day unless the parent narrows it (e.g. to the weekend).
function selectWeeklyTimes() {
  if (form.value.schedule_type !== 'weekly_times' && !isEditing.value) form.value.days_of_week = [0, 1, 2, 3, 4, 5, 6];
  form.value.schedule_type = 'weekly_times';
}

function setWeekPreset(type) {
  if (type === 'workdays') {
    form.value.days_of_week = [1, 2, 3, 4, 5];
  } else if (type === 'weekend') {
    form.value.days_of_week = [6, 0];
  } else if (type === 'everyday') {
    form.value.days_of_week = [0, 1, 2, 3, 4, 5, 6];
  }
}

function openAddModal() {
  isEditing.value = false;
  editingId.value = null;
  form.value = {
    title: '',
    subject: '语文',
    schedule_type: 'fixed_days',
    weekly_target_times: 3,
    allow_extra: false,
    extra_points: 0,
    extra_reward_limit: 0,
    points: 10,
    priority: 1,
    days_of_week: [1, 2, 3, 4, 5],
    child_ids: null,
    track_time: false,
    expected_minutes: null,
    carry_over: false
  };
  showModal.value = true;
}

function openEditModal(tmpl) {
  isEditing.value = true;
  editingId.value = tmpl.id;
  form.value = {
    title: tmpl.title,
    subject: tmpl.subject,
    schedule_type: tmpl.schedule_type || 'fixed_days',
    weekly_target_times: tmpl.weekly_target_times || 3,
    allow_extra: Boolean(tmpl.allow_extra),
    extra_points: tmpl.extra_points ?? 0,
    extra_reward_limit: tmpl.extra_reward_limit ?? 0,
    points: tmpl.points,
    priority: tmpl.priority ?? 1,
    days_of_week: Array.isArray(tmpl.days_of_week) ? [...tmpl.days_of_week] : [1, 2, 3, 4, 5],
    // Drop children deleted since the template was assigned.
    child_ids: Array.isArray(tmpl.child_ids) ? assignedChildren(tmpl).map(child => child.id) : null,
    track_time: Boolean(tmpl.track_time),
    expected_minutes: tmpl.expected_minutes ?? null,
    carry_over: Boolean(tmpl.carry_over)
  };
  showModal.value = true;
}

async function submitTemplateForm() {
  if (!form.value.title.trim()) return;
  submitting.value = true;
  try {
    const payload = {
      title: form.value.title.trim(),
      subject: form.value.subject,
      schedule_type: form.value.schedule_type,
      weekly_target_times: form.value.schedule_type === 'weekly_times' ? (Number(form.value.weekly_target_times) || 3) : null,
      allow_extra: form.value.schedule_type === 'weekly_times' && form.value.allow_extra,
      extra_points: form.value.extra_points,
      extra_reward_limit: form.value.extra_reward_limit,
      points: form.value.points,
      priority: form.value.priority,
      days_of_week: form.value.days_of_week,
      child_ids: form.value.child_ids,
      track_time: form.value.track_time,
      expected_minutes: form.value.track_time ? form.value.expected_minutes : null,
      carry_over: form.value.schedule_type === 'fixed_days' && form.value.carry_over
    };

    if (isEditing.value) {
      await api.updateTaskTemplate(editingId.value, payload);
    } else {
      await api.createTaskTemplate(payload);
    }
    showModal.value = false;
    await loadTemplates();
  } catch (err) {
    console.error('Failed to save template:', err);
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id) {
  if (!await confirmAction('确定要删除该任务模板吗？已生成的历史任务不受影响。')) return;
  try {
    await api.deleteTaskTemplate(id);
    await loadTemplates();
  } catch (err) {
    console.error('Failed to delete template:', err);
  }
}
</script>
