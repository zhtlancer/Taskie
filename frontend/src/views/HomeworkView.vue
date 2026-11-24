<template>
  <div data-homework-page class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 p-3 pb-24 sm:p-6 lg:pb-6 select-none">
    <div class="max-w-5xl w-full mx-auto min-w-0">
      <header class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            class="hidden lg:flex w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 items-center justify-center text-xl text-slate-600 dark:text-slate-300 hover:border-brand-300 dark:hover:border-brand-700 shadow-sm active:scale-95 transition-all"
            title="返回今日看板"
            @click="playClick"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
              <span>📒</span>
              <span>作业本</span>
            </h1>
            <p class="text-xs font-bold text-slate-400">每门课布置了什么作业，记下来随时查</p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2.5 whitespace-nowrap">
          <router-link v-if="asParent" :to="{ path: '/parent/recurring-homework', query: { child: childId } }" class="inline-flex items-center min-h-11 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs">管理周期规则</router-link>
          <button
            v-if="asParent"
            type="button"
            class="min-h-11 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs disabled:opacity-50 shadow-sm active:scale-95 transition-all"
            :disabled="!canOpen" @click="openPoints"
          >
            ⚙️ 课程默认积分
          </button>
          <button
            type="button"
            class="min-h-11 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 text-white font-black text-xs disabled:opacity-50 shadow-button active:scale-95 transition-all"
            :disabled="!canOpen" @click="openForm(null)"
          >
            ➕ 记作业
          </button>
        </div>
      </header>

      <!-- The records themselves, or how each course's homework went -->
      <div class="flex flex-wrap gap-2 mb-4" role="group" aria-label="作业显示方式">
        <button
          v-for="option in [{ key: 'list', label: '📋 作业列表' }, { key: 'summary', label: '📊 按课程统计' }]"
          :key="option.key"
          type="button"
          :disabled="busy"
          class="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl text-xs font-bold border disabled:opacity-50"
          :aria-pressed="view === option.key"
          :class="view === option.key ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
          @click="setView(option.key)"
        >
          {{ option.label }}
        </button>
      </div>

      <p v-if="actionError" role="alert" class="mb-3 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ actionError }}</p>

      <p v-if="notice" role="status" class="mb-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
      <PageState v-if="!calendar.ready" kind="loading" title="正在等待确认家庭时区…" description="确认家庭时区后即可读取作业和课程统计。" />
      <PageState v-if="coursesError" kind="error" title="课程信息未能读取" :description="coursesError" :busy="coursesLoading || busy" @retry="loadCourses()" />

      <template v-if="calendar.ready && view === 'list'">
        <!-- Course and status filters, and a search over the content -->
        <div class="bg-white dark:bg-slate-900 rounded-2xl p-3 sm:p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-sm mb-4 space-y-3">
          <div class="flex gap-2 overflow-x-auto whitespace-nowrap -mx-1 px-1" role="group" aria-label="按课程筛选">
            <button
              v-for="option in courseFilters"
              :key="option.key"
              type="button"
              class="shrink-0 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold border font-chinese"
              :aria-pressed="courseFilter === option.key"
              :class="courseFilter === option.key ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
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
              class="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold"
              :aria-pressed="statusFilter === option.key"
              :class="statusFilter === option.key ? 'bg-slate-800 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'"
              @click="statusFilter = option.key"
            >
              {{ option.label }}
            </button>
            <input v-model="search" type="search" placeholder="搜索作业内容" aria-label="搜索作业内容" class="flex-1 basis-40 min-w-0 min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs outline-none focus:border-brand-500 font-chinese" />
          </div>
          <button v-if="rangeFilter" type="button" class="min-h-[44px] px-3 py-1.5 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-xs font-bold" @click="rangeFilter = null">
            📅 只看{{ rangeFilter.label }}布置的 ✕
          </button>
        </div>

        <PageState v-if="loading" kind="loading" title="正在加载作业本…" />
        <PageState v-if="loadError" kind="error" title="作业本未能读取" :description="loadError" :busy="refreshing || busy" @retry="load()" />
        <p v-if="refreshing && dataLoaded" role="status" class="mb-3 text-xs text-slate-500 dark:text-slate-400">正在更新作业，当前显示上次读取的内容。</p>
        <PageState v-if="dataLoaded && !loadError && !refreshing && !shown.length" :title="records.length ? '没有符合条件的作业' : '还没有作业记录'" :description="records.length ? '可以清除课程、状态、搜索和日期筛选后再看看。' : '记下老师布置的作业，随时查看和记录学习进展。'">
          <template #actions>
            <button v-if="hasFilters" type="button" class="ui-button-secondary" @click="clearFilters">清除筛选</button>
            <button v-else type="button" :disabled="!canOpen" class="ui-button-primary" @click="openForm(null)">记第一条作业</button>
          </template>
        </PageState>

        <div v-if="dataLoaded && shown.length" class="space-y-4">
          <section v-for="group in groups" :key="group.date">
            <h3 class="px-1 mb-2 text-xs font-black text-slate-500 dark:text-slate-400">{{ group.date === today ? '今天' : dayName(group.date) }} 布置</h3>
            <ul class="space-y-2">
              <li v-for="record in group.records" :key="record.id" :id="`homework-${record.id}`" :data-homework-record="record.id" class="min-w-0 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-sm scroll-mt-4"
                :class="{ 'ring-2 ring-sky-500': route.hash === `#homework-${record.id}` }" :data-linked="route.hash === `#homework-${record.id}` || undefined">
                <div class="flex flex-wrap items-start gap-2 mb-2">
                  <span class="min-w-0 max-w-full break-words px-2 py-0.5 rounded-lg text-xs font-bold font-chinese" :class="record.course_kind === 'class' ? 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' : 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'">{{ courseLabel(record) }}</span>
                  <PriorityBadge :priority="record.task?.priority ?? record.priority" />
                  <span class="text-xs font-bold" :class="dueClass(record)">{{ dueText(record) }}</span>
                  <span class="ml-auto shrink-0 px-2 py-0.5 rounded-lg text-xs font-black" :class="STATE[record.task_state].class">{{ record.task_state === 'open' && record.study_count ? '进行中' : STATE[record.task_state].label }}</span>
                </div>
                <p class="text-sm font-bold text-slate-700 dark:text-slate-200 whitespace-pre-line break-words font-chinese">{{ record.content || record.recurring_title }}</p>
                <p v-if="record.recurring_title && !record.content" class="text-xs font-bold text-amber-600 dark:text-amber-300 mt-1">待补充内容</p>
                <div class="mt-3 space-y-3 text-xs font-bold">
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-slate-500 dark:text-slate-400">
                  <span>{{ record.recurring_title ? '周期自动生成' : record.auto_lesson_date ? '确认上课后自动生成' : record.created_by === 'child' ? '孩子记录' : '家长记录' }}<template v-if="record.task || record.task_requested"> · ★{{ record.task ? record.task.points : record.points }}</template></span>
                  <span v-if="record.study_running" class="text-indigo-600 dark:text-indigo-300">⏱ 正在计时</span>
                  <span v-if="record.task" class="text-indigo-600 dark:text-indigo-300">已学 {{ record.study_count || 0 }} 次 · 累计 {{ Math.round((record.study_seconds || 0) / 60) }} 分钟</span>
                  <span v-if="record.completion_requested_at && !record.task?.is_completed" class="text-amber-600 dark:text-amber-300">全部完成待家长确认</span>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-slate-700 pt-3">
                  <button v-if="record.task" :disabled="!canAct" type="button" class="min-h-[44px] px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 disabled:opacity-50" @click="openStudy(record)">学习 / 记录</button>
                  <span class="flex-1 hidden sm:block"></span>
                  <template v-if="asParent && record.task_state === 'pending'">
                    <button type="button" :disabled="!canAct" class="min-h-[44px] px-3 py-1.5 rounded-lg bg-emerald-500 text-white disabled:opacity-50" @click="createTask(record)">生成任务</button>
                    <button type="button" :disabled="!canAct" class="min-h-[44px] px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-50" @click="rejectTask(record)">不需要</button>
                  </template>
                  <button v-else-if="asParent && record.can_create_task" type="button" :disabled="!canAct" class="min-h-[44px] px-3 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 disabled:opacity-50" @click="createTask(record)">➕ 生成打卡任务</button>
                  <template v-if="editable(record)">
                    <button type="button" :disabled="!canAct" class="min-h-[44px] px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-50" @click="openForm(record)">修改</button>
                    <button type="button" :disabled="!canAct" class="min-h-[44px] px-3 py-1.5 rounded-lg text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 disabled:opacity-50" @click="openDelete(record)">删除</button>
                  </template>
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </div>
      </template>

      <!-- Per course: how many homework records in the range, and how their tasks went -->
      <template v-else-if="calendar.ready">
        <div class="flex flex-wrap gap-2 mb-3" role="group" aria-label="统计区间">
          <button
            v-for="option in summaryRanges"
            :key="option.key"
            type="button"
            :disabled="busy"
            class="min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-xl text-xs font-bold disabled:opacity-50"
            :aria-pressed="summaryRange === option.key"
            :class="summaryRange === option.key ? 'bg-brand-500 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
            @click="setSummaryRange(option.key)"
          >
            {{ option.label }}
          </button>
        </div>
        <PageState v-if="summaryLoading" kind="loading" title="正在统计作业…" />
        <PageState v-else-if="summaryError" kind="error" title="课程统计未能读取" :description="summaryError" :busy="busy" @retry="loadSummary()" />
        <PageState v-else-if="summary && !summary.courses.length" :title="`${rangeLabel}还没有作业记录`" description="可以切换统计区间，或回到作业列表查看。" />
        <template v-else-if="summary">
          <div data-homework-summary class="mb-3 grid grid-cols-3 gap-2 sm:gap-3 text-center">
            <div class="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              <span class="block text-xs font-bold text-slate-400">{{ rangeLabel }}作业</span>
              <span class="text-2xl font-black text-slate-800 dark:text-slate-100">{{ summary.totals.total }}</span><span class="text-xs font-bold text-slate-500 dark:text-slate-400"> 条</span>
            </div>
            <div class="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              <span class="block text-xs font-bold text-slate-400">已完成</span>
              <span class="text-2xl font-black text-slate-800 dark:text-slate-100">{{ summary.totals.done }}</span><span class="text-xs font-bold text-slate-500 dark:text-slate-400"> 条</span>
            </div>
            <div class="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200/80 dark:border-slate-700/80 shadow-sm">
              <span class="block text-xs font-bold text-slate-400">完成率</span>
              <span class="text-2xl font-black text-slate-800 dark:text-slate-100">{{ formatRate(summary.totals.completion_rate) }}</span>
            </div>
          </div>
          <ul class="space-y-2">
            <li v-for="row in summary.courses" :key="row.course_key">
              <button type="button" class="w-full text-left bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-sm hover:border-brand-300 dark:hover:border-brand-700 active:scale-[0.99] transition-all" @click="openCourse(row)">
                <div class="flex flex-wrap items-start gap-2 mb-2">
                  <span class="min-w-0 max-w-full break-words px-2 py-0.5 rounded-lg text-xs font-bold font-chinese" :class="row.kind === 'class' ? 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' : 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300'">{{ courseLabel(row) }}</span>
                  <span class="text-xs font-bold text-slate-500 dark:text-slate-400">共 {{ row.total }} 条 · 最近 {{ shortDate(row.latest_assigned_date) }}</span>
                  <span class="ml-auto shrink-0 text-right">
                    <span class="text-lg font-black text-slate-800 dark:text-slate-100">{{ formatRate(row.completion_rate) }}</span>
                    <span class="block text-xs font-bold text-slate-400 -mt-0.5">完成率</span>
                  </span>
                </div>
                <div class="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden" role="img" :aria-label="`完成率 ${formatRate(row.completion_rate)}`">
                  <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${Math.round((row.completion_rate ?? 0) * 100)}%` }"></div>
                </div>
                <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span v-for="part in COUNTS.filter(part => row[part.key])" :key="part.key">{{ part.label }} {{ row[part.key] }}</span>
                </div>
              </button>
            </li>
          </ul>
          <p class="mt-3 text-xs font-bold text-slate-400">按布置日期统计。完成率 = 已完成 ÷（已完成 + 没按时完成 + 确认未完成），跳过、还没到截止日期和只记录没生成任务的作业不计入。点某门课可以查看这些作业。</p>
        </template>
      </template>
    </div>

    <HomeworkFormModal
      v-if="form"
      :key="form.key"
      :child-id="childId"
      :courses="courses"
      :as-parent="asParent"
      :record="form.record"
      :today="today"
      @close="form = null"
      @saved="form.saved"
    />

    <!-- Deleting a record with a task: keep the task or delete it too -->
    <UiDialog v-if="deleteTarget" title="删除这条作业记录？" :busy="busy" @close="closeDelete">
      <div class="space-y-4">
        <p v-if="deleteError" role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ deleteError }}</p>
        <p class="text-xs font-bold text-slate-500 dark:text-slate-400 font-chinese whitespace-pre-line line-clamp-3">{{ courseLabel(deleteTarget) }}：{{ deleteTarget.content }}</p>
        <p v-if="deleteTarget.task" class="text-xs font-bold text-amber-600 dark:text-amber-300">它已经生成了打卡任务{{ deleteTarget.task.is_completed ? '，而且已经完成，一起删除会扣回积分' : '' }}。</p>
        <div class="flex flex-col gap-2">
          <button v-if="deleteTarget.task" type="button" :disabled="busy || refreshing" class="min-h-[44px] px-4 py-2.5 rounded-xl bg-rose-500 text-white text-xs font-bold disabled:opacity-50" @click="remove(true)">删除记录和打卡任务</button>
          <button type="button" :disabled="busy || refreshing" class="min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-bold disabled:opacity-50" :class="deleteTarget.task ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200' : 'bg-rose-500 text-white'" @click="remove(false)">
            {{ deleteTarget.task ? '只删除记录，保留任务' : '删除' }}
          </button>
          <button type="button" :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 disabled:opacity-50" @click="closeDelete">取消</button>
        </div>
      </div>
    </UiDialog>

    <!-- Each explicit save preserves its input on failure and blocks overlapping writes. -->
    <UiDialog v-if="pointsOpen" title="⚙️ 课程默认积分" :busy="pointsBusy" @close="closePoints">
      <div class="space-y-4">
        <p class="text-xs leading-relaxed text-slate-500 dark:text-slate-400">每门课单独保存。记作业时自动填写，每条作业还可单独修改；所有孩子通用，未设置时默认 10 分。</p>
        <p v-if="pointsError" role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ pointsError }}</p>
        <p v-if="pointsNotice" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">{{ pointsNotice }}</p>
        <p v-if="!courses.length" class="text-sm text-slate-500 dark:text-slate-400">还没有课程表或课外班。</p>
        <form v-for="course in courses" :key="course.course_key" class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2" @submit.prevent="savePoints(course)">
          <label :for="`points-${course.course_key}`" class="block min-w-0 break-words text-sm font-bold">{{ courseLabel(course) }} 默认积分</label>
          <fieldset :disabled="pointsBusy" class="flex flex-wrap items-center gap-2 min-w-0">
            <input :id="`points-${course.course_key}`" v-model="pointsDrafts[course.course_key]" type="number" min="0" max="10000" step="1" required class="ui-input w-28 max-w-full font-bold text-center" @input="pointsNotice = ''; pointsError = ''" />
            <span class="text-xs text-slate-500 dark:text-slate-400">分</span>
            <button type="submit" :disabled="!pointsDirty(course)" class="ui-button-primary ml-auto">{{ pointsBusy && pointsSavingKey === course.course_key ? '保存中…' : '保存' }}</button>
          </fieldset>
        </form>
        <div class="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-700">
          <button type="button" :disabled="pointsBusy" class="ui-button-secondary" @click="closePoints">完成</button>
        </div>
      </div>
    </UiDialog>

    <HomeworkStudyModal v-if="studyRecord" :key="studyRecord" :record-id="studyRecord" :as-parent="asParent" @close="studyRecord = null" @saved="studySaved" />
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import PriorityBadge from '../components/PriorityBadge.vue';
import { useCalendarStore } from '../stores/calendar';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import api from '../api/client';
import ChildTabBar from '../components/ChildTabBar.vue';
import HomeworkFormModal from '../components/HomeworkFormModal.vue';
import HomeworkStudyModal from '../components/HomeworkStudyModal.vue';
import UiDialog from '../components/UiDialog.vue';
import { playClick } from '../utils/sound';
import { currentRole, getToken, getDataGeneration, hasSession } from '../utils/session.js';
import PageState from '../components/ParentPageState.vue';
import { WEEKDAY_NAMES, addDays, mondayOf, shortDate } from '../utils/schedule.js';
import { courseLabel } from '../utils/homework.js';
const calendar = useCalendarStore();

// What became of a record's task.
const STATE = {
  none: { label: '仅记录', class: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' },
  pending: { label: '等家长确认', class: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  open: { label: '待完成', class: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300' },
  done: { label: '已完成', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  failed: { label: '确认未完成', class: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' },
  skipped: { label: '已跳过', class: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' },
  missed: { label: '没按时完成', class: 'bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300' }
};

// The counts of a course in the summary, in the order shown.
const COUNTS = [
  { key: 'done', label: '已完成' },
  { key: 'failed', label: '确认未完成' },
  { key: 'missed', label: '没按时完成' },
  { key: 'skipped', label: '已跳过' },
  { key: 'open', label: '待完成' },
  { key: 'pending', label: '等家长确认' },
  { key: 'none', label: '仅记录' }
];

const route = useRoute();
const childId = computed(() => route.params.id);
// A parent opening the child's pages records and settles homework as the parent.
const role = ref(currentRole());
const asParent = computed(() => role.value === 'parent');
// Due dates follow the family's calendar and roll over at its midnight, as the board does.
const today = computed(() => calendar.today);
const dayName = date => `${shortDate(date)} ${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]}`;

const records = ref([]), courses = ref([]), dataLoaded = ref(false);
const loading = ref(true), refreshing = ref(false), loadError = ref(''), loadedScope = ref('');
const coursesLoading = ref(false), coursesError = ref(''), coursesScope = ref('');
const form = ref(null), studyRecord = ref(null), deleteTarget = ref(null), deleteError = ref('');
const pointsOpen = ref(false), pointsError = ref(''), pointsNotice = ref(''), pointsDrafts = ref({});
const recordBusy = ref(false), pointsBusy = ref(false), pointsSavingKey = ref('');
const busy = computed(() => recordBusy.value || pointsBusy.value);
const actionError = ref(''), notice = ref('');
const courseFilter = ref('all'), statusFilter = ref('all'), search = ref(''), rangeFilter = ref(null);
const view = ref('list'), summary = ref(null), summaryRange = ref('month'), term = ref(null);
const summaryLoading = ref(false), summaryError = ref('');
const scopeKey = computed(() => `${childId.value}|${today.value}|${calendar.timeZone}`);
const modalOpen = computed(() => Boolean(form.value || studyRecord.value || deleteTarget.value || pointsOpen.value));
const canAct = computed(() => calendar.ready && dataLoaded.value && loadedScope.value === scopeKey.value
  && !refreshing.value && !loadError.value && !busy.value && !modalOpen.value);
const canOpen = computed(() => canAct.value && coursesScope.value === scopeKey.value && !coursesLoading.value && !coursesError.value);
const hasFilters = computed(() => courseFilter.value !== 'all' || statusFilter.value !== 'all' || search.value !== '' || Boolean(rangeFilter.value));
const silent = { silentError: true, preserveError: true };
let alive = true, epoch = 0, loadSerial = 0, coursesSerial = 0, summarySerial = 0;
let listReader, coursesReader, summaryReader, refreshQueued = false, formSerial = 0;
const capture = () => ({ epoch, child: childId.value, token: getToken(), generation: getDataGeneration() });
const current = scope => alive && scope.epoch === epoch && scope.child === childId.value && scope.token === getToken();
const message = error => typeof error === 'string' ? error : error?.message || '操作失败，请重试';
const writeOptions = scope => ({ ...silent, networkErrorMessage: '连接中断，结果尚未确认，请重新读取作业核对后重试。',
  headers: scope.generation ? { 'X-Taskie-Data-Generation': scope.generation } : {} });
function clearFilters() { courseFilter.value = 'all'; statusFilter.value = 'all'; search.value = ''; rangeFilter.value = null; }

const courseFilters = computed(() => {
  const options = [{ key: 'all', label: '全部' }];
  for (const item of [...courses.value, ...records.value]) {
    if (!options.some(option => option.key === item.course_key)) options.push({ key: item.course_key, label: courseLabel(item) });
  }
  return options;
});

const shown = computed(() => {
  const words = search.value.trim();
  return records.value.filter(record => (courseFilter.value === 'all' || record.course_key === courseFilter.value) &&
    (statusFilter.value === 'all' || ['open', 'pending', 'missed'].includes(record.task_state) || (record.task_state === 'none' && record.due_date >= today.value)) &&
    (!words || `${record.content} ${record.recurring_title || ''}`.includes(words)) &&
    (!rangeFilter.value || (record.assigned_date >= rangeFilter.value.from && (!rangeFilter.value.to || record.assigned_date <= rangeFilter.value.to))));
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
  if (record.due_date === today.value) return '今天要完成';
  if (record.due_date === addDays(today.value, 1)) return '明天前完成';
  return `${dayName(record.due_date)}${record.due_date < today.value ? ' 截止' : ' 前完成'}`;
}
const dueClass = record => !record.due_date || record.due_date < today.value ? 'text-slate-400'
  : record.due_date <= addDays(today.value, 1) ? 'text-rose-500 dark:text-rose-400' : 'text-sky-600 dark:text-sky-300';

// A child may change only what they recorded themselves, until it has a task.
const editable = record => asParent.value || (record.created_by === 'child' && !record.task);

// 本周 and 本月 run to today; 本学期 is today's timetable term, once the summary has told it.
const summaryRanges = computed(() => [
  { key: 'week', label: '本周', from: mondayOf(today.value), to: null },
  { key: 'month', label: '本月', from: `${today.value.slice(0, 8)}01`, to: null },
  ...(term.value ? [{ key: 'term', label: '本学期', from: term.value.start_date, to: term.value.end_date }] : []),
  { key: 'all', label: '全部', from: '0000-01-01', to: null }
]);
const currentRange = () => summaryRanges.value.find(option => option.key === summaryRange.value) || summaryRanges.value.find(option => option.key === 'month');
const rangeLabel = computed(() => (summaryRange.value === 'all' ? '' : currentRange().label));
const formatRate = rate => (rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`);

