<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <ParentPageHeader icon="📊" title="今日作业完成概览" description="查看所有孩子的任务进展，处理作业与跳过申请。">
        <template #actions>
          <button type="button" :disabled="refreshing || actionLocked || !calendar.ready" class="ui-button-secondary" @click="loadDashboard()">{{ refreshing ? '刷新中…' : '刷新总览' }}</button>
          <router-link to="/parent/time-stats" class="ui-button-secondary inline-flex items-center">⏱ 用时统计</router-link>
          <router-link to="/parent/tasks" class="ui-button-primary inline-flex items-center">📝 学习安排</router-link>
        </template>
      </ParentPageHeader>

      <p v-if="notice" role="status" class="mb-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
      <p v-if="actionError" role="alert" class="mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ actionError }}</p>
      <ParentPageState v-if="dashboardError" kind="error" :title="dashboardLoaded ? '总览刷新失败' : '总览未能读取'" :description="dashboardError" :busy="refreshing || actionLocked" @retry="loadDashboard()" />
      <ParentPageState v-if="!calendar.ready" kind="loading" title="正在等待确认家庭时区…" description="请使用顶部的“重新读取家庭时区”入口，确认后即可查看孩子的进展。" />
      <ParentPageState v-else-if="loading" kind="loading" title="正在统计今日作业进展…" />
      <template v-if="calendar.ready && dashboardLoaded">
      <p v-if="refreshing" role="status" class="mb-4 text-xs text-slate-500 dark:text-slate-400">正在刷新，当前显示上次读取的数据。</p>
      <p v-else-if="loadedDate !== today" role="status" class="mb-4 text-sm text-amber-700 dark:text-amber-300">当前显示 {{ loadedDate }} 的进展，请重新读取今日数据后操作。</p>

      <!-- Children's requests to skip a task, waiting for a parent -->
      <section v-if="skipRequests.length" class="mb-4 bg-white dark:bg-slate-900 rounded-2xl p-4 border-2 border-amber-200 dark:border-amber-800 shadow-card">
        <h3 class="text-base font-bold text-slate-700 dark:text-slate-200 mb-3 flex flex-wrap items-center gap-2">
          <span>🙋</span>
          <span>跳过任务申请</span>
          <span class="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-xs">{{ skipRequests.length }}</span>
        </h3>
        <ul class="space-y-2">
          <li v-for="r in skipRequests" :key="r.id" class="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-2xl">{{ r.child_avatar_emoji }}</span>
            <div class="flex-1 basis-48 min-w-0 break-words">
              <div class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese">
                {{ r.child_name }} · {{ dayLabel(r.task_date) }} · {{ r.task_subject }} · {{ r.task_title }}
              </div>
              <div class="text-xs font-bold text-amber-700 dark:text-amber-300 font-chinese">理由：{{ r.reason }}</div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" :disabled="!canMutate" class="min-h-11 min-w-11 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50" @click="resolveSkip(r, 'approve')">同意跳过</button>
              <button type="button" :disabled="!canMutate" class="min-h-11 min-w-11 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold disabled:opacity-50" @click="resolveSkip(r, 'reject')">不同意</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Homework children recorded, waiting for a parent to create its task -->
      <section v-if="homeworkRequests.length" class="mb-4 bg-white dark:bg-slate-900 rounded-2xl p-4 border-2 border-orange-200 dark:border-orange-800 shadow-card">
        <h3 class="text-base font-bold text-slate-700 dark:text-slate-200 mb-3 flex flex-wrap items-center gap-2">
          <span>📒</span>
          <span>孩子记的作业，等你确认生成任务</span>
          <span class="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-xs">{{ homeworkRequests.length }}</span>
        </h3>
        <ul class="space-y-2">
          <li v-for="r in homeworkRequests" :key="r.id" class="p-3 rounded-2xl bg-orange-50/60 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-800 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-2xl">{{ r.child_avatar_emoji }}</span>
            <div class="flex-1 basis-48 min-w-0 break-words">
              <div class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese">{{ r.child_name }} · {{ courseLabel(r) }} · {{ dayLabel(r.assigned_date) }}布置</div>
              <div class="text-xs font-bold text-slate-600 dark:text-slate-300 font-chinese whitespace-pre-line line-clamp-2">{{ r.content }}</div>
              <div class="text-xs font-bold text-orange-700 dark:text-orange-300">{{ r.due_date ? `截止 ${dayLabel(r.due_date)}` : '没有截止日期' }} · ★{{ r.points }}</div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" :disabled="!canMutate || !r.can_create_task" class="min-h-11 min-w-11 px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50" @click="resolveHomework(r, 'create')">生成任务</button>
              <button type="button" :disabled="!canMutate" class="min-h-11 min-w-11 px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold disabled:opacity-50" @click="resolveHomework(r, 'reject')">不需要</button>
              <router-link :to="`/child/${r.child_id}/homework`" class="inline-flex items-center min-h-11 min-w-11 px-3 py-2 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">改积分</router-link>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="completionRequests.length" class="mb-6 bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-800 p-4 space-y-3">
        <h3 class="font-bold text-slate-800 dark:text-slate-100">📒 超期作业全部完成申请</h3>
        <div v-for="record in completionRequests" :key="record.id" class="rounded-2xl border border-amber-100 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/40 p-3 space-y-2 text-sm">
          <p class="min-w-0 break-words text-slate-700 dark:text-slate-200">{{ record.child_name }} · {{ courseLabel(record) }}：{{ record.content }}</p>
          <div class="flex flex-wrap items-center gap-2">
          <button :disabled="!canMutate" type="button" class="min-h-11 min-w-11 bg-emerald-600 text-white rounded-xl px-3 py-2 disabled:opacity-50" @click="resolveCompletion(record, true)">确认完成</button>
          <button :disabled="!canMutate" type="button" class="ui-button-secondary" @click="resolveCompletion(record, false)">暂不确认</button>
          <router-link :to="`/child/${record.child_id}/homework`" class="inline-flex items-center min-h-11 px-3 text-indigo-600 dark:text-indigo-300">查看学习记录</router-link>
          </div>
        </div>
      </section>
      <div class="grid grid-cols-3 gap-2 mb-5" aria-label="今日摘要">
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3"><p class="text-xs text-slate-500 dark:text-slate-400">小朋友</p><p class="text-xl font-black text-slate-800 dark:text-slate-100">{{ childrenStats.length }} <span class="text-xs">位</span></p></div>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3"><p class="text-xs text-slate-500 dark:text-slate-400">今日完成</p><p class="text-xl font-black text-emerald-600 dark:text-emerald-300">{{ overallCompletionRate }}%</p></div>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3"><p class="text-xs text-slate-500 dark:text-slate-400">累计积分</p><p class="text-xl font-black text-amber-600 dark:text-amber-300">{{ totalPointsIssued }}</p></div>
      </div>
      <h3 v-if="childrenStats.length" class="text-base font-bold text-slate-700 dark:text-slate-200 mb-3">各个小朋友实时看板</h3>
      <ParentPageState v-if="!childrenStats.length" title="还没有添加小朋友账号哦" description="先添加孩子，再安排任务和查看每天的进展。">
        <template #actions><router-link to="/parent/children" class="ui-button-primary inline-flex items-center">立即添加小朋友</router-link></template>
      </ParentPageState>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div
          v-for="item in childrenStats"
          :key="item.child.id"
          :data-child-summary="item.child.id"
          class="min-w-0 break-words bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card hover:shadow-card-hover transition-all"
        >
          <!-- Top Row: Avatar, Name, Link -->
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div class="flex items-center gap-3 min-w-0 max-w-full">
              <div class="w-12 h-12 sm:w-16 sm:h-16 shrink-0 rounded-2xl bg-brand-50 dark:bg-brand-900/40 flex items-center justify-center text-3xl shadow-inner">
                {{ item.child.avatar_emoji || '🐱' }}
              </div>
              <div class="min-w-0">
                <h4 class="break-words text-xl font-bold text-slate-800 dark:text-slate-100">{{ item.child.name }}</h4>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 whitespace-nowrap">
                  <span class="text-xs text-amber-600 dark:text-amber-300 font-extrabold flex items-center gap-0.5">
                    <span>🔥</span>
                    <span>连续 {{ item.stats.current_streak || 0 }} 天</span>
                  </span>
                  <span class="text-slate-300">·</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400 font-bold">
                    今日积分 {{ (item.stats.today_points || 0) >= 0 ? '+' : '' }}{{ item.stats.today_points || 0 }}
                  </span>
                </div>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <router-link :to="`/child/${item.child.id}/homework`" class="inline-flex items-center min-h-[44px] px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 text-xs font-bold">作业本</router-link>
              <router-link :to="`/parent/children/${item.child.id}/backfill`" class="inline-flex items-center min-h-[44px] px-3 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-xs font-bold">补卡</router-link>
              <router-link
                :to="`/child/${item.child.id}/today`"
                class="inline-flex items-center min-h-[44px] px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 text-xs font-bold transition-all"
              >
                进入看板 →
              </router-link>
            </div>
          </div>

          <!-- The child's current timer, running or paused; opens it on the child's board -->
          <router-link
            v-if="item.timer"
            data-child-timer
            :to="{ path: `/child/${item.child.id}/today`, query: timerTarget(item.timer) }"
            class="flex items-center gap-2 min-h-[44px] mb-4 px-3 py-2 rounded-2xl text-sm font-bold"
            :class="timerTone(item.timer)"
          >
            <span v-if="item.timer.timer_running" class="shrink-0 w-2 h-2 rounded-full bg-current motion-safe:animate-pulse"></span>
            <span class="shrink-0">{{ !item.timer.timer_running ? '⏸ 已暂停' : timerSeconds(item.timer) > LONG_TIMER_SECONDS ? '计时很久了' : '计时中' }}</span>
            <span class="min-w-0 flex-1 truncate font-chinese">{{ item.timer.subject }} · {{ item.timer.title }}</span>
            <span class="shrink-0 font-black tabular-nums">{{ formatClock(timerSeconds(item.timer)) }}</span>
          </router-link>

          <router-link v-if="item.classOverview?.count" data-class-overview :to="{ path: '/parent/schedule', query: { child: item.child.id } }"
            class="block min-h-[44px] mb-4 px-3 py-2 rounded-2xl bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 text-xs font-bold">
            <span class="block">课外班 {{ item.classOverview.count }} 门 · 已上 {{ item.classOverview.attended }} 次 · 待确认 {{ item.classOverview.pending }} 次</span>
            <span v-if="item.classOverview.next" class="block mt-1">下次 {{ item.classOverview.next.actual_date }} {{ item.classOverview.next.start_time }} · {{ item.classOverview.next.title }}</span>
          </router-link>

          <div v-if="item.unavailable.length" role="status" data-partial-error class="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200">
            <p v-for="label in item.unavailable" :key="label">{{ label }}暂不可用</p>
            <button type="button" :disabled="refreshing || actionLocked" class="min-h-11 min-w-11 mt-1 px-3 rounded-xl bg-white dark:bg-slate-900 font-bold disabled:opacity-50" @click="loadDashboard()">重新读取摘要</button>
          </div>

          <!-- Progress Bar & Count -->
          <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 mb-4">
            <div class="flex flex-wrap items-center justify-between gap-2 text-xs font-bold mb-1.5">
              <span class="text-slate-500 dark:text-slate-400">今日完成情况</span>
              <span class="text-slate-800 dark:text-slate-100">
                完成 {{ item.stats.today_completed_tasks || 0 }} / {{ item.stats.today_total_tasks || 0 }} 项
                ({{ Math.round((item.stats.today_completion_rate || 0) * 100) }}%)
                <span v-if="item.stats.today_skipped_tasks" class="text-slate-400">· 跳过 {{ item.stats.today_skipped_tasks }} 项</span>
              </span>
            </div>

            <div class="w-full bg-slate-200 dark:bg-slate-700 h-3 rounded-full overflow-hidden p-0.5">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="item.stats.today_completion_rate >= 1 ? 'bg-emerald-500' : 'bg-brand-500'"
                :style="{ width: `${Math.round((item.stats.today_completion_rate || 0) * 100)}%` }"
              ></div>
            </div>
          </div>

          <section :aria-label="`${item.child.name}的待办摘要`" class="mb-4">
            <div v-if="item.attention" class="grid grid-cols-2 gap-2">
              <div class="rounded-xl border border-amber-100 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-amber-800 dark:text-amber-200">
                <p class="text-xs font-bold">今天到期</p><p class="mt-1 text-lg font-black tabular-nums">{{ item.attention.due_today }} <span class="text-xs">项待办</span></p>
              </div>
              <div class="rounded-xl border border-rose-100 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 text-rose-700 dark:text-rose-300">
                <p class="text-xs font-bold">高优先级</p><p class="mt-1 text-lg font-black tabular-nums">{{ item.attention.high_priority_pending }} <span class="text-xs">项待办</span></p>
              </div>
            </div>
            <p v-if="item.attention" class="mt-1.5 text-xs text-slate-500 dark:text-slate-400">不含已完成、已跳过和额外挑战；长期任务当天记过进度后不计入。</p>
          </section>

          <!-- Today's homework time and when it was finished -->
          <router-link
            v-if="item.time && (item.time.summary.sessions || todayFinishedAt(item))"
            :to="`/parent/time-stats?child=${item.child.id}`"
            class="min-h-11 mb-4 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 rounded-xl bg-violet-50/70 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-800 text-xs font-bold text-violet-800 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/40"
          >
            <template v-if="item.time.summary.sessions">
              <span>⏱ 今天作业用时 {{ formatMinutes(item.time.summary.recorded_seconds) }}</span>
              <span v-if="item.time.summary.estimated_seconds > item.time.summary.recorded_seconds" class="text-violet-600 dark:text-violet-300">（含估算约 {{ formatMinutes(item.time.summary.estimated_seconds) }}）</span>
            </template>
            <span v-if="todayFinishedAt(item)">{{ item.time.summary.sessions ? '·' : '⏱ 今天' }} {{ todayFinishedAt(item) }} 写完</span>
            <span class="ml-auto text-violet-500 dark:text-violet-400">查看用时统计 →</span>
          </router-link>

          <!-- Quick Stats Summary -->
          <div class="grid grid-cols-3 gap-2 text-center text-xs">
            <div class="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800">
              <span class="text-slate-500 dark:text-slate-400 font-semibold block text-xs">本周完成度·截至今天</span>
              <span class="text-base font-black text-emerald-600 dark:text-emerald-300">{{ formatRate(item.week?.current_week?.completion?.completion_rate) }}</span>
              <span class="block text-xs font-bold text-slate-400">上周 {{ formatRate(item.week?.last_week?.completion?.completion_rate) }}</span>
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800">
              <span class="text-slate-400 font-semibold block text-xs">累计总积分</span>
              <span class="text-base font-black text-amber-600 dark:text-amber-300">{{ item.stats.total_points || 0 }} 分</span>
            </div>
            <div class="p-2.5 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800">
              <span class="text-slate-400 font-semibold block text-xs">安全验证</span>
              <span class="text-base font-black text-brand-600 dark:text-brand-300">{{ item.child.has_pin ? '已设置 PIN' : '免密直登' }}</span>
            </div>
          </div>

          <section v-if="item.week?.current_week?.completion?.items.some(entry => entry.schedule_type === 'weekly_times')" class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
            <h4 class="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">🎯 本周次数任务</h4>
            <div v-for="entry in item.week.current_week.completion.items.filter(entry => entry.schedule_type === 'weekly_times')" :key="entry.key" class="text-xs mb-2">
              <span class="font-bold text-slate-700 dark:text-slate-200">{{ entry.title }} · 目标 {{ entry.weekly_target }} 次，已完成 {{ entry.actual_completed ?? entry.completed }} 次</span>
              <span v-if="entry.extra_completed" class="block text-violet-600 dark:text-violet-300">额外 {{ entry.extra_completed }} 次 · 目标内 +{{ entry.target_points_earned }} 分，额外 +{{ entry.extra_points_earned }} 分</span>
            </div>
          </section>

          <!-- Active long-term tasks -->
          <div v-if="item.goals.length" class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
            <span class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-2">📚 长期任务</span>
            <ul class="space-y-2">
              <li v-for="goal in item.goals" :key="goal.id" class="text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <span class="min-w-0 break-words font-bold text-slate-700 dark:text-slate-200 font-chinese">{{ goal.title }}</span>
                  <span class="font-bold text-slate-500 dark:text-slate-400">
                    {{ goal.mode === 'progress' ? `${goal.done_amount}/${goal.total_amount} ${goal.unit}` : '未完成' }}
                    <span v-if="goal.daily_required" :class="goal.today_logged ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500 dark:text-rose-400'">· 今天{{ goal.today_logged ? '已记录' : '未记录' }}</span>
                  </span>
                </div>
                <div class="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div class="h-full rounded-full bg-indigo-500" :style="{ width: `${Math.round((goal.done_amount / goal.total_amount) * 100)}%` }"></div>
                </div>
              </li>
            </ul>
          </div>

          <!-- One-off tasks for today and later days -->
          <div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-slate-500 dark:text-slate-400">📌 临时任务</span>
              <button type="button" :disabled="!canMutate" class="min-h-11 min-w-11 px-3 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 dark:hover:bg-orange-950/40 text-orange-700 dark:text-orange-300 font-bold text-xs disabled:opacity-50" @click="openAdhoc(item.child)">
                ➕ 添加
              </button>
            </div>
            <p v-if="!item.adhoc.length" class="text-xs text-slate-400">今天及以后没有临时任务，老师临时布置的作业可以加在这里。</p>
            <ul v-else class="space-y-1.5">
              <li v-for="task in item.adhoc" :key="task.id" class="rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 space-y-2 text-xs">
                <div class="flex items-start gap-2">
                  <span class="shrink-0 font-bold" :class="task.date === loadedDate ? 'text-orange-600 dark:text-orange-300' : 'text-slate-400'">{{ dayLabel(task.date) }}</span>
                  <span class="flex-1 min-w-0 break-words font-bold font-chinese" :class="task.is_completed ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'">{{ task.subject }} · {{ task.title }}</span>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2 min-w-0"><PriorityBadge :priority="task.priority" />
                <span v-if="task.due_date" class="shrink-0 text-xs font-bold text-sky-600 dark:text-sky-300">截止 {{ dayLabel(task.due_date) }}</span>
                <span class="text-amber-500 dark:text-amber-400 font-black shrink-0">★{{ task.points }}</span>
                </div>
                <div class="flex items-center gap-2 ml-auto">
                <button v-if="task.can_edit" type="button" :disabled="!canMutate" class="min-h-[44px] min-w-[44px] px-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold shrink-0 disabled:opacity-50" :aria-label="`修改 ${task.title}`" @click="openAdhoc(item.child, task)">修改</button>
                <button type="button" :disabled="!canMutate" class="w-11 h-11 shrink-0 disabled:opacity-50 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40" :aria-label="`删除 ${task.title}`" title="删除" @click="removeAdhoc(item, task)">✕</button>
                </div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
      </template>
    </main>

    <AdhocTaskDialog v-if="adhocForm" :child="adhocForm.child" :task="adhocForm.task" @close="adhocForm = null" @saved="afterAdhocSaved" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import api from '../api/client';
