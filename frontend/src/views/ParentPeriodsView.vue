<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <!-- Title & Actions Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4 [&>*:last-child]:whitespace-nowrap">
        <div>
          <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <span>🏖️</span>
            <span>假期与长期任务</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            为每个孩子添加需要多天完成的长期任务（如读完一本书），设置节假日和寒暑假及假期中继续的日常任务
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <router-link to="/parent/tasks" class="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
            📝 日常任务模板
          </router-link>
          <button
            type="button"
            :disabled="!selectedChild"
            @click="openTaskModal(null)"
            class="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-xs shadow-button active:scale-95 transition-all disabled:opacity-50"
          >
            <span>📚</span>
            <span>新增长期任务</span>
          </button>
          <button
            type="button"
            :disabled="!selectedChild"
            @click="openPeriodModal()"
            class="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs shadow-button active:scale-95 transition-all disabled:opacity-50"
          >
            <span>➕</span>
            <span>新增假期</span>
          </button>
        </div>
      </div>

      <!-- Child Selector -->
      <div class="flex flex-wrap gap-2 mb-5">
        <button
          v-for="child in children"
          :key="child.id"
          type="button"
          @click="selectChild(child)"
          class="px-4 py-2 rounded-xl text-sm font-bold border transition-all font-chinese"
          :class="selectedChild?.id === child.id ? 'bg-brand-500 border-brand-500 text-white shadow-button' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'"
        >
          {{ child.avatar_emoji }} {{ child.name }}
        </button>
      </div>

      <p v-if="error" class="mb-4 px-4 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 text-xs font-bold">{{ error }}</p>

      <div v-if="loading" class="text-center py-20 text-brand-500 dark:text-brand-400 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在加载...
      </div>

      <section v-if="!loading" class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mb-5">
        <h3 class="text-lg font-black text-slate-800 dark:text-slate-100 mb-3">📚 长期任务</h3>
        <p v-if="!standaloneGoals.length" class="text-xs font-bold text-slate-400 py-2">还没有长期任务。例如“读完《西游记》共 200 页，每天记录读到第几页”。</p>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <GoalAdminCard
            v-for="task in standaloneGoals"
            :key="task.id"
            :task="task"
            @backfill="openBackfill"
            @edit="openTaskModal(null, $event)"
            @remove="removeTask"
            @remove-log="removeLog"
          />
        </div>
      </section>

      <h3 v-if="!loading" class="text-lg font-black text-slate-800 dark:text-slate-100 mb-3">🏖️ 假期</h3>
      <div v-if="loading"></div>
      <div v-else-if="!periods.length" class="text-center py-12 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700">
        <div class="text-5xl mb-3">🏖️</div>
        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">还没有假期安排</h3>
        <p class="text-xs text-slate-400">点击“新增假期”，例如寒假 1/20 – 2/25</p>
      </div>

      <div v-else class="space-y-5">
        <section
          v-for="period in periods"
          :key="period.id"
          class="bg-white dark:bg-slate-900 rounded-3xl p-5 border shadow-card"
          :class="period.status === 'ended' ? 'border-slate-200 dark:border-slate-700 opacity-75' : 'border-slate-200/80 dark:border-slate-700/80'"
        >
          <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <h3 class="text-lg font-black text-slate-800 dark:text-slate-100 flex items-center gap-2 font-chinese">
                {{ period.name }}
                <span class="px-2 py-0.5 rounded-lg text-xs font-black" :class="statusInfo[period.status].class">{{ statusInfo[period.status].label }}</span>
              </h3>
              <p class="text-xs font-bold text-slate-400 mt-0.5">{{ period.start_date }} 至 {{ period.end_date }} · 共 {{ period.days_total }} 天</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button type="button" @click="openTaskModal(period)" class="px-3.5 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-bold text-xs">➕ 假期任务</button>
              <button type="button" @click="openPeriodModal(period)" class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs">✏️ 编辑</button>
              <button type="button" @click="removePeriod(period)" class="px-3 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-bold text-xs">删除</button>
            </div>
          </div>

          <div class="mb-3 text-xs font-bold text-slate-500 dark:text-slate-400">
            <span class="text-slate-400">假期中暂停的日常任务：</span>
            <span v-if="!period.paused_template_ids.length" class="text-emerald-600 dark:text-emerald-300">无，日常任务照常进行</span>
            <span v-for="id in period.paused_template_ids" :key="id" class="inline-block mr-1.5 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-chinese">
              {{ templateTitle(id) }}
            </span>
          </div>

          <p v-if="!period.tasks.length" class="text-xs font-bold text-slate-400 py-2">还没有假期任务，可添加“寒假作业 共 40 页”或“读完一本书”。</p>
          <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GoalAdminCard
              v-for="task in period.tasks"
              :key="task.id"
              :task="task"
              @backfill="openBackfill"
              @edit="openTaskModal(period, $event)"
              @remove="removeTask"
              @remove-log="removeLog"
            />
          </div>
        </section>
      </div>

      <!-- Make-up school days (调休上学日): school on a weekend or holiday, following another weekday -->
      <section v-if="!loading && selectedChild" class="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-700/80 shadow-card mt-5">
        <h3 class="text-lg font-black text-slate-800 dark:text-slate-100 mb-1">🔁 调休上学日</h3>
        <p class="text-xs font-bold text-slate-400 mb-3">比如国庆调休的周六要上学：这天按所选星期几生成日常任务、显示课程表，假期里暂停的任务这天也照常；“放假前可以补完”的任务也按它来算假期从哪天结束。只能设置今天及以后的日期，过去的不能删除</p>
        <form class="flex flex-wrap items-end gap-2 mb-3" @submit.prevent="addMakeupDay">
          <div>
            <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">日期</label>
            <input v-model="makeupForm.date" type="date" required :min="localToday()" class="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">按周几上课</label>
            <select v-model.number="makeupForm.acts_as" class="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900 outline-none focus:border-brand-500">
              <option v-for="day in [1, 2, 3, 4, 5, 6, 0]" :key="day" :value="day">{{ ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][day] }}</option>
            </select>
          </div>
          <div class="flex-1 min-w-[140px]">
            <label class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">备注（可不填）</label>
            <input v-model="makeupForm.note" type="text" maxlength="30" placeholder="例如：国庆调休" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500 font-chinese" />
          </div>
          <label v-if="children.length > 1" class="flex items-center gap-1.5 py-2 text-xs font-bold text-slate-600 dark:text-slate-300">
            <input v-model="makeupForm.allChildren" type="checkbox" class="w-4 h-4 accent-brand-500" /> 所有孩子都加
          </label>
          <button type="submit" :disabled="saving || !makeupForm.date" class="px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold disabled:opacity-50">➕ 添加</button>
        </form>
        <p v-if="!makeupDays.length" class="text-xs font-bold text-slate-400">还没有调休上学日</p>
        <ul v-else class="flex flex-wrap gap-2">
          <li v-for="item in makeupDays" :key="item.id" class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 font-chinese">
            <span>{{ item.date }}（{{ weekdayName(item.date) }}）按{{ ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][item.acts_as] }}上课</span>
            <span v-if="item.note" class="text-slate-400">{{ item.note }}</span>
            <button v-if="item.date >= localToday()" type="button" class="text-slate-300 hover:text-rose-500 dark:hover:text-rose-400" title="删除" @click="removeMakeupDay(item)">✕</button>
          </li>
        </ul>
      </section>
    </main>

    <!-- Period Modal -->
    <div v-if="periodModal" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="periodModal = null">
      <form class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border-2 border-brand-100 dark:border-brand-800 space-y-4" @submit.prevent="savePeriod">
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100">{{ periodModal.id ? '✏️ 编辑假期' : `➕ 为${selectedChild.name}新增假期` }}</h3>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">假期名称</label>
          <input v-model="periodModal.name" type="text" maxlength="30" required placeholder="例如：寒假" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 outline-none font-chinese" />
          <div class="flex gap-1.5 mt-2">
            <button v-for="name in ['国庆假期', '寒假', '春节', '五一假期', '暑假']" :key="name" type="button" class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-brand-900/40" @click="periodModal.name = name">{{ name }}</button>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">开始日期</label>
            <input v-model="periodModal.start_date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">结束日期</label>
            <input v-model="periodModal.end_date" type="date" required :min="periodModal.start_date" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">假期中继续的日常 / 每周任务</label>
          <p v-if="!childTemplates.length" class="text-xs text-slate-400">这个孩子还没有日常任务。</p>
          <div class="space-y-1.5">
            <label v-for="tmpl in childTemplates" :key="tmpl.id" class="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-700 dark:text-slate-200 cursor-pointer font-chinese">
              <input type="checkbox" :checked="!periodModal.paused.includes(tmpl.id)" @change="togglePaused(tmpl.id)" class="w-4 h-4 accent-brand-500" />
              <span>{{ tmpl.title }}</span>
              <span class="ml-auto text-xs text-slate-400">{{ tmpl.schedule_type === 'weekly_times' ? `每周${tmpl.weekly_target_times}次` : '按星期' }}</span>
            </label>
          </div>
          <p class="text-xs text-slate-400 mt-1.5">不勾选的任务在假期中暂停，不生成、不计入完成度，也不影响连续打卡。</p>
        </div>
        <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="periodModal = null">取消</button>
          <button type="submit" :disabled="saving" class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">{{ saving ? '保存中...' : '确认保存' }}</button>
        </div>
      </form>
    </div>

    <!-- Period Task Modal -->
    <div v-if="taskModal" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="taskModal = null">
      <form class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl border-2 border-brand-100 dark:border-brand-800 space-y-4" @submit.prevent="saveTask">
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100">
          {{ taskModal.id ? '✏️ 编辑' : '➕ 添加' }}{{ taskModal.periodId ? '假期任务' : '长期任务' }}
        </h3>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">任务名称</label>
          <input v-model="taskModal.title" type="text" maxlength="50" required placeholder="例如：寒假作业、读完《西游记》" class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 outline-none font-chinese" />
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">所属学科</label>
          <div class="grid grid-cols-4 gap-2">
            <button v-for="sub in ['语文', '数学', '英语', '其他']" :key="sub" type="button" @click="taskModal.subject = sub" class="py-2 rounded-xl text-xs font-bold border font-chinese" :class="taskModal.subject === sub ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'">{{ sub }}</button>
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">完成方式</label>
          <div class="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
            <button type="button" :disabled="taskModal.locked" @click="taskModal.mode = 'progress'" class="py-2 rounded-xl text-xs font-bold disabled:cursor-not-allowed" :class="taskModal.mode === 'progress' ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-sm font-black' : 'text-slate-500 dark:text-slate-400'">📊 按总量记录进度</button>
            <button type="button" :disabled="taskModal.locked" @click="taskModal.mode = 'check'" class="py-2 rounded-xl text-xs font-bold disabled:cursor-not-allowed" :class="taskModal.mode === 'check' ? 'bg-white dark:bg-slate-900 text-sky-700 dark:text-sky-300 shadow-sm font-black' : 'text-slate-500 dark:text-slate-400'">✅ 完成后打勾</button>
          </div>
          <p v-if="taskModal.locked" class="text-xs text-slate-400 mt-1">已有进度记录，不能更改完成方式。</p>
        </div>
        <div v-if="taskModal.mode === 'progress'" class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">总量</label>
            <input v-model.number="taskModal.total_amount" type="number" min="1" max="100000" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">单位</label>
            <input v-model="taskModal.unit" type="text" maxlength="10" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" />
            <div class="flex gap-1 mt-1.5">
              <button v-for="unit in ['页', '篇', '次', '本', '课']" :key="unit" type="button" class="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300" @click="taskModal.unit = unit">{{ unit }}</button>
            </div>
          </div>
        </div>
        <div v-if="taskModal.mode === 'progress'">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">孩子怎么记录</label>
          <div class="grid grid-cols-2 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
            <button type="button" @click="taskModal.input_mode = 'position'" class="py-2 rounded-xl text-xs font-bold" :class="taskModal.input_mode === 'position' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm font-black' : 'text-slate-500 dark:text-slate-400'">📖 读到第几{{ taskModal.unit || '页' }}</button>
            <button type="button" @click="taskModal.input_mode = 'increment'" class="py-2 rounded-xl text-xs font-bold" :class="taskModal.input_mode === 'increment' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm font-black' : 'text-slate-500 dark:text-slate-400'">➕ 今天完成了多少</button>
          </div>
        </div>
        <div v-if="!taskModal.periodId" class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">开始日期</label>
            <input v-model="taskModal.start_date" type="date" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">截止日期（可不填）</label>
            <input v-model="taskModal.end_date" type="date" :min="taskModal.start_date" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none focus:border-brand-500" />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">{{ taskModal.mode === 'progress' ? `每${taskModal.unit || '单位'}奖励积分` : '完成奖励积分' }}</label>
            <input v-model.number="taskModal.points" type="number" min="0" max="10000" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" />
          </div>
          <div v-if="taskModal.mode === 'progress'">
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">全部完成再奖励</label>
            <input v-model.number="taskModal.completion_bonus" type="number" min="0" max="100000" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:border-brand-500" />
          </div>
        </div>
        <p v-if="taskModal.mode === 'progress' && taskModal.total_amount" class="-mt-2 text-xs font-bold text-slate-400">
          全部完成共 {{ (taskModal.points || 0) * taskModal.total_amount + (taskModal.completion_bonus || 0) }} 分
        </p>
        <label class="flex items-start gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer">
          <input v-model="taskModal.daily_required" type="checkbox" class="mt-0.5 w-4 h-4 accent-brand-500" />
          <span>
            <span class="block text-xs font-bold text-slate-700 dark:text-slate-200">每天要记录</span>
            <span class="block text-xs text-slate-400">勾选后它成为每天的必做项，当天记录一次进度才算全勤</span>
          </span>
        </label>
        <TimingFields v-model:track-time="taskModal.track_time" v-model:expected-minutes="taskModal.expected_minutes" />
        <div class="flex justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
          <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="taskModal = null">取消</button>
          <button type="submit" :disabled="saving" class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50">{{ saving ? '保存中...' : '确认保存' }}</button>
        </div>
      </form>
    </div>

    <!-- Backfill Modal -->
    <div v-if="backfill" class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in" @click.self="backfill = null">
      <form class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-sm w-full shadow-2xl border-2 border-brand-100 dark:border-brand-800 space-y-4" @submit.prevent="saveBackfill">
        <h3 class="text-lg font-black text-slate-800 dark:text-slate-100 font-chinese">补记「{{ backfill.task.title }}」</h3>
        <div class="grid grid-cols-2 gap-3">
          <div v-if="backfill.task.mode === 'progress' && backfill.task.input_mode === 'position'">
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">读到第几{{ backfill.task.unit }}</label>
            <input v-model.number="backfill.position" type="number" :min="backfill.task.done_amount + 1" :max="backfill.task.total_amount" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none" />
          </div>
          <div v-else-if="backfill.task.mode === 'progress'">
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">数量（{{ backfill.task.unit }}）</label>
            <input v-model.number="backfill.amount" type="number" min="1" :max="backfill.task.remaining_amount" required class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">日期</label>
            <input v-model="backfill.date" type="date" required :min="backfill.task.start_date" :max="backfill.maxDate" class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm outline-none" />
          </div>
        </div>
        <div class="flex justify-end gap-3">
          <button type="button" class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" @click="backfill = null">取消</button>
          <button type="submit" :disabled="saving" class="px-6 py-2.5 rounded-xl bg-brand-500 text-white text-xs font-bold disabled:opacity-50">补记</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { useCalendarStore } from '../stores/calendar';
