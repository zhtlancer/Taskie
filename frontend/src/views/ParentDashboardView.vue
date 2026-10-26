<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <!-- Title Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6 [&>*:last-child]:whitespace-nowrap">
        <div>
          <h2 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <span>📊</span>
            <span>今日作业完成概览</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            实时查看所有孩子的打卡与任务进展
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <router-link
            to="/parent/time-stats"
            class="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold active:scale-95 transition-all"
          >
            ⏱ 用时统计
          </router-link>
          <router-link
            to="/parent/tasks"
            class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button active:scale-95 transition-all"
          >
            📝 管理任务模板
          </router-link>
        </div>
      </div>

      <!-- Children's requests to skip a task, waiting for a parent -->
      <section v-if="skipRequests.length" class="mb-4 bg-white dark:bg-slate-900 rounded-2xl p-4 border-2 border-amber-200 dark:border-amber-800 shadow-card">
        <h3 class="text-base font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
          <span>🙋</span>
          <span>跳过任务申请</span>
          <span class="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-xs">{{ skipRequests.length }}</span>
        </h3>
        <p v-if="skipError" class="mb-2 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ skipError }}</p>
        <ul class="space-y-2">
          <li v-for="r in skipRequests" :key="r.id" class="p-3 rounded-2xl bg-amber-50/60 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-800 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-2xl">{{ r.child_avatar_emoji }}</span>
            <div class="flex-1 min-w-[180px]">
              <div class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese">
                {{ r.child_name }} · {{ dayLabel(r.task_date) }} · {{ r.task_subject }} · {{ r.task_title }}
              </div>
              <div class="text-xs font-bold text-amber-700 dark:text-amber-300 font-chinese">理由：{{ r.reason }}</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <button type="button" :disabled="skipBusy" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50" @click="resolveSkip(r, 'approve')">同意跳过</button>
              <button type="button" :disabled="skipBusy" class="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold disabled:opacity-50" @click="resolveSkip(r, 'reject')">不同意</button>
            </div>
          </li>
        </ul>
      </section>

      <!-- Homework children recorded, waiting for a parent to create its task -->
      <section v-if="homeworkRequests.length" class="mb-4 bg-white dark:bg-slate-900 rounded-2xl p-4 border-2 border-orange-200 dark:border-orange-800 shadow-card">
        <h3 class="text-base font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
          <span>📒</span>
          <span>孩子记的作业，等你确认生成任务</span>
          <span class="px-2 py-0.5 rounded-lg bg-rose-500 text-white text-xs">{{ homeworkRequests.length }}</span>
        </h3>
        <p v-if="homeworkError" class="mb-2 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ homeworkError }}</p>
        <ul class="space-y-2">
          <li v-for="r in homeworkRequests" :key="r.id" class="p-3 rounded-2xl bg-orange-50/60 dark:bg-orange-950/40 border border-orange-100 dark:border-orange-800 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span class="text-2xl">{{ r.child_avatar_emoji }}</span>
            <div class="flex-1 min-w-[180px]">
              <div class="text-sm font-bold text-slate-800 dark:text-slate-100 font-chinese">{{ r.child_name }} · {{ courseLabel(r) }} · {{ dayLabel(r.assigned_date) }}布置</div>
              <div class="text-xs font-bold text-slate-600 dark:text-slate-300 font-chinese whitespace-pre-line line-clamp-2">{{ r.content }}</div>
              <div class="text-xs font-bold text-orange-700 dark:text-orange-300">{{ r.due_date ? `截止 ${dayLabel(r.due_date)}` : '没有截止日期' }} · ★{{ r.points }}</div>
            </div>
            <div class="flex gap-2 shrink-0">
              <button type="button" :disabled="homeworkBusy || !r.can_create_task" class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold disabled:opacity-50" @click="resolveHomework(r, 'create')">生成任务</button>
              <button type="button" :disabled="homeworkBusy" class="px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold disabled:opacity-50" @click="resolveHomework(r, 'reject')">不需要</button>
              <router-link :to="`/child/${r.child_id}/homework`" class="px-3 py-2 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">改积分</router-link>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="completionRequests.length" class="mb-6 bg-white dark:bg-slate-900 rounded-2xl border border-amber-200 dark:border-amber-800 p-4 space-y-3">
        <h3 class="font-bold">📒 超期作业全部完成申请</h3>
        <p v-if="completionError" class="text-rose-600 dark:text-rose-300 text-sm">{{ completionError }}</p>
        <div v-for="record in completionRequests" :key="record.id" class="flex flex-wrap items-center gap-3 text-sm">
          <span class="flex-1">{{ record.child_name }} · {{ courseLabel(record) }}：{{ record.content }}</span>
          <button :disabled="completionBusy" class="bg-emerald-600 text-white rounded-xl px-3 py-2" @click="resolveCompletion(record, true)">确认完成</button>
          <button :disabled="completionBusy" class="border rounded-xl px-3 py-2" @click="resolveCompletion(record, false)">暂不确认</button>
          <router-link :to="`/child/${record.child_id}/homework`" class="text-indigo-600 dark:text-indigo-300">查看学习记录</router-link>
        </div>
      </section>
      <div v-if="calendar.ready && !loading && (!dashboardError || dashboardLoaded)" class="grid grid-cols-3 gap-2 mb-5" aria-label="今日摘要">
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3"><p class="text-xs text-slate-500 dark:text-slate-400">小朋友</p><p class="text-xl font-black text-slate-800 dark:text-slate-100">{{ childrenStats.length }} <span class="text-xs">位</span></p></div>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3"><p class="text-xs text-slate-500 dark:text-slate-400">今日完成</p><p class="text-xl font-black text-emerald-600 dark:text-emerald-300">{{ overallCompletionRate }}%</p></div>
        <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-3"><p class="text-xs text-slate-500 dark:text-slate-400">累计积分</p><p class="text-xl font-black text-amber-600 dark:text-amber-300">{{ totalPointsIssued }}</p></div>
      </div>
      <div v-if="dashboardError" role="alert" class="mb-4 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-700 dark:text-rose-300 flex flex-wrap items-center justify-between gap-3">
        <span>{{ dashboardError }}</span><button type="button" :disabled="loading" class="min-h-[44px] px-4 rounded-xl bg-white dark:bg-slate-900 font-bold disabled:opacity-50" @click="loadDashboard">重新加载</button>
      </div>
      <!-- Children Detail Progress Grid -->
      <h3 class="text-base font-bold text-slate-700 dark:text-slate-200 mb-3 px-1">
        各个小朋友实时看板
      </h3>

      <div v-if="!calendar.ready" role="status" class="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700">
        <p class="text-sm font-bold text-slate-600 dark:text-slate-300">正在等待确认家庭时区…</p>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-2">请使用顶部的“重新读取家庭时区”入口，确认后即可查看孩子的进展。</p>
      </div>

      <div v-else-if="loading" class="text-center py-16 text-brand-500 dark:text-brand-400 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在统计今日作业进展...
      </div>

      <div v-else-if="!dashboardError && childrenStats.length === 0" class="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700">
        <div class="text-5xl mb-2">👶</div>
        <p class="text-slate-500 dark:text-slate-400 text-sm mb-4">还没有添加小朋友账号哦</p>
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
          class="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card hover:shadow-card-hover transition-all"
        >
          <!-- Top Row: Avatar, Name, Link -->
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-16 h-16 shrink-0 rounded-2xl bg-brand-50 dark:bg-brand-900/40 flex items-center justify-center text-3xl shadow-inner">
                {{ item.child.avatar_emoji || '🐱' }}
              </div>
              <div>
                <h4 class="text-xl font-bold text-slate-800 dark:text-slate-100">{{ item.child.name }}</h4>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 whitespace-nowrap">
                  <span class="text-xs text-amber-600 dark:text-amber-300 font-extrabold flex items-center gap-0.5">
                    <span>🔥</span>
                    <span>连续 {{ item.stats.current_streak || 0 }} 天</span>
                  </span>
                  <span class="text-slate-300">·</span>
                  <span class="text-xs text-slate-500 dark:text-slate-400 font-bold">
                    今日积分 +{{ item.stats.today_points || 0 }}
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

          <!-- Progress Bar & Count -->
          <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 mb-4">
            <div class="flex items-center justify-between text-xs font-bold mb-1.5">
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
            <div v-else role="status" class="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>待办摘要暂不可用</span><button type="button" class="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold" @click="reloadLive">重新读取摘要</button>
            </div>
          </section>

          <!-- Today's homework time and when it was finished -->
          <router-link
            v-if="item.time && (item.time.summary.sessions || todayFinishedAt(item))"
            :to="`/parent/time-stats?child=${item.child.id}`"
            class="mb-4 -mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 rounded-xl bg-violet-50/70 dark:bg-violet-950/40 border border-violet-100 dark:border-violet-800 text-xs font-bold text-violet-800 dark:text-violet-200 hover:bg-violet-50 dark:hover:bg-violet-950/40"
          >
            <template v-if="item.time.summary.sessions">
              <span>⏱ 今天作业用时 {{ formatMinutes(item.time.summary.recorded_seconds) }}</span>
              <span v-if="item.time.summary.estimated_seconds > item.time.summary.recorded_seconds" class="text-violet-600 dark:text-violet-300">（含估算约 {{ formatMinutes(item.time.summary.estimated_seconds) }}）</span>
            </template>
            <span v-if="todayFinishedAt(item)">{{ item.time.summary.sessions ? '·' : '⏱ 今天' }} {{ todayFinishedAt(item) }} 写完</span>
            <span class="ml-auto text-violet-500 dark:text-violet-400">查看用时统计 →</span>
          </router-link>

          <!-- Quick Stats Summary -->
          <div class="grid grid-cols-3 gap-3 text-center text-xs">
            <div class="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800">
              <span class="text-slate-400 font-semibold block text-xs">本周完成度·截至今天</span>
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
                <div class="flex items-center justify-between gap-2 mb-1">
                  <span class="font-bold text-slate-700 dark:text-slate-200 font-chinese truncate">{{ goal.title }}</span>
                  <span class="shrink-0 font-bold text-slate-500 dark:text-slate-400">
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
              <button type="button" class="px-3 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/40 hover:bg-orange-100 dark:hover:bg-orange-950/40 text-orange-700 dark:text-orange-300 font-bold text-xs" @click="openAdhoc(item.child)">
                ➕ 添加
              </button>
            </div>
            <p v-if="!item.adhoc.length" class="text-xs text-slate-400">今天及以后没有临时任务，老师临时布置的作业可以加在这里。</p>
            <ul v-else class="space-y-1.5">
              <li v-for="task in item.adhoc" :key="task.id" class="flex items-center gap-2 text-xs">
                <span class="w-12 shrink-0 font-bold" :class="task.date === today ? 'text-orange-600 dark:text-orange-300' : 'text-slate-400'">{{ dayLabel(task.date) }}</span>
                <span class="flex-1 truncate font-bold font-chinese" :class="task.is_completed ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'">{{ task.subject }} · {{ task.title }}</span><PriorityBadge :priority="task.priority" />
                <span v-if="task.due_date" class="shrink-0 text-xs font-bold text-sky-600 dark:text-sky-300">截止 {{ dayLabel(task.due_date) }}</span>
                <span class="text-amber-500 dark:text-amber-400 font-black shrink-0">★{{ task.points }}</span>
                <button type="button" class="w-10 h-10 -my-2 -mr-2 shrink-0 flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40" :aria-label="`删除 ${task.title}`" title="删除" @click="removeAdhoc(item, task)">✕</button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </main>

    <!-- Add One-off Task Modal -->
    <div v-if="adhocForm" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="adhocForm = null">
      <form class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border-2 border-brand-100 dark:border-brand-800 space-y-4" @submit.prevent="saveAdhoc">
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 font-chinese">➕ 给{{ adhocForm.child.name }}加临时任务</h3>
        <p v-if="adhocError" class="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ adhocError }}</p>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">任务名称</label>
          <input v-model="adhocForm.title" type="text" maxlength="50" required placeholder="例如：订正数学练习、准备手抄报" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 outline-none font-chinese" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">所属学科</label>
          <div class="grid grid-cols-4 gap-2">
            <button v-for="sub in ['语文', '数学', '英语', '其他']" :key="sub" type="button" class="py-2 rounded-xl text-xs font-bold border font-chinese" :class="adhocForm.subject === sub ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'" @click="adhocForm.subject = sub">{{ sub }}</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">哪一天</label>
            <input v-model="adhocForm.date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
            <div class="flex gap-1.5 mt-1.5">
              <button type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="adhocForm.date = today">今天</button>
              <button type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="adhocForm.date = addDays(today, 1)">明天</button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">奖励积分</label>
            <input v-model.number="adhocForm.points" type="number" min="0" max="10000" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">截止日期（可不填）</label>
          <input v-model="adhocForm.due_date" type="date" :min="adhocForm.date" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
          <p class="mt-1 text-xs font-bold text-slate-400">填了的话，截止前每天都可以做，比如周三布置、周五交的手抄报</p>
        </div>
        <PriorityFields v-model="adhocForm.priority" />
        <TimingFields v-model:track-time="adhocForm.track_time" v-model:expected-minutes="adhocForm.expected_minutes" />
        <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="adhocForm = null">取消</button>
          <button type="submit" :disabled="adhocSaving || !adhocForm.title.trim()" class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">{{ adhocSaving ? '保存中...' : '确认添加' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { confirmAction } from '../utils/confirmation';
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import { formatMinutes } from '../utils/timeStats.js';
import TimingFields from '../components/TimingFields.vue';
import PriorityFields from '../components/PriorityFields.vue';
import PriorityBadge from '../components/PriorityBadge.vue';
import { taskAttention } from '../utils/taskOrdering.js';
import { courseLabel } from '../utils/homework.js';
import { LONG_TIMER_SECONDS, MAX_TIMER_SECONDS, formatClock, liveSeconds, timerTarget, withClock } from '../utils/taskTimer.js';
const calendar = useCalendarStore();

