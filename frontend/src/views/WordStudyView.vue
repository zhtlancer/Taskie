<template>
  <div class="min-h-screen bg-[var(--ui-page)] px-4 py-5 pb-24">
    <main class="max-w-4xl mx-auto space-y-5">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-xl font-black text-slate-800 dark:text-slate-100">{{ language === 'en' ? '🔤 英语背单词' : '📚 字词学习' }}</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">先回忆，再核对；每天达标后还可以自愿多学。</p>
        </div>
        <div class="flex flex-wrap items-center gap-2 text-sm font-bold [&>a]:inline-flex [&>a]:items-center [&>a]:min-h-[44px] [&>button]:min-h-[44px] text-brand-600 dark:text-brand-300">
          <div class="inline-flex rounded-xl bg-slate-200/70 dark:bg-slate-800 p-1" role="tablist" aria-label="学习语言切换">
            <button
              type="button"
              role="tab"
              :disabled="busy || loading || refreshing || Boolean(active)"
              :aria-selected="language === 'zh'"
              class="min-h-11 min-w-11 px-3 py-1 rounded-lg text-xs font-black transition-all"
              :class="language === 'zh' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-300 shadow-xs' : 'text-slate-600 dark:text-slate-300'"
              @click="switchLanguage('zh')"
            >
              语文字词
            </button>
            <button
              type="button"
              role="tab"
              :disabled="busy || loading || refreshing || Boolean(active)"
              :aria-selected="language === 'en'"
              class="min-h-11 min-w-11 px-3 py-1 rounded-lg text-xs font-black transition-all"
              :class="language === 'en' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-300 shadow-xs' : 'text-slate-600 dark:text-slate-300'"
              @click="switchLanguage('en')"
            >
              英语单词
            </button>
          </div>
          <router-link :to="`/child/${childId}/characters?lang=${language}`">{{ language === 'en' ? '英语单词本' : '生字生词本' }}</router-link>
          <router-link :to="`/child/${childId}/today`">今日看板</router-link>
          <button :disabled="busy || loading || refreshing || active || !calendar.ready" @click="() => refresh()">刷新安排</button>
          <router-link v-if="asParent" :to="{ path: '/parent/word-plans', query: { child: childId } }">管理字词计划</router-link>
        </div>
      </header>
      <p v-if="hasOverview && language === 'en' && missingDefinitionCount > 0" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs font-bold text-amber-800 dark:text-amber-200">
        有 {{ missingDefinitionCount }} 个缺少释义的单词暂未纳入英语学习池，可在“英语单词本”补充释义。
      </p>
      <p v-if="error" role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ error }}</p>
      <p v-if="notice" role="status" class="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
      <PageState v-if="!calendar.ready" :kind="calendar.error ? 'error' : 'loading'" :title="calendar.error ? '家庭日期未能确认' : '正在确认家庭日期…'" :description="calendar.error" :busy="calendar.loading" @retry="calendar.load({ force: true })" />
      <PageState v-else-if="studyReadError && !hasOverview" kind="error" title="学习清单未能读取" :description="studyReadError" :busy="loading" @retry="() => refresh()" />
      <p v-else-if="loading" role="status" class="text-center py-12 text-brand-600 dark:text-brand-300">正在安排学习…</p>
      <div v-if="calendar.ready && hasOverview && (refreshing || studyReadError)" data-study-refresh :role="studyReadError ? 'alert' : 'status'" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm" :class="studyReadError ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
        <span>{{ refreshing ? '正在更新学习清单，当前显示上次读取的数据。' : `更新未成功，当前显示上次读取的数据。${studyReadError}` }}</span>
        <button v-if="studyReadError" type="button" :disabled="refreshing || busy || Boolean(active)" class="ui-button-secondary" @click="() => refresh()">重新读取清单</button>
      </div>
      <div v-if="selectedSkill" data-study-skill-filter class="rounded-xl border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/30 p-3 flex flex-wrap items-center justify-between gap-2 text-sm text-brand-700 dark:text-brand-300">
        <span>当前查看：{{ skillName(selectedSkill) }}</span>
        <button type="button" :disabled="busy || Boolean(active)" class="ui-button-secondary" @click="showAllSkills">查看全部技能</button>
      </div>

      <template v-if="calendar.ready && hasOverview">
        <section v-if="!visibleDays.length" data-study-empty class="bg-white dark:bg-slate-900 border rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400">
          今天没有{{ selectedSkill ? skillName(selectedSkill) : '' }}基础学习清单：可能还未开启计划、今天不是学习日，或当前没有需要新学/复习的字词。
          <p v-if="!asParent" class="mt-2">可以请家长在“学习安排 → 字词计划”中开启自动学习。</p>
        </section>
        <section v-for="day in visibleDays" :key="day.id" :data-study-day-skill="day.skill" class="bg-white dark:bg-slate-900 border rounded-2xl p-4 space-y-3">
          <div class="flex justify-between gap-3"><h2 class="font-black text-slate-800 dark:text-slate-100">{{ day.title }}</h2><span class="text-xs font-bold" :class="day.base_done ? 'text-emerald-600 dark:text-emerald-300' : 'text-brand-600 dark:text-brand-300'">{{ day.base_done ? '基础目标已完成 ✓' : `基础目标 ${day.base_completed}/${day.base_total}` }}</span></div>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ day.date }} · {{ skillName(day.skill) }}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ day.required ? '每日必做' : '可选学习' }} · 新学 {{ baseCount(day, 'new') }} 项，复习 {{ baseCount(day, 'review') }} 项 · 基础完成 +{{ day.points }} 分</p>
          <p class="text-xs text-amber-700 dark:text-amber-300">基础清单以外：还有 {{ day.remaining_due }} 项到期复习、{{ day.remaining_new }} 项待新学。达标不代表已复习完全部内容。</p>
          <button v-if="day.batches.some(batch => !batch.completed_at)" :disabled="busy" class="w-full min-h-[48px] rounded-xl bg-brand-500 text-white font-bold disabled:opacity-50" @click="begin(day, day.batches.find(batch => !batch.completed_at))">开始 / 继续学习 →</button>
          <div v-for="batch in day.batches" :key="batch.id" class="rounded-xl border p-3" :class="batch.is_extra ? 'bg-violet-50/50 dark:bg-violet-950/40 border-violet-100 dark:border-violet-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700'">
            <div class="flex justify-between gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
              <span>{{ batch.is_extra ? '✨ 自愿追加' : '🎯 基础学习' }} · {{ batch.items.filter(item => item.result).length }}/{{ batch.items.length }} 项</span>
              <span v-if="batch.completed_at">已完成 · +{{ batch.points }} 分</span>
              <button v-else :disabled="busy" class="min-h-[44px] px-2 text-brand-600 dark:text-brand-300" @click="begin(day, batch)">开始 / 继续 →</button>
            </div>
            <details class="mt-2"><summary class="min-h-[44px] py-3 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">查看字词清单与练习结果</summary><div class="flex flex-wrap gap-2">
              <button v-for="(item, idx) in batch.items" :key="item.id" :disabled="busy" class="min-h-[44px] px-3 py-2 rounded-lg border text-xs" :class="item.result === 'good' ? 'text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : item.result ? 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'" @click="openItem(day, batch, item)">{{ day.language === 'en' && day.skill === 'write' && !item.result ? `待默写 #${idx + 1}` : item.text }} · {{ resultName(item.result) }}</button>
            </div></details>
          </div>
          <p v-if="day.remaining_early" class="text-xs text-slate-400">还有 {{ day.remaining_early }} 项可提前巩固，答对不会跳过原定复习阶段。</p>
          <div v-if="day.base_done" class="flex flex-wrap items-center gap-3">
            <button v-if="!day.batches.some(batch => !batch.completed_at)" :disabled="busy || !(day.remaining_due + day.remaining_new + day.remaining_early)" class="min-h-[44px] px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold disabled:opacity-50" @click="extra(day)">继续学习一小组</button>
            <span class="text-xs text-slate-400">额外奖励 {{ day.extra_rewarded }}/{{ day.extra_reward_limit }} 组 · 自愿完成，不改变全勤和连续打卡</span>
          </div>
        </section>
      </template>
      <div v-if="calendar.ready" data-study-history class="space-y-2">
        <div v-if="historyLoading || historyError" :role="historyError ? 'alert' : 'status'" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs" :class="historyError ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
          <span>{{ historyLoading ? (hasHistory ? '正在更新学习记录，当前显示上次读取的数据。' : '正在读取学习记录…') : `${historyError}${hasHistory ? ' 当前显示上次读取的数据。' : ''}` }}</span>
          <button v-if="historyError" type="button" :disabled="historyLoading" class="ui-button-secondary" @click="refreshHistory">重新读取记录</button>
        </div>
        <details v-if="hasHistory && visibleHistory.length" class="rounded-2xl bg-white dark:bg-slate-900 border p-4">
          <summary class="font-bold text-slate-800 dark:text-slate-100 min-h-[44px] py-3 cursor-pointer">最近学习记录</summary>
          <ul class="space-y-2 text-xs text-slate-500 dark:text-slate-400"><li v-for="entry in visibleHistory" :key="entry.id">{{ entry.date }} · {{ skillName(entry.skill) }} · 基础 {{ entry.base_completed }}/{{ entry.base_total }} 项 · 额外 {{ entry.extra_completed }} 项 · {{ entry.needs_practice }} 项还需练习</li></ul>
        </details>
        <p v-else-if="hasHistory && !historyLoading && !historyError" class="text-xs text-slate-500 dark:text-slate-400">暂无{{ selectedSkill ? skillName(selectedSkill) : '' }}学习记录。</p>
      </div>
    </main>

    <UiDialog v-if="active" :title="`${skillName(active.skill)}练习 · ${active.item.is_early ? '提前巩固（不升级周期）' : active.item.kind === 'review' ? '复习' : '新学'}`" :busy="busy" close-label="关闭练习" @close="closePractice">
      <div class="space-y-4 text-center">
        <div v-if="expiredPractice" role="status" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200 space-y-2">
          <p>已经到新的一天，昨天的清单不能再记录了。请换成今天的清单继续练习。</p>
          <button :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl bg-brand-500 text-white font-bold disabled:opacity-50" @click="switchToToday">换成今天的清单</button>
        </div>
        <p v-else-if="dayChanged" role="status" class="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-sm text-amber-800 dark:text-amber-200">已经到新的一天，这次练习结束后会换成今天的清单</p>
        <p class="text-xs text-slate-500 dark:text-slate-400">
          <template v-if="active.language === 'en'">
            {{ active.skill === 'write' ? '看中文释义或听发音，在下方输入英语拼写并核对。' : '先看单词与音标回忆中文释义，再揭晓核对。' }}
          </template>
          <template v-else>
            {{ active.skill === 'write' ? '先听词或看拼音，在纸上默写，再核对字形与笔顺。' : '先尝试读出字词，再揭晓拼音核对。' }}
          </template>
        </p>

        <!-- English Practice Mode -->
        <template v-if="active.language === 'en'">
          <div v-if="active.skill === 'recognize' || revealed" class="text-4xl font-black text-slate-900 dark:text-slate-100 break-words [overflow-wrap:anywhere]">
            {{ active.item.text }}
          </div>
          <div v-if="active.item.phonetic" class="text-base font-mono text-cyan-700 dark:text-cyan-300">
            /{{ active.item.phonetic }}/
          </div>

          <div v-if="englishAudio.length" class="flex flex-wrap justify-center gap-2">
            <button
              v-for="clip in englishAudio"
              :key="clip.id"
              type="button"
              class="min-h-[44px] px-4 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-sm font-bold border border-sky-200 dark:border-sky-800"
              @click="playEnglishClip(clip.url)"
            >
              🔊 {{ clip.label }}
            </button>
          </div>
          <p v-if="!englishAudio.length" class="text-xs text-slate-500 dark:text-slate-400">{{ active.item.audio_refs == null ? '旧清单未保存发音，不自动替换为当前读音。' : '本项未保存学习发音，可以继续文字练习。' }}</p>
          <button v-if="active.item.audio_refs == null" type="button" :disabled="currentAudioLoading" class="ui-button-secondary min-h-11" @click="loadCurrentEnglishAudio">{{ currentAudioLoading ? '查询中…' : '查看当前词典发音（非历史发音）' }}</button>
          <EnglishPronunciations v-if="currentAudioMatch" :groups="currentAudioMatch.pronunciations || []" :fallback="currentAudioMatch.audio || []" @play="playEnglishClip" />
          <p v-if="englishAudioError" class="text-xs font-bold text-amber-700 dark:text-amber-300">{{ englishAudioError }}</p>

          <div v-if="active.skill === 'write' || revealed" class="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3.5 text-sm space-y-1">
            <p v-if="active.item.meaning_zh" class="font-bold text-slate-800 dark:text-slate-100">{{ active.item.meaning_zh }}</p>
            <p v-if="active.item.meaning_en" class="text-xs text-slate-600 dark:text-slate-300">{{ active.item.meaning_en }}</p>
          </div>

          <!-- English Spelling Input (write skill) -->
          <div v-if="active.skill === 'write' && !revealed" class="space-y-3">
            <p v-if="active.item.strict_case" class="text-xs font-bold text-amber-700 dark:text-amber-300">本项严格区分大小写，请按标准形式拼写。</p>
            <form class="space-y-2.5" @submit.prevent="checkEnglishSpelling">
              <input
                v-model="typedSpelling"
                type="text"
                autofocus
                autocapitalize="off"
                autocomplete="off"
                autocorrect="off"
                spellcheck="false"
                placeholder="在此输入英文拼写…"
                class="w-full max-w-sm mx-auto block min-h-12 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-center text-lg font-black text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <div class="flex flex-wrap justify-center gap-2">
                <button
                  type="submit"
                  :disabled="!typedSpelling.trim()"
                  class="min-h-[44px] px-5 py-2.5 rounded-xl bg-brand-500 text-white text-sm font-black disabled:opacity-50"
                >
                  核对拼写
                </button>
                <button
                  type="button"
                  class="min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-bold"
                  @click="revealed = true"
                >
                  看提示/直接揭晓
                </button>
              </div>
            </form>
          </div>

          <button v-else-if="!revealed" class="block mx-auto min-h-[44px] px-5 py-3 rounded-xl bg-brand-500 text-white font-bold" @click="revealed = true">
            我已回忆，揭晓释义
          </button>

          <template v-else>
            <div v-if="spellingCheck" class="rounded-xl p-3 text-sm font-bold" :class="spellingCheck.is_correct ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-200 border border-rose-200 dark:border-rose-800'">
              <p v-if="spellingCheck.is_correct">
                ✅ 拼写正确！
                <span v-if="!spellingCheck.exact_case" class="block text-xs mt-1 font-normal">提示：标准大小写为 “{{ active.item.text }}”</span>
              </p>
              <p v-else>
                ❌ 你输入的是 “{{ spellingCheck.normalized_typed }}”，正确拼写是 “{{ active.item.text }}”
              </p>
            </div>

            <div v-if="!feedbackResult && !expiredPractice" class="flex flex-wrap justify-center gap-2">
              <button v-if="uncertainAttempt" :disabled="busy" class="p-3 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50" @click="grade(pendingAttempt.result)">重试确认这次练习</button>
              <template v-else>
                <button :disabled="busy" class="min-h-[44px] p-3 rounded-xl bg-emerald-500 text-white text-sm font-bold disabled:opacity-50" @click="grade('good')">
                  {{ active.skill === 'write' && spellingCheck?.is_correct ? '提交：独立拼对' : '独立完成' }}
                </button>
                <button :disabled="busy" class="min-h-[44px] p-3 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-sm font-bold disabled:opacity-50" @click="grade('hinted')">提示后完成</button>
                <button :disabled="busy" class="min-h-[44px] p-3 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm font-bold disabled:opacity-50" @click="grade('again')">还不熟</button>
              </template>
            </div>
            <div v-else-if="feedbackResult" class="space-y-3">
              <p v-if="confirmedAttempt" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">这次练习已经记下了</p>
              <p v-if="nextDue" class="text-xs text-brand-600 dark:text-brand-300">下次复习：{{ nextDue }}</p>
              <p class="text-sm text-emerald-700 dark:text-emerald-300">已记录“{{ resultName(feedbackResult) }}”。同日再练不会重复加分或连续升级。</p>
              <button :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold mr-2 disabled:opacity-50" @click="resetPracticeTry">再练一次</button>
              <button :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50" @click="nextItem">下一项 / 返回清单</button>
            </div>
          </template>
        </template>

        <!-- Chinese Practice Mode (existing unchanged flow) -->
        <template v-else>
        <p v-if="false"></p>
        <div v-if="active.skill === 'recognize' || revealed" class="text-4xl font-reading text-slate-800 dark:text-slate-100">{{ active.item.text }}</div>
        <div v-if="active.skill === 'write' || revealed" class="text-xl text-brand-600 dark:text-brand-300">{{ active.item.pinyin || getCharPinyin(active.item.text) }}</div>
        <button v-if="active.skill === 'write' || revealed" class="min-h-[44px] px-4 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-sm font-bold" @click="speakHanzi(active.item.text)">🔊 听发音</button>
        <button v-if="!revealed" class="block mx-auto px-5 py-3 rounded-xl bg-brand-500 text-white font-bold" @click="revealed = true">我已尝试，揭晓核对</button>
        <template v-else>
          <template v-if="active.skill === 'write' || feedbackResult === 'again'">
            <div class="flex flex-wrap justify-center gap-2"><button v-for="(char, index) in Array.from(active.item.text)" :key="index" class="min-w-[44px] min-h-[44px] px-3 py-2 rounded-lg border" :class="charIndex === index ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/40' : 'border-slate-200 dark:border-slate-700'" @click="charIndex = index">{{ char }}</button></div>
            <HanziGrid :key="`${active.item.id}-${charIndex}`" :character="Array.from(active.item.text)[charIndex]" :size="240" :auto-play="false" />
          </template>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ asParent ? '由家长核对结果' : '请如实自评，系统不自动判定读音或书写正确性' }}；需要提示或答错也算完成本项练习。</p>
          <div v-if="!feedbackResult && !expiredPractice" class="flex flex-wrap justify-center gap-2">
            <button v-if="uncertainAttempt" :disabled="busy" class="p-3 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50" @click="grade(pendingAttempt.result)">重试确认这次练习</button>
            <template v-else>
            <button :disabled="busy" class="p-3 rounded-xl bg-emerald-500 text-white text-sm font-bold disabled:opacity-50" @click="grade('good')">独立完成</button>
            <button :disabled="busy" class="p-3 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-sm font-bold disabled:opacity-50" @click="grade('hinted')">提示后完成</button>
            <button :disabled="busy" class="p-3 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm font-bold disabled:opacity-50" @click="grade('again')">还不熟</button>
            </template>
          </div>
          <div v-else-if="feedbackResult" class="space-y-3">
            <p v-if="confirmedAttempt" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">这次练习已经记下了</p>
            <p v-if="nextDue" class="text-xs text-brand-600 dark:text-brand-300">下次复习：{{ nextDue }}</p>
            <p class="text-sm text-emerald-700 dark:text-emerald-300">已记录“{{ resultName(feedbackResult) }}”。同日再练不会重复加分或连续升级。</p>
            <button :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold mr-2 disabled:opacity-50" @click="revealed = false; feedbackResult = null">再练一次</button>
            <button :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50" @click="nextItem">下一项 / 返回清单</button>
          </div>
        </template>
        </template>
        <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      </div>
    </UiDialog>
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { audioClips } from '../utils/englishAudio';
import EnglishPronunciations from '../components/EnglishPronunciations.vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api/client';
import { compareSpellingAnswer } from '../utils/englishWord';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';
import { useCalendarStore } from '../stores/calendar';
import ChildTabBar from '../components/ChildTabBar.vue';
import UiDialog from '../components/UiDialog.vue';
import HanziGrid from '../components/HanziGrid.vue';
import { getCharPinyin, speakHanzi } from '../utils/hanzi';
import { currentRole, getToken } from '../utils/session';
import { useAsyncScope } from '../composables/useAsyncScope';
import PageState from '../components/ParentPageState.vue';
import { loadLearningFont } from '../utils/learningFont';