import { useCalendarStore } from '../stores/calendar';
import { confirmAction } from '../utils/confirmation';
import { getToken, getDataGeneration, hasSession } from '../utils/session';
import ParentNavBar from '../components/ParentNavBar.vue';
import ParentPageHeader from '../components/ParentPageHeader.vue';
import ParentPageState from '../components/ParentPageState.vue';
import { formatMinutes } from '../utils/timeStats.js';
import AdhocTaskDialog from '../components/AdhocTaskDialog.vue';
import PriorityBadge from '../components/PriorityBadge.vue';
import { taskAttention } from '../utils/taskOrdering.js';
import { courseLabel } from '../utils/homework.js';
import { addDays } from '../utils/schedule';
import { LONG_TIMER_SECONDS, MAX_TIMER_SECONDS, formatClock, liveSeconds, timerTarget, withClock } from '../utils/taskTimer.js';
const calendar = useCalendarStore();
const childrenStats = ref([]), skipRequests = ref([]), homeworkRequests = ref([]), completionRequests = ref([]);
const loading = ref(true), refreshing = ref(false), dashboardError = ref('');
const loadedDate = ref(null), loadedZone = ref(null), dashboardLoaded = computed(() => loadedDate.value !== null);
const adhocForm = ref(null), writeBusy = ref(false), confirming = ref(false);
const actionError = ref(''), notice = ref('');
const actionLocked = computed(() => writeBusy.value || confirming.value);
const today = computed(() => calendar.today);
const canMutate = computed(() => calendar.ready && dashboardLoaded.value && loadedDate.value === today.value
  && loadedZone.value === calendar.timeZone && !loading.value && !refreshing.value && !dashboardError.value && !actionLocked.value && !adhocForm.value);