async function loadSummary() {
  if (!calendar.ready || !alive || !getToken()) return;
  if (busy.value) { refreshQueued = true; return; }
  const range = { ...currentRange() }, scope = capture(), key = scopeKey.value, serial = ++summarySerial;
  summaryReader?.abort(); summaryReader = new AbortController();
  const signal = summaryReader.signal;
  summary.value = null; summaryLoading.value = true; summaryError.value = '';
  const matches = () => current(scope) && serial === summarySerial && calendar.ready && key === scopeKey.value
    && JSON.stringify(range) === JSON.stringify(currentRange());
  try {
    const result = await api.getHomeworkSummary(scope.child, { from: range.key === 'all' ? undefined : range.from, to: range.to ?? undefined }, signal, silent);
    if (!matches()) return;
    // A changed timetable must not label the previous term's counts as the current term.
    const updatedTerm = result.term;
    if (range.key === 'term' && (!updatedTerm || updatedTerm.start_date !== range.from || updatedTerm.end_date !== range.to)) {
      term.value = updatedTerm; summaryRange.value = updatedTerm ? 'term' : 'month';
      await loadSummary(); return;
    }
    term.value = updatedTerm;
    summary.value = result;
  } catch (err) {
    if (matches() && !signal.aborted) summaryError.value = message(err);
  } finally { if (serial === summarySerial) summaryLoading.value = false; }
}
function setView(key) {
  if (busy.value) return;
  playClick(); view.value = key;
  if (key === 'summary') loadSummary();
  else { summarySerial++; summaryReader?.abort(); summaryLoading.value = false; }
}
function setSummaryRange(key) { if (!busy.value) { summaryRange.value = key; loadSummary(); } }
function openCourse(row) {
  if (!summary.value || summaryLoading.value || summaryError.value) return;
  playClick(); const range = currentRange();
  courseFilter.value = row.course_key; statusFilter.value = 'all'; search.value = '';
  rangeFilter.value = range.key === 'all' ? null : { from: range.from, to: range.to, label: range.label };
  view.value = 'list';
  load();
}