const childrenStats = ref([]);

// Each child's current timer ticks locally; it and the outside-class overview are reloaded now and
// then, and on returning to the page.
const now = ref(Date.now());
const loadTimer = id => api.getCurrentTimer(id).then(result => result.timer && withClock(result.timer)).catch(() => null);
const loadAttention = (id, date) => Promise.all([api.getDailyTasks(id), api.getChildGoals(id)])
  .then(([tasks, goals]) => taskAttention(tasks, goals, date)).catch(() => null);
const loadClassOverview = id => api.getOutsideClassStats(id).then(rows => ({ count: rows.length,
  attended: rows.reduce((n, row) => n + row.attended, 0), pending: rows.reduce((n, row) => n + row.pending, 0),
  next: rows.filter(row => row.next_lesson).map(row => ({ ...row.next_lesson, title: row.title }))
    .sort((a, b) => a.actual_date.localeCompare(b.actual_date) || a.start_time.localeCompare(b.start_time))[0] ?? null
})).catch(() => null);
const timerSeconds = timer => Math.min(MAX_TIMER_SECONDS, liveSeconds(timer, now.value));
const timerTone = timer => !timer.timer_running ? 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
  : timerSeconds(timer) > LONG_TIMER_SECONDS ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300';
let liveSerial = 0;
async function reloadLive() {
  if (document.hidden) return;
  const items = childrenStats.value, serial = ++liveSerial, date = today.value, zone = calendar.timeZone;
  const live = await Promise.all(items.map(item => Promise.all([loadTimer(item.child.id), loadClassOverview(item.child.id), loadAttention(item.child.id, date)])));
  if (serial === liveSerial && items === childrenStats.value && date === today.value && zone === calendar.timeZone && calendar.ready) {
    items.forEach((item, index) => { [item.timer, item.classOverview, item.attention] = live[index]; });
  }
}
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
const poll = setInterval(reloadLive, 60000);
function onResume() {
  if (document.hidden) return;
  calendar.refreshToday();
  reloadDashboardDay();
  reloadLive();
}
document.addEventListener('visibilitychange', onResume);
window.addEventListener('pageshow', onResume);
onUnmounted(() => {
  dashboardSerial++; liveSerial++;
  clearInterval(clock); clearInterval(poll);
  document.removeEventListener('visibilitychange', onResume);
  window.removeEventListener('pageshow', onResume);
});
const loading = ref(true);
const dashboardError = ref('');
const dashboardLoaded = ref(false);
const adhocForm = ref(null);
const adhocSaving = ref(false);
const adhocError = ref('');
const skipRequests = ref([]);
const skipBusy = ref(false);
const skipError = ref('');
const homeworkRequests = ref([]);
const completionRequests = ref([]), completionBusy = ref(false), completionError = ref('');
async function resolveCompletion(record, approve) {
  completionBusy.value = true; completionError.value = '';
  try {
    await (approve ? api.completeHomework(record.id) : api.rejectHomeworkCompletion(record.id));
    await loadDashboard();
  } catch (err) { completionError.value = typeof err === 'string' ? err : '操作失败'; }
  finally { completionBusy.value = false; }
}
const homeworkBusy = ref(false);
const homeworkError = ref('');