const silent = { silentError: true, preserveError: true };
let alive = true, epoch = 0, dashboardSerial = 0, pendingDate = null, reader;
const message = err => typeof err === 'string' ? err : err?.message || '操作失败，请在原处重试';
const scope = () => ({ epoch, token: getToken('parent'), generation: getDataGeneration() });
const currentScope = captured => alive && captured.epoch === epoch && captured.token === getToken('parent');
const writeOptions = captured => ({ ...silent, headers: captured.generation ? { 'X-Taskie-Data-Generation': captured.generation } : {} });

// A missing optional response is distinct from a successful response containing no records.
async function optional(label, read, unavailable) {
  try { return await read(); }
  catch (err) { if (err?.code === 'ERR_CANCELED') throw err; unavailable.push(label); return null; }
}
const classOverview = rows => ({ count: rows.length,
  attended: rows.reduce((n, row) => n + row.attended, 0), pending: rows.reduce((n, row) => n + row.pending, 0),
  next: rows.filter(row => row.next_lesson).map(row => ({ ...row.next_lesson, title: row.title }))
    .sort((a, b) => a.actual_date.localeCompare(b.actual_date) || a.start_time.localeCompare(b.start_time))[0] ?? null
});
const now = ref(Date.now());
const timerSeconds = timer => Math.min(MAX_TIMER_SECONDS, liveSeconds(timer, now.value));
const timerTone = timer => !timer.timer_running ? 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
  : timerSeconds(timer) > LONG_TIMER_SECONDS ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300';