// List, course information and summary have independent errors and stale-response guards.
async function load({ afterWrite = false } = {}) {
  if (!alive || !calendar.ready || !getToken()) { loading.value = false; return; }
  if (busy.value && !afterWrite) { refreshQueued = true; return; }
  const serial = ++loadSerial, scope = capture(), key = scopeKey.value;
  listReader?.abort(); listReader = new AbortController(); const signal = listReader.signal;
  refreshing.value = true; loading.value = !dataLoaded.value; loadError.value = '';
  const matches = () => current(scope) && serial === loadSerial && calendar.ready && key === scopeKey.value;
  try {
    const list = await api.getHomework(scope.child, {}, signal, silent);
    if (!matches()) return;
    records.value = list; dataLoaded.value = true; loadedScope.value = key;
    if (deleteTarget.value) {
      const fresh = list.find(row => row.id === deleteTarget.value.id);
      if (fresh) deleteTarget.value = fresh;
      else {
        actionError.value = deleteError.value || '这条作业已不在列表中，请核对处理结果。';
        deleteTarget.value = null; deleteError.value = '';
      }
    }
    await nextTick();
    if (matches() && route.hash.startsWith('#homework-')) document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'center' });
  } catch (err) {
    if (matches() && !signal.aborted) loadError.value = dataLoaded.value ? `刷新失败，当前显示上次读取的作业。${message(err)}` : `作业本没有读取成功，这不代表没有作业。${message(err)}`;
  } finally { if (serial === loadSerial) { loading.value = false; refreshing.value = false; } }
}
async function loadCourses() {
  if (!alive || !calendar.ready || !getToken()) return;
  if (busy.value) { refreshQueued = true; return; }
  const serial = ++coursesSerial, scope = capture(), key = scopeKey.value;
  coursesReader?.abort(); coursesReader = new AbortController(); const signal = coursesReader.signal;
  coursesLoading.value = true; coursesError.value = '';
  const matches = () => current(scope) && serial === coursesSerial && calendar.ready && key === scopeKey.value;
  try {
    const list = await api.getHomeworkCourses(scope.child, signal, silent);
    if (matches()) {
      courses.value = list; coursesScope.value = key;
      if (pointsOpen.value) for (const course of list) {
        if (!Object.hasOwn(pointsDrafts.value, course.course_key)) pointsDrafts.value[course.course_key] = String(course.points);
      }
    }
  } catch (err) { if (matches() && !signal.aborted) coursesError.value = message(err); }
  finally { if (serial === coursesSerial) coursesLoading.value = false; }
}
async function refresh({ afterWrite = false } = {}) {
  if (busy.value && !afterWrite) { refreshQueued = true; return; }
  await Promise.all([load({ afterWrite }), ...(afterWrite ? [] : [loadCourses()]), ...(view.value === 'summary' && !busy.value ? [loadSummary()] : [])]);
}
function onResume() {
  if (document.hidden) return;
  const date = today.value; calendar.refreshToday();
  if (date === today.value) refresh();
}
function openForm(record) {
  calendar.refreshToday();
  if (!(record ? canAct.value : canOpen.value) || (record && !editable(record))) return;
  playClick(); actionError.value = ''; notice.value = '';
  const key = ++formSerial;
  form.value = { record, key, scope: capture(), saved: () => onSaved(key) };
}
function openStudy(record) { if (canAct.value && record.task) studyRecord.value = record.id; }
function openDelete(record) {
  if (!canAct.value || !editable(record)) return;
  deleteError.value = ''; actionError.value = ''; notice.value = ''; deleteTarget.value = record;
}
function closeDelete() { if (!busy.value) { deleteTarget.value = null; deleteError.value = ''; } }
async function onSaved(key) {
  if (form.value?.key !== key || !current(form.value.scope)) return;
  form.value = null; notice.value = '作业已保存。'; await refresh();
}
async function studySaved() { await refresh(); }