const addDays = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const today = computed(() => calendar.today);

function dayLabel(date) {
  if (date === today.value) return '今天';
  if (date === addDays(today.value, 1)) return '明天';
  return date.slice(5).replace('-', '/');
}

function openAdhoc(child) {
  calendar.refreshToday();
  adhocError.value = '';
  adhocForm.value = { child, title: '', subject: '语文', date: today.value, due_date: '', points: 10, priority: 1, track_time: false, expected_minutes: null };
}

const activeGoals = goals => goals.filter(goal => goal.status === 'active');
// When today's homework was finished: only once every task counted today is done.
const todayFinishedAt = item => item.stats.today_total_tasks && item.stats.today_completed_tasks === item.stats.today_total_tasks
  ? item.time?.days[0].finished_at ?? null : null;

async function saveAdhoc() {
  adhocSaving.value = true;
  adhocError.value = '';
  try {
    const { child, title, subject, date, due_date, points, priority, track_time, expected_minutes } = adhocForm.value;
    await api.createAdhocTask(child.id, { title, subject, date, due_date: due_date && due_date > date ? due_date : null, points: points || 0, priority,
      track_time, expected_minutes: track_time ? expected_minutes : null });
    await loadDashboard();
    adhocForm.value = null;
  } catch (err) {
    adhocError.value = typeof err === 'string' ? err : '添加失败，请重试';
  } finally {
    adhocSaving.value = false;
  }
}