function dayLabel(date) {
  const shownDate = loadedDate.value || today.value;
  if (date === shownDate) return '今天';
  if (date === addDays(shownDate, 1)) return '明天';
  return date.slice(5).replace('-', '/');
}
const activeGoals = goals => goals.filter(goal => goal.status === 'active');
const todayFinishedAt = item => item.stats.today_total_tasks && item.stats.today_completed_tasks === item.stats.today_total_tasks
  ? item.time?.days[0]?.finished_at ?? null : null;
function openAdhoc(child, task = null) {
  calendar.refreshToday();
  if (!canMutate.value) return;
  actionError.value = ''; notice.value = '';
  adhocForm.value = { child, task };
}
async function afterAdhocSaved() {
  adhocForm.value = null;
  notice.value = '临时任务已保存。';
  await loadDashboard();
}

// Stop an older read before a write; periodic reads resume only after its reconciliation.
async function perform(work, accept, success) {
  if (!canMutate.value) return;
  const captured = scope();
  writeBusy.value = true; actionError.value = ''; notice.value = '';
  dashboardSerial++; reader?.abort(); pendingDate = null;
  try {
    await work(writeOptions(captured));
    if (!currentScope(captured)) return;
    accept(); notice.value = success;
  } catch (err) {
    if (!currentScope(captured)) return;
    actionError.value = message(err);
  } finally {
    if (currentScope(captured)) await loadDashboard({ afterWrite: true });
    writeBusy.value = false;
    if (alive && captured.epoch !== epoch) loadDashboard();
  }
}
function resolveSkip(request, action) {
  if (!skipRequests.value.some(row => row.id === request.id)) return;
  return perform(options => action === 'approve' ? api.approveSkipRequest(request.id, options) : api.rejectSkipRequest(request.id, options),
    () => { skipRequests.value = skipRequests.value.filter(row => row.id !== request.id); }, action === 'approve' ? '已同意跳过任务。' : '已拒绝跳过申请。');
}
function resolveHomework(record, action) {
  if (!homeworkRequests.value.some(row => row.id === record.id) || (action === 'create' && !record.can_create_task)) return;
  return perform(options => action === 'create' ? api.createHomeworkTask(record.id, {}, options) : api.rejectHomeworkTask(record.id, options),
    () => { homeworkRequests.value = homeworkRequests.value.filter(row => row.id !== record.id); }, action === 'create' ? '作业任务已生成。' : '已处理这条作业申请。');
}
function resolveCompletion(record, approve) {
  if (!completionRequests.value.some(row => row.id === record.id)) return;
  return perform(options => approve ? api.completeHomework(record.id, {}, options) : api.rejectHomeworkCompletion(record.id, options),
    () => { completionRequests.value = completionRequests.value.filter(row => row.id !== record.id); }, approve ? '已确认作业全部完成。' : '已暂不确认这次完成申请。');
}
async function removeAdhoc(item, task) {
  if (!canMutate.value) return;
  const captured = scope(), signature = JSON.stringify([task.title, task.points, task.is_completed]);
  confirming.value = true;
  let confirmed;
  try {
    const warning = task.is_completed ? '，孩子因此获得的积分也会扣回' : '';
    confirmed = await confirmAction(`确定删除临时任务「${task.title}」吗${warning}？`);
  } finally { confirming.value = false; }
  if (!confirmed || !currentScope(captured) || captured.generation !== getDataGeneration()) return;
  calendar.refreshToday();
  const freshItem = childrenStats.value.find(row => row.child.id === item.child.id);
  const fresh = freshItem?.adhoc.find(row => row.id === task.id);
  if (!canMutate.value || !fresh || signature !== JSON.stringify([fresh.title, fresh.points, fresh.is_completed])) {
    actionError.value = '任务状态已变化，请重新读取后核对并操作。'; return;
  }
  return perform(options => api.deleteAdhocTask(task.id, options),
    () => { freshItem.adhoc = freshItem.adhoc.filter(row => row.id !== task.id); }, '临时任务已删除。');
}