async function act(work, accept, success, deleting = false) {
  if (busy.value) return;
  const scope = capture(); recordBusy.value = true; actionError.value = ''; deleteError.value = ''; notice.value = '';
  loadSerial++; listReader?.abort(); refreshing.value = false;
  summarySerial++; summaryReader?.abort(); summaryLoading.value = false; summary.value = null;
  try {
    const result = await work(writeOptions(scope));
    if (!current(scope)) return;
    accept(result); notice.value = success;
  } catch (err) {
    if (!current(scope)) return;
    if (deleting) deleteError.value = message(err); else actionError.value = message(err);
  } finally {
    if (current(scope)) await load({ afterWrite: true });
    recordBusy.value = false;
    if (alive && (refreshQueued || scope.epoch !== epoch || loadedScope.value !== scopeKey.value)) { refreshQueued = false; refresh(); }
  }
}
function createTask(record) {
  if (!canAct.value || !asParent.value || !record.can_create_task) return;
  return act(options => api.createHomeworkTask(record.id, {}, options), result => {
    records.value = records.value.map(row => row.id === record.id ? result : row);
  }, '作业任务已生成。');
}
function rejectTask(record) {
  if (!canAct.value || !asParent.value || record.task_state !== 'pending') return;
  return act(options => api.rejectHomeworkTask(record.id, options), result => {
    records.value = records.value.map(row => row.id === record.id ? result : row);
  }, '已处理这条作业申请。');
}
async function remove(withTask) {
  const record = deleteTarget.value;
  if (!record || busy.value || refreshing.value || !editable(record)) return;
  return act(options => api.deleteHomework(record.id, withTask, options), () => {
    records.value = records.value.filter(row => row.id !== record.id); deleteTarget.value = null;
  }, withTask ? '作业记录和打卡任务已删除。' : '作业记录已删除。', true);
}
function openPoints() {
  if (!asParent.value || !canOpen.value) return;
  pointsDrafts.value = Object.fromEntries(courses.value.map(course => [course.course_key, String(course.points)]));
  pointsError.value = ''; pointsNotice.value = ''; pointsOpen.value = true;
}
function closePoints() { if (!pointsBusy.value) pointsOpen.value = false; }
const pointsDirty = course => String(pointsDrafts.value[course.course_key]) !== String(course.points);
async function savePoints(course) {
  if (!asParent.value || !pointsOpen.value || busy.value || !pointsDirty(course)) return;
  const value = String(pointsDrafts.value[course.course_key] ?? '').trim(), points = Number(value);
  pointsError.value = ''; pointsNotice.value = '';
  if (!value || !Number.isInteger(points) || points < 0 || points > 10000) { pointsError.value = '积分须为 0 到 10000 的整数'; return; }
  const scope = capture(), key = course.course_key;
  pointsBusy.value = true; pointsSavingKey.value = key;
  coursesSerial++; coursesReader?.abort(); coursesLoading.value = false;
  try {
    const saved = await api.setHomeworkCoursePoints(key, points, writeOptions(scope));
    if (!current(scope)) return;
    const fresh = courses.value.find(row => row.course_key === key);
    if (fresh) fresh.points = saved.points;
    pointsDrafts.value[key] = String(saved.points); pointsNotice.value = `${courseLabel(course)}的默认积分已保存。`;
  } catch (err) { if (current(scope)) pointsError.value = message(err); }
  finally {
    pointsBusy.value = false; pointsSavingKey.value = '';
    if (alive && (refreshQueued || scope.epoch !== epoch || coursesScope.value !== scopeKey.value)) { refreshQueued = false; refresh(); }
  }
}