const route = useRoute(), router = useRouter(), childId = computed(() => route.params.id);
const language = ref(route.query.language === 'en' ? 'en' : 'zh');
const calendar = useCalendarStore();
const asParent = ref(currentRole() === 'parent');
const days = ref([]), history = ref([]), date = ref(''), missingDefinitionCount = ref(0);
const selectedSkill = computed(() => ['recognize', 'write'].includes(route.query.skill) ? route.query.skill : '');
const visibleDays = computed(() => days.value.filter(day => !selectedSkill.value || day.skill === selectedSkill.value));
const visibleHistory = computed(() => history.value.filter(entry => !selectedSkill.value || entry.skill === selectedSkill.value));
function showAllSkills() {
  const query = { ...route.query };
  delete query.skill;
  router.replace({ query });
}
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref('');
const hasOverview = ref(false), refreshing = ref(false), studyReadError = ref('');
const hasHistory = ref(false), historyLoading = ref(false), historyError = ref('');
const readOptions = { silentError: true, preserveError: true };
const active = ref(null), revealed = ref(false), charIndex = ref(0), feedbackResult = ref(null);
const typedSpelling = ref(''), spellingCheck = ref(null), englishAudio = ref([]), englishAudioError = ref('');
const currentAudioLoading = ref(false), currentAudioMatch = ref(null);
let currentAudioController, currentAudioSerial = 0;
const expiredPractice = ref(false);
const nextDue = computed(() => {
  const day = days.value.find(day => day.id === active.value?.dayId);
  return day?.batches.flatMap(batch => batch.items).find(item => item.id === active.value?.item.id)?.next_due_date;
});
const pendingAttempt = ref(null);
const pendingItemId = ref(null), attemptUnknown = ref(false), confirmedAttempt = ref(false);
const uncertainAttempt = computed(() => attemptUnknown.value && pendingAttempt.value && pendingItemId.value === active.value?.item.id);
// A date-rejection recovery may return the server's today while the device clock
// still lags. Trust that snapshot until the device's family date changes again.
const recoveredDeviceDate = ref('');
const dayChanged = computed(() => calendar.ready && Boolean(date.value) && calendar.today !== date.value && calendar.today !== recoveredDeviceDate.value);
let studySerial = 0, historySerial = 0, pendingDate = null, dateMismatch = false;
let studyController, historyController;
const scopeEpoch = ref(0);
const { capture } = useAsyncScope(() => [childId.value, language.value], resetStudyScope);
function resetStudyScope() {
  asParent.value = currentRole() === 'parent';
  studySerial++; historySerial++;
  studyController?.abort(); historyController?.abort();
  stopRetry(); retryCount = 0; pendingDate = null; dateMismatch = false;
  resetEnglishAudio(); active.value = null; pendingAttempt.value = null;
  pendingItemId.value = null; attemptUnknown.value = false; confirmedAttempt.value = false;
  busy.value = false; error.value = ''; notice.value = '';
  days.value = []; history.value = []; date.value = ''; missingDefinitionCount.value = 0;
  hasOverview.value = false; hasHistory.value = false;
  loading.value = false; refreshing.value = false; studyReadError.value = '';
  historyLoading.value = false; historyError.value = ''; recoveredDeviceDate.value = '';
  scopeEpoch.value++;
}
let retryTimer, retryCount = 0;
function stopRetry() { clearTimeout(retryTimer); retryTimer = undefined; }
function cancelOverviewRead() {
  studySerial++;
  studyController?.abort();
  studyController = null;
  pendingDate = null;
  loading.value = false;
  refreshing.value = false;
}
function retryEarlierServerDate() {
  if (retryTimer || retryCount >= 24 || !canReload()) return;
  const serial = studySerial;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (serial !== studySerial || !canReload()) return;
    retryCount++;
    refresh({ includeHistory: false });
  }, 5000);
}
const canReload = () => Boolean(getToken()) && calendar.ready && !active.value && !pendingAttempt.value && !busy.value;
function reloadStudyDay() {
  if (canReload() && (!hasOverview.value || dayChanged.value) && pendingDate !== calendar.today) refresh();
}
watch(() => [calendar.today, calendar.ready, calendar.timeZone, childId.value], () => {
  stopRetry(); retryCount = 0; historySerial++;
  historyController?.abort(); historyController = null;
  historyLoading.value = false; historyError.value = '';
  if (calendar.ready && hasOverview.value && date.value === calendar.today) {
    if (pendingDate && pendingDate !== calendar.today) cancelOverviewRead();
    if (dateMismatch) { dateMismatch = false; studyReadError.value = ''; }
    refreshHistory();
  }
});
watch(() => [calendar.today, calendar.ready, calendar.timeZone, childId.value, scopeEpoch.value, active.value, pendingAttempt.value, busy.value], reloadStudyDay);
watch(() => [active.value, busy.value], () => { if (!canReload()) stopRetry(); });
const requestId = () => globalThis.crypto?.randomUUID?.() || `study-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const skillName = skill => {
  if (language.value === 'en') return skill === 'write' ? '英语默写' : '英语认读';
  return skill === 'write' ? '书写' : '认读';
};
function switchLanguage(nextLang) {
  if (nextLang === language.value || busy.value || loading.value || refreshing.value || active.value) return;
  language.value = nextLang;
  router.replace({ query: { ...route.query, language: nextLang } });
  refresh();
}
watch(() => route.query.language, (val) => {
  const next = val === 'en' ? 'en' : 'zh';
  if (next !== language.value && !active.value && !busy.value) {
    language.value = next;
    refresh();
  }
});
const resultName = result => ({ good: '独立完成', hinted: '提示后完成', again: '还不熟' }[result] || '待学习');
const baseCount = (day, kind) => day.batches.find(batch => !batch.is_extra)?.items.filter(item => item.kind === kind).length || 0;
const message = err => typeof err === 'string' ? err : err?.message || '操作失败，请重试';

async function refreshHistory() {
  if (!calendar.ready || !getToken()) return;
  const serial = ++historySerial, id = childId.value, lang = language.value, requestedDate = calendar.today, timeZone = calendar.timeZone;
  const matchesScope = capture();
  const current = () => matchesScope() && serial === historySerial && id === childId.value && lang === language.value && calendar.ready && requestedDate === calendar.today && timeZone === calendar.timeZone;
  historyController?.abort();
  const controller = new AbortController(); historyController = controller;
  historyLoading.value = true; historyError.value = '';
  try {
    const recent = await api.getWordStudyHistory(id, lang, controller.signal, readOptions);
    if (current()) { history.value = recent; hasHistory.value = true; }
  } catch (err) {
    if (current() && err?.code !== 'ERR_CANCELED') historyError.value = message(err);
  } finally {
    if (serial === historySerial) { historyLoading.value = false; historyController = null; }
  }
}

async function load({ recoverDate = false, includeHistory = true } = {}) {
  if (!calendar.ready) return;
  stopRetry();
  const serial = ++studySerial, requestedDate = calendar.today, timeZone = calendar.timeZone, id = childId.value, lang = language.value;
  const matchesScope = capture();
  studyController?.abort();
  const controller = new AbortController(); studyController = controller;
  if (includeHistory) refreshHistory();
  pendingDate = requestedDate;
  const current = () => matchesScope() && serial === studySerial && lang === language.value && calendar.ready && requestedDate === calendar.today &&
    timeZone === calendar.timeZone && id === childId.value;
  try {
    const overview = await api.getWordStudy(id, lang, controller.signal, readOptions);
    const sameRecoveredDate = recoveredDeviceDate.value === requestedDate && overview.date === date.value;
    if (!current() || active.value) return;
    if (!recoverDate && !sameRecoveredDate && overview.date !== requestedDate) {
      dateMismatch = true;
      studyReadError.value = '学习日期尚未与服务器同步，请稍后重试。';
      if (overview.date < requestedDate) retryEarlierServerDate();
      return;
    }
    retryCount = 0;
    recoveredDeviceDate.value = overview.date === requestedDate ? '' : requestedDate;
    days.value = overview.days;
    date.value = overview.date;
    missingDefinitionCount.value = overview.missing_definition_count || 0;
    hasOverview.value = true;
    if (!includeHistory) refreshHistory();
  } catch (err) {
    if (current() && err?.code !== 'ERR_CANCELED') studyReadError.value = message(err);
  } finally {
    if (serial === studySerial) { loading.value = false; refreshing.value = false; pendingDate = null; studyController = null; }
  }
}

function resetEnglishAudio() {
  currentAudioSerial++;
  currentAudioController?.abort();
  stopDictionaryAudio();
  englishAudio.value = [];
  englishAudioError.value = '';
  currentAudioMatch.value = null;
  currentAudioLoading.value = false;
}

async function loadCurrentEnglishAudio() {
  if (!active.value) return;
  const itemId = active.value.item.id, word = active.value.item.text, serial = ++currentAudioSerial;
  currentAudioController?.abort();
  currentAudioController = new AbortController();
  currentAudioLoading.value = true;
  englishAudioError.value = '';
  const current = () => active.value?.item.id === itemId && currentAudioSerial === serial;
  try {
    const res = await api.lookupDictionary(word, currentAudioController.signal, { silentError: true, preserveError: true });
    if (!current()) return;
    currentAudioMatch.value = res?.exact_matches?.find(m => m.word === word) || null;
    if (!currentAudioMatch.value?.audio?.length) englishAudioError.value = '当前词典暂无对应发音，可以继续文字练习。';
  } catch (err) { if (current() && err?.code !== 'ERR_CANCELED') englishAudioError.value = err?.message || '词典查询失败'; }
  finally { if (current()) currentAudioLoading.value = false; }
}

async function playEnglishClip(url) {
  const serial = currentAudioSerial;
  englishAudioError.value = '';
  try { await playDictionaryAudio(url); }
  catch (err) { if (serial === currentAudioSerial) englishAudioError.value = err?.message || '发音播放失败'; }
}

function checkEnglishSpelling() {
  if (!active.value) return;
  spellingCheck.value = compareSpellingAnswer(typedSpelling.value, active.value.item.text, active.value.item.strict_case);
  revealed.value = true;
}

function resetPracticeTry() {
  revealed.value = false;
  feedbackResult.value = null;
  typedSpelling.value = '';
  spellingCheck.value = null;
}

function openItem(day, batch, item) {
  stopRetry();
  const lang = day.language || language.value || 'zh';
  active.value = { dayId: day.id, batchId: batch.id, skill: day.skill, language: lang, item };
  revealed.value = false; charIndex.value = 0; feedbackResult.value = null; typedSpelling.value = ''; spellingCheck.value = null;
  pendingAttempt.value = null; pendingItemId.value = null; attemptUnknown.value = false; confirmedAttempt.value = false; error.value = ''; expiredPractice.value = false;
  resetEnglishAudio();
  if (lang === 'en') englishAudio.value = audioClips(item.audio_refs || []);
}
function begin(day, batch) { const item = batch.items.find(item => !item.result); if (item) openItem(day, batch, item); }
function closePractice() { if (!busy.value) { resetEnglishAudio(); active.value = null; pendingAttempt.value = null; } }
function switchToToday() {
  if (busy.value) return;
  closePractice();
  calendar.refreshToday();
  refresh({ recoverDate: true });
}
function nextItem() {
  if (busy.value || !active.value) return;
  if (dayChanged.value) { closePractice(); return; }
  const day = days.value.find(day => day.id === active.value.dayId);
  const batch = day?.batches.find(batch => batch.id === active.value.batchId);
  const item = batch?.items.find(item => !item.result);
  if (item) openItem(day, batch, item); else closePractice();
}
async function grade(result) {
  if (busy.value || !active.value || expiredPractice.value) return;
  // Check immediately too: the clock/visibility tick may not have run yet.
  // Already-sent requests finish below with their original attempt unchanged.
  calendar.refreshToday();
  if (dayChanged.value && !uncertainAttempt.value) { expiredPractice.value = true; error.value = ''; return; }
  busy.value = true; error.value = '';
  const confirmingUnknown = Boolean(uncertainAttempt.value);
  pendingAttempt.value ||= { result, request_id: requestId() };
  pendingItemId.value = active.value.item.id;
  const attempt = pendingAttempt.value;
  const matchesScope = capture();
  attemptUnknown.value = false;
  try {
    const response = await api.gradeWordStudyItem(active.value.item.id, attempt);
    if (!matchesScope()) return;
    days.value = days.value.map(day => day.id === response.day.id ? response.day : day);
    feedbackResult.value = attempt.result;
    confirmedAttempt.value = response.replayed === true;
    pendingAttempt.value = null;
    notice.value = response.points_earned ? `本组完成，获得 ${response.points_earned} 积分。` : '本项练习已记录。';
    refreshHistory();
  } catch (err) {
    if (!matchesScope()) return;
    attemptUnknown.value = err?.networkFailure === true;
    if (err === '只能记录今天实际进行的练习') { expiredPractice.value = true; pendingAttempt.value = null; if (confirmingUnknown) error.value = '这次练习没有记录，昨天的清单不能再记录了。'; }
    else error.value = message(err);
  }
  finally { if (matchesScope()) busy.value = false; }
}
async function extra(day) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  const matchesScope = capture();
  try {
    const updated = await api.addWordStudyExtra(day.id, requestId());
    if (!matchesScope()) return;
    days.value = days.value.map(entry => entry.id === updated.id ? updated : entry);
    const batch = updated.batches.find(batch => !batch.completed_at);
    if (batch) begin(updated, batch);
    else notice.value = '当前可学内容已完成，新收录字词将在后续清单安排。';
  } catch (err) { if (matchesScope()) error.value = message(err); }
  finally { if (matchesScope()) busy.value = false; }
}
async function refresh({ recoverDate = false, includeHistory = true } = {}) {
  if (!calendar.ready || !getToken()) { loading.value = false; return; }
  loading.value = !hasOverview.value; refreshing.value = hasOverview.value; studyReadError.value = ''; error.value = ''; dateMismatch = false;
  await load({ recoverDate, includeHistory });
}
function onResume() {
  if (document.hidden) return;
  calendar.refreshToday();
  if (!canReload()) return;
  // Reverting a skewed clock to the already displayed family day resolves the
  // date mismatch or an in-flight skewed-day read; stop rather than starting another read.
  if (hasOverview.value && date.value === calendar.today && (dateMismatch || (pendingDate && pendingDate !== calendar.today))) {
    stopRetry(); dateMismatch = false; studyReadError.value = '';
    if (pendingDate && pendingDate !== calendar.today) cancelOverviewRead();
    return;
  }
  if (pendingDate !== null) return;
  refresh();
}
onMounted(() => {
  loadLearningFont(); refresh();
  window.addEventListener('pageshow', onResume);
  document.addEventListener('visibilitychange', onResume);
});
onBeforeUnmount(() => {
  window.removeEventListener('pageshow', onResume);
  document.removeEventListener('visibilitychange', onResume);
});
</script>