const overallCompletionRate = computed(() => {
  const total = childrenStats.value.reduce((sum, item) => sum + (item.stats.today_total_tasks || 0), 0);
  const completed = childrenStats.value.reduce((sum, item) => sum + (item.stats.today_completed_tasks || 0), 0);
  return total ? Math.round(completed / total * 100) : 0;
});
function formatRate(rate) { return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`; }
const totalPointsIssued = computed(() => childrenStats.value.reduce((sum, item) => sum + (item.stats.total_points || 0), 0));

async function loadDashboard({ afterWrite = false } = {}) {
  if (!alive || (writeBusy.value && !afterWrite)) return;
  if (!calendar.ready) { loading.value = false; return; }
  calendar.refreshToday();
  reader?.abort(); reader = new AbortController();
  const signal = reader.signal, captured = scope(), date = today.value, timeZone = calendar.timeZone, serial = ++dashboardSerial;
  refreshing.value = true; pendingDate = date;
  loading.value = !dashboardLoaded.value;
  const current = () => currentScope(captured) && serial === dashboardSerial && calendar.ready && date === today.value && timeZone === calendar.timeZone;
  dashboardError.value = '';
  try {
    const children = await api.getChildren(signal, silent);
    if (!current()) return;
    const statsPromises = children.map(async child => {
      const unavailable = [];
      const [stats, week, adhoc, goals, time, timer, classes, tasks] = await Promise.all([
        api.getChildStats(child.id, signal, silent), api.getWeeklySummary(child.id, signal, silent),
        api.getAdhocTasks(child.id, signal, silent), api.getChildGoals(child.id, signal, silent),
        optional('作业用时', () => api.getTimeStats(child.id, date, date, signal, silent), unavailable),
        optional('当前计时', () => api.getCurrentTimer(child.id, signal, silent), unavailable),
        optional('课外班概览', () => api.getOutsideClassStats(child.id, signal, silent), unavailable),
        optional('待办摘要', () => api.getDailyTasks(child.id, date, signal, silent), unavailable)
      ]);
      return { child, stats, week, adhoc, goals: activeGoals(goals), time, timer: timer?.timer ? withClock(timer.timer) : null,
        classOverview: classes ? classOverview(classes) : null, attention: tasks ? taskAttention(tasks, goals, date) : null, unavailable };
    });
    const result = await Promise.all([Promise.all(statsPromises), api.getSkipRequests('pending', { limit: 200 }, signal, silent),
      api.getHomeworkRequests(signal, silent), api.getHomeworkCompletionRequests(signal, silent)]);
    if (!current()) return;
    [childrenStats.value, skipRequests.value, homeworkRequests.value, completionRequests.value] = result;
    loadedDate.value = date; loadedZone.value = timeZone;
  } catch (err) {
    if (!current() || signal.aborted) return;
    dashboardError.value = dashboardLoaded.value ? '刷新失败，当前显示上次读取的数据，请重试。' : '暂时无法加载孩子的进展，请重新加载。';
  } finally {
    if (serial === dashboardSerial) { loading.value = false; refreshing.value = false; pendingDate = null; }
  }
}
async function reloadLive() {
  if (document.hidden || pendingDate !== null || writeBusy.value) return;
  await loadDashboard();
}
function onResume() { if (!document.hidden) { calendar.refreshToday(); reloadLive(); } }
function reloadDashboardDay() {
  if (calendar.ready && (today.value !== loadedDate.value || loadedZone.value !== calendar.timeZone) && today.value !== pendingDate) loadDashboard();
}
function restored() {
  epoch++; dashboardSerial++; reader?.abort(); pendingDate = null;
  childrenStats.value = []; skipRequests.value = []; homeworkRequests.value = []; completionRequests.value = [];
  loadedDate.value = null; loadedZone.value = null; dashboardError.value = ''; actionError.value = ''; notice.value = ''; adhocForm.value = null;
  refreshing.value = false;
  loadDashboard();
}
onBeforeRouteLeave(to => !hasSession('parent') || ['/parent/login', '/parent/setup-pin'].includes(to.path) || (!writeBusy.value && !adhocForm.value));
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
const poll = setInterval(reloadLive, 60000);
watch(() => [calendar.today, calendar.ready, calendar.timeZone], reloadDashboardDay);
onMounted(() => {
  loadDashboard();
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', onResume);
  window.addEventListener('taskie:data-restored', restored);
});
onUnmounted(() => {
  alive = false; epoch++; dashboardSerial++; reader?.abort();
  clearInterval(clock); clearInterval(poll);
  document.removeEventListener('visibilitychange', onResume);
  window.removeEventListener('pageshow', onResume);
  window.removeEventListener('taskie:data-restored', restored);
});
</script>