import { businessDate } from '../utils/businessDate.js';
import { confirmAction } from '../utils/confirmation';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import GoalAdminCard from '../components/GoalAdminCard.vue';
import TimingFields from '../components/TimingFields.vue';
const calendar = useCalendarStore();

const children = ref([]);
const templates = ref([]);
const selectedChild = ref(null);
const periods = ref([]);
const goals = ref([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const periodModal = ref(null);
const makeupDays = ref([]);
const makeupForm = ref({ date: '', acts_as: 1, note: '', allChildren: true });
const weekdayName = date => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(`${date}T00:00:00Z`).getUTCDay()];
const taskModal = ref(null);
const backfill = ref(null);

const statusInfo = {
  active: { label: '进行中', class: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  upcoming: { label: '未开始', class: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' },
  ended: { label: '已结束', class: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400' }
};

const standaloneGoals = computed(() => goals.value.filter(goal => !goal.period_id));
const childTemplates = computed(() => templates.value.filter(t => t.child_ids === null || t.child_ids?.includes(selectedChild.value?.id)));

const localToday = () => businessDate(Date.now(), calendar.timeZone);

onMounted(async () => {
  try {
    [children.value, templates.value] = await Promise.all([api.getChildren(), api.getTaskTemplates()]);
    if (children.value.length) await selectChild(children.value[0]);
  } catch (err) {
    showError(err);
  } finally {
    loading.value = false;
  }
});

function showError(err) {
  error.value = typeof err === 'string' ? err : '操作失败，请重试';
}

async function selectChild(child) {
  selectedChild.value = child;
  await loadPeriods();
}

async function loadPeriods() {
  if (!selectedChild.value) return;
  try {
    [periods.value, goals.value, makeupDays.value] = await Promise.all([api.getChildPeriods(selectedChild.value.id), api.getChildGoals(selectedChild.value.id),
      api.getMakeupDays(selectedChild.value.id)]);
  } catch (err) {
    showError(err);
  }
}

// Make-up days are per child; siblings at the same school usually share them, so they can be
// added for everyone at once (a child who already has that day keeps it).
async function addMakeupDay() {
  const { date, acts_as, note, allChildren } = makeupForm.value;
  const applyAll = allChildren && children.value.length > 1;
  const targets = applyAll ? children.value : [selectedChild.value];
  const ok = await run(async () => {
    for (const child of targets) {
      if (applyAll && (await api.getMakeupDays(child.id)).some(day => day.date === date)) continue;
      await api.createMakeupDay(child.id, { date, acts_as, note: note || null });
    }
  });
  if (ok) makeupForm.value = { ...makeupForm.value, date: '', note: '' };
}

async function removeMakeupDay(item) {
  if (!await confirmAction(`确定删除 ${item.date} 这个调休上学日吗？`)) return;
  run(() => api.deleteMakeupDay(item.id));
}

function templateTitle(id) {
  return templates.value.find(t => t.id === id)?.title || '已删除的任务';
}

async function run(action) {
  saving.value = true;
  error.value = '';
  try {
    await action();
    await loadPeriods();
    return true;
  } catch (err) {
    showError(err);
    return false;
  } finally {
    saving.value = false;
  }
}

function openPeriodModal(period = null) {
  periodModal.value = period
    ? { id: period.id, name: period.name, start_date: period.start_date, end_date: period.end_date, paused: [...period.paused_template_ids] }
    : { id: null, name: '', start_date: localToday(), end_date: localToday(), paused: [] };
}

function togglePaused(id) {
  const paused = periodModal.value.paused;
  periodModal.value.paused = paused.includes(id) ? paused.filter(p => p !== id) : [...paused, id];
}

async function savePeriod() {
  const { id, name, start_date, end_date, paused } = periodModal.value;
  const payload = { name, start_date, end_date, paused_template_ids: paused };
  if (await run(() => (id ? api.updatePeriod(id, payload) : api.createPeriod(selectedChild.value.id, payload)))) periodModal.value = null;
}

async function removePeriod(period) {
  if (!await confirmAction(`确定删除「${period.name}」吗？其中的假期任务和进度记录会一起删除，孩子已获得的积分保留。`)) return;
  run(() => api.deletePeriod(period.id));
}

// period is null for a standalone long-term task (own dates); holiday tasks follow their period.
function openTaskModal(period, task = null) {
  const periodId = period?.id ?? task?.period_id ?? null;
  taskModal.value = task
    ? { id: task.id, periodId, title: task.title, subject: task.subject, mode: task.mode, input_mode: task.input_mode, total_amount: task.total_amount,
        unit: task.unit || '页', points: task.points, completion_bonus: task.completion_bonus, daily_required: task.daily_required,
        track_time: task.track_time, expected_minutes: task.expected_minutes,
        start_date: task.start_date, end_date: task.end_date || '', locked: task.logs.length > 0 }
    : periodId
      ? { id: null, periodId, title: '', subject: '语文', mode: 'progress', input_mode: 'increment', total_amount: 40, unit: '页', points: 2,
          completion_bonus: 0, daily_required: false, track_time: false, expected_minutes: null, locked: false }
      : { id: null, periodId: null, title: '', subject: '语文', mode: 'progress', input_mode: 'position', total_amount: 200, unit: '页', points: 0,
          completion_bonus: 50, daily_required: true, track_time: false, expected_minutes: null, start_date: localToday(), end_date: '', locked: false };
}

async function saveTask() {
  const { id, periodId, title, subject, mode, input_mode, total_amount, unit, points, completion_bonus, daily_required, track_time, expected_minutes, start_date, end_date } = taskModal.value;
  const payload = { title, subject, mode, input_mode, total_amount, unit, points: points || 0, completion_bonus: completion_bonus || 0, daily_required,
    track_time, expected_minutes: track_time ? expected_minutes : null };
  if (!periodId) Object.assign(payload, { start_date, end_date: end_date || null });
  const save = () => id ? api.updatePeriodTask(id, payload)
    : periodId ? api.createPeriodTask(periodId, payload) : api.createGoal(selectedChild.value.id, payload);
  if (await run(save)) taskModal.value = null;
}

async function removeTask(task) {
  if (!await confirmAction(`确定删除「${task.title}」吗？进度记录会一起删除，孩子已获得的积分保留。`)) return;
  run(() => api.deletePeriodTask(task.id));
}

function openBackfill(task) {
  const today = localToday();
  const maxDate = task.end_date && task.end_date < today ? task.end_date : today;
  backfill.value = { task, attempt: {}, amount: 1, position: task.done_amount + 1, date: maxDate, maxDate };
}

const closeRestoredForm = () => { backfill.value = null; };
onMounted(() => window.addEventListener('taskie:data-restored', closeRestoredForm));
onBeforeUnmount(() => window.removeEventListener('taskie:data-restored', closeRestoredForm));
onMounted(() => window.addEventListener('taskie:write-confirmed', loadPeriods));
onBeforeUnmount(() => window.removeEventListener('taskie:write-confirmed', loadPeriods));
async function saveBackfill() {
  const { task, amount, position, date, attempt } = backfill.value;
  const payload = task.input_mode === 'position' ? { position, date } : { amount, date };
  if (await run(() => api.logPeriodProgress(task.id, payload, { childId: selectedChild.value.id, childName: selectedChild.value.name, title: task.title, backfill: true, attempt }))) {
    backfill.value = null;
  }
}

async function removeLog(entry) {
  if (!await confirmAction('确定删除这条进度记录吗？对应的积分会扣回。')) return;
  run(() => api.deletePeriodLog(entry.id));
}
</script>