async function removeAdhoc(item, task) {
  const warning = task.is_completed ? '，孩子因此获得的积分也会扣回' : '';
  if (!await confirmAction(`确定删除临时任务「${task.title}」吗${warning}？`)) return;
  try {
    await api.deleteAdhocTask(task.id);
    await loadDashboard();
  } catch (err) {
    console.error('Failed to delete one-off task:', err);
  }
}

// Approving a skip changes that child's progress for the day, so their card is refreshed too.
async function resolveSkip(request, action) {
  skipBusy.value = true;
  skipError.value = '';
  try {
    await (action === 'approve' ? api.approveSkipRequest(request.id) : api.rejectSkipRequest(request.id));
    await loadDashboard();
  } catch (err) {
    skipError.value = typeof err === 'string' ? err : '操作失败，请重试';
    await loadDashboard();
  } finally {
    skipBusy.value = false;
  }
}

// Creating the task adds it to that child's board, so their card is refreshed too.
async function resolveHomework(record, action) {
  homeworkBusy.value = true;
  homeworkError.value = '';
  try {
    await (action === 'create' ? api.createHomeworkTask(record.id) : api.rejectHomeworkTask(record.id));
    await loadDashboard();
  } catch (err) {
    homeworkError.value = typeof err === 'string' ? err : '操作失败，请重试';
    await loadDashboard();
  } finally {
    homeworkBusy.value = false;
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

let dashboardSerial = 0, loadedDate = null, pendingDate = null;
function reloadDashboardDay() {
  if (calendar.ready && today.value !== loadedDate && today.value !== pendingDate) loadDashboard();
}
async function loadDashboard() {
  if (!calendar.ready) { loading.value = false; return; }
  calendar.refreshToday();
  const date = today.value, timeZone = calendar.timeZone, serial = ++dashboardSerial;
  pendingDate = date;
  // Keep cards and open drafts visible during subsequent loads, including for an empty family.
  loading.value = loadedDate === null;
  const current = () => serial === dashboardSerial && calendar.ready && date === today.value && timeZone === calendar.timeZone;
  dashboardError.value = '';
  try {
    const children = await api.getChildren();
    if (!current()) return;
    const statsPromises = children.map(async (child) => {
      const [stats, week, adhoc, goals, time, timer, classOverview, tasks] = await Promise.all([api.getChildStats(child.id), api.getWeeklySummary(child.id),
        api.getAdhocTasks(child.id), api.getChildGoals(child.id), api.getTimeStats(child.id, date, date).catch(() => null), loadTimer(child.id), loadClassOverview(child.id), api.getDailyTasks(child.id).catch(() => null)]);
      return { child, stats, week, adhoc, goals: activeGoals(goals), time, timer, classOverview, attention: tasks ? taskAttention(tasks, goals, date) : null };
    });
    const result = await Promise.all([Promise.all(statsPromises), api.getSkipRequests('pending', { limit: 200 }), api.getHomeworkRequests(), api.getHomeworkCompletionRequests()]);
    if (!current()) return;
    liveSerial++; // A live refresh for the previous cards must not land after this batch.
    [childrenStats.value, skipRequests.value, homeworkRequests.value, completionRequests.value] = result;
    loadedDate = date;
    dashboardLoaded.value = true;
  } catch (err) {
    if (!current()) return;
    console.error('Failed to load parent dashboard:', err);
    dashboardError.value = '暂时无法加载孩子的进展，请重新加载。';
  } finally {
    if (serial === dashboardSerial) { loading.value = false; pendingDate = null; }
  }
}
watch(() => [calendar.today, calendar.ready], reloadDashboardDay);
onMounted(loadDashboard);
</script>