function resetScope() {
  epoch++; loadSerial++; coursesSerial++; summarySerial++;
  listReader?.abort(); coursesReader?.abort(); summaryReader?.abort();
  records.value = []; courses.value = []; summary.value = null; term.value = null;
  dataLoaded.value = false; loadedScope.value = ''; coursesScope.value = '';
  loading.value = true; refreshing.value = false; coursesLoading.value = false; summaryLoading.value = false;
  loadError.value = ''; coursesError.value = ''; summaryError.value = ''; actionError.value = ''; notice.value = '';
  deleteError.value = ''; pointsError.value = ''; pointsNotice.value = ''; pointsDrafts.value = {};
  form.value = null; studyRecord.value = null; deleteTarget.value = null; pointsOpen.value = false;
  clearFilters(); summaryRange.value = 'month';
  refresh();
}
function sessionChanged() { role.value = currentRole(); resetScope(); }
const authDestination = to => (!hasSession('parent') && !hasSession('child', childId.value)) || ['/parent/login', '/parent/setup-pin'].includes(to.path);
onBeforeRouteLeave(to => authDestination(to) || (!busy.value && !form.value && !studyRecord.value));
onBeforeRouteUpdate(to => to.params.id === childId.value || authDestination(to) || (!busy.value && !modalOpen.value));
watch(childId, resetScope, { flush: 'sync' });
watch(() => [calendar.today, calendar.ready, calendar.timeZone], () => {
  if (term.value && (today.value < term.value.start_date || today.value > term.value.end_date)) { term.value = null; summaryRange.value = 'month'; }
  refresh();
});
onMounted(() => {
  document.addEventListener('visibilitychange', onResume); window.addEventListener('pageshow', onResume);
  window.addEventListener('taskie:data-restored', resetScope); window.addEventListener('taskie:session-changed', sessionChanged);
  refresh();
});
onUnmounted(() => {
  alive = false; epoch++; loadSerial++; coursesSerial++; summarySerial++;
  listReader?.abort(); coursesReader?.abort(); summaryReader?.abort();
  document.removeEventListener('visibilitychange', onResume); window.removeEventListener('pageshow', onResume);
  window.removeEventListener('taskie:data-restored', resetScope); window.removeEventListener('taskie:session-changed', sessionChanged);
});
</script>
