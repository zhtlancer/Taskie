<template>
  <div class="min-h-screen bg-slate-50 dark:bg-slate-800 px-4 py-5 pb-24">
    <main class="max-w-4xl mx-auto space-y-5">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div><h1 class="text-xl font-black text-slate-800 dark:text-slate-100">📚 字词学习</h1><p class="text-xs text-slate-500 dark:text-slate-400 mt-1">先回忆，再核对；每天达标后还可以自愿多学。</p></div>
        <div class="flex flex-wrap gap-3 text-sm font-bold text-brand-600 dark:text-brand-300">
          <router-link :to="`/child/${childId}/characters`">生字生词本</router-link>
          <router-link :to="`/child/${childId}/today`">今日看板</router-link>
          <button :disabled="busy || loading" @click="refresh">刷新安排</button>
          <button v-if="asParent" @click="showSettings = !showSettings">{{ showSettings ? '收起设置' : '自动学习设置' }}</button>
        </div>
      </header>
      <p v-if="error" role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-3 text-sm text-rose-700 dark:text-rose-300">{{ error }}</p>
      <p v-if="notice" role="status" class="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
      <p v-if="loading" class="text-center py-12 text-brand-600 dark:text-brand-300">正在安排学习…</p>

      <section v-if="asParent && showSettings" class="space-y-4">
        <p class="text-xs text-slate-500 dark:text-slate-400">自动从字词本选词，新加入的字词进入后续清单。每个字词条算一项；认读、书写分别安排。设置变更作用于下一份清单，今天已经生成的清单保持不变。</p>
        <form v-for="form in forms" :key="form.skill" class="rounded-2xl border bg-white dark:bg-slate-900 p-4 space-y-3" @submit.prevent="save(form)">
          <h2 class="font-black text-slate-800 dark:text-slate-100">{{ skillName(form.skill) }}计划</h2>
          <div class="flex flex-wrap gap-4 text-sm">
            <label><input v-model="form.enabled" type="checkbox" /> 开启自动学习</label>
            <label><input v-model="form.required" type="checkbox" /> 基础目标计入每日必做</label>
            <label><input v-model="form.include_mastered" type="checkbox" /> 纳入字词本中已掌握的内容</label>
          </div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">开始日期 <input v-model="form.start_date" type="date" :disabled="form.existing" :min="date" required class="p-2 border rounded-lg" /></label>
          <div class="flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
            <label>每日新学目标 <input v-model.number="form.new_target" type="number" min="0" max="30" required class="w-16 border rounded-lg p-2" /> 项</label>
            <label>每日复习目标 <input v-model.number="form.review_target" type="number" min="0" max="100" required class="w-16 border rounded-lg p-2" /> 项</label>
          </div>
          <p class="text-xs text-slate-400">按实际可学数量安排，不足时不凑数；超过目标的到期复习不会强塞进当天必做量。</p>
          <div class="flex flex-wrap gap-3 text-xs"><label v-for="(label, index) in weekdays" :key="index"><input v-model="form.days_of_week" type="checkbox" :value="index" /> {{ label }}</label></div>
          <div class="flex flex-wrap gap-3 text-xs"><span>纳入分类（不选即全部）：</span><label v-for="category in CATEGORIES" :key="category.key"><input v-model="form.categories" type="checkbox" :value="category.key" /> {{ category.label }}</label></div>
          <div class="flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
            <label>基础完成奖励 <input v-model.number="form.points" type="number" min="0" max="10000" required class="w-20 border rounded-lg p-2" /> 分</label>
            <label>额外每组奖励 <input v-model.number="form.extra_points" type="number" min="0" max="10000" required class="w-20 border rounded-lg p-2" /> 分</label>
            <label>每天最多奖励额外 <input v-model.number="form.extra_reward_limit" type="number" min="0" max="20" required class="w-16 border rounded-lg p-2" /> 组</label>
          </div>
          <p class="text-xs text-slate-400">额外每组最多 3 项，奖励默认关闭；超过奖励名额仍能学习。奖励完成练习，不要求每项都答对。</p>
          <button :disabled="busy" class="px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50">保存{{ skillName(form.skill) }}计划</button>
        </form>
        <p class="text-xs text-slate-500 dark:text-slate-400">独立答对后逐步采用 1、3、7、14、30 天的复习间隔；需要提示或答错时安排次日复习。具体间隔是可迭代的初始规则，并非适合所有孩子的固定最佳周期。不自动修改字词本的“已掌握”或分类标记。</p>
      </section>

      <template v-if="!loading">
        <section v-if="!days.length" class="bg-white dark:bg-slate-900 border rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400">
          今天没有基础学习清单：可能还未开启计划、今天不是学习日，或当前没有需要新学/复习的字词。
          <p v-if="!asParent" class="mt-2">可以请家长从字词本进入本页，开启自动学习计划。</p>
        </section>
        <section v-for="day in days" :key="day.id" class="bg-white dark:bg-slate-900 border rounded-2xl p-4 space-y-3">
          <div class="flex justify-between gap-3"><h2 class="font-black text-slate-800 dark:text-slate-100">{{ day.title }}</h2><span class="text-xs font-bold" :class="day.base_done ? 'text-emerald-600 dark:text-emerald-300' : 'text-brand-600 dark:text-brand-300'">{{ day.base_done ? '基础目标已完成 ✓' : `基础目标 ${day.base_completed}/${day.base_total}` }}</span></div>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ day.required ? '每日必做' : '可选学习' }} · 新学 {{ baseCount(day, 'new') }} 项，复习 {{ baseCount(day, 'review') }} 项 · 基础完成 +{{ day.points }} 分</p>
          <p class="text-xs text-amber-700 dark:text-amber-300">基础清单以外：还有 {{ day.remaining_due }} 项到期复习、{{ day.remaining_new }} 项待新学。达标不代表已复习完全部内容。</p>
          <button v-if="day.batches.some(batch => !batch.completed_at)" :disabled="busy" class="w-full min-h-[48px] rounded-xl bg-brand-500 text-white font-bold disabled:opacity-50" @click="begin(day, day.batches.find(batch => !batch.completed_at))">开始 / 继续学习 →</button>
          <div v-for="batch in day.batches" :key="batch.id" class="rounded-xl border p-3" :class="batch.is_extra ? 'bg-violet-50/50 dark:bg-violet-950/40 border-violet-100 dark:border-violet-800' : 'bg-slate-50 dark:bg-slate-800 border-slate-100 dark:border-slate-700'">
            <div class="flex justify-between gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
              <span>{{ batch.is_extra ? '✨ 自愿追加' : '🎯 基础学习' }} · {{ batch.items.filter(item => item.result).length }}/{{ batch.items.length }} 项</span>
              <span v-if="batch.completed_at">已完成 · +{{ batch.points }} 分</span>
              <button v-else :disabled="busy" class="text-brand-600 dark:text-brand-300" @click="begin(day, batch)">开始 / 继续 →</button>
            </div>
            <details class="mt-2"><summary class="min-h-[44px] py-3 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">查看字词清单与练习结果</summary><div class="flex flex-wrap gap-2">
              <button v-for="item in batch.items" :key="item.id" :disabled="busy" class="px-2 py-1 rounded-lg border text-xs" :class="item.result === 'good' ? 'text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : item.result ? 'text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'" @click="openItem(day, batch, item)">{{ item.text }} · {{ resultName(item.result) }}</button>
            </div></details>
          </div>
          <p v-if="day.remaining_early" class="text-xs text-slate-400">还有 {{ day.remaining_early }} 项可提前巩固，答对不会跳过原定复习阶段。</p>
          <div v-if="day.base_done" class="flex flex-wrap items-center gap-3">
            <button v-if="!day.batches.some(batch => !batch.completed_at)" :disabled="busy || !(day.remaining_due + day.remaining_new + day.remaining_early)" class="px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-bold disabled:opacity-50" @click="extra(day)">继续学习一小组</button>
            <span class="text-xs text-slate-400">额外奖励 {{ day.extra_rewarded }}/{{ day.extra_reward_limit }} 组 · 自愿完成，不改变全勤和连续打卡</span>
          </div>
        </section>
        <details v-if="history.length" class="rounded-2xl bg-white dark:bg-slate-900 border p-4">
          <summary class="font-bold text-slate-800 dark:text-slate-100 min-h-[44px] py-3 cursor-pointer">最近学习记录</summary>
          <ul class="space-y-2 text-xs text-slate-500 dark:text-slate-400"><li v-for="entry in history" :key="entry.id">{{ entry.date }} · {{ skillName(entry.skill) }} · 基础 {{ entry.base_completed }}/{{ entry.base_total }} 项 · 额外 {{ entry.extra_completed }} 项 · {{ entry.needs_practice }} 项还需练习</li></ul>
        </details>
      </template>
    </main>

    <div v-if="active" class="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-3" @click.self="!busy && closePractice()">
      <section role="dialog" aria-modal="true" aria-labelledby="practice-title" class="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 space-y-4 text-center">
        <div class="flex justify-between items-center"><h2 id="practice-title" class="font-black">{{ skillName(active.skill) }}练习 · {{ active.item.is_early ? '提前巩固（不升级周期）' : active.item.kind === 'review' ? '复习' : '新学' }}</h2><button :disabled="busy" aria-label="关闭练习" @click="closePractice">✕</button></div>
        <p class="text-xs text-slate-500 dark:text-slate-400">{{ active.skill === 'write' ? '先听词或看拼音，在纸上默写，再核对字形与笔顺。' : '先尝试读出字词，再揭晓拼音核对。' }}</p>
        <div v-if="active.skill === 'recognize' || revealed" class="text-4xl font-reading text-slate-800 dark:text-slate-100">{{ active.item.text }}</div>
        <div v-if="active.skill === 'write' || revealed" class="text-xl text-brand-600 dark:text-brand-300">{{ active.item.pinyin || getCharPinyin(active.item.text) }}</div>
        <button v-if="active.skill === 'write' || revealed" class="px-4 py-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-sm font-bold" @click="speakHanzi(active.item.text)">🔊 听发音</button>
        <button v-if="!revealed" class="block mx-auto px-5 py-3 rounded-xl bg-brand-500 text-white font-bold" @click="revealed = true">我已尝试，揭晓核对</button>
        <template v-else>
          <template v-if="active.skill === 'write' || feedbackResult === 'again'">
            <div class="flex flex-wrap justify-center gap-2"><button v-for="(char, index) in Array.from(active.item.text)" :key="index" class="px-3 py-1 rounded-lg border" :class="charIndex === index ? 'border-brand-400 bg-brand-50 dark:bg-brand-900/40' : 'border-slate-200 dark:border-slate-700'" @click="charIndex = index">{{ char }}</button></div>
            <HanziGrid :key="`${active.item.id}-${charIndex}`" :character="Array.from(active.item.text)[charIndex]" :size="240" :auto-play="false" />
          </template>
          <p class="text-xs text-slate-500 dark:text-slate-400">{{ asParent ? '由家长核对结果' : '请如实自评，系统不自动判定读音或书写正确性' }}；需要提示或答错也算完成本项练习。</p>
          <div v-if="!feedbackResult" class="flex flex-wrap justify-center gap-2">
            <button :disabled="busy" class="p-3 rounded-xl bg-emerald-500 text-white text-sm font-bold disabled:opacity-50" @click="grade('good')">独立完成</button>
            <button :disabled="busy" class="p-3 rounded-xl bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-sm font-bold disabled:opacity-50" @click="grade('hinted')">提示后完成</button>
            <button :disabled="busy" class="p-3 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm font-bold disabled:opacity-50" @click="grade('again')">还不熟</button>
          </div>
          <div v-else class="space-y-3">
            <p v-if="nextDue" class="text-xs text-brand-600 dark:text-brand-300">下次复习：{{ nextDue }}</p>
            <p class="text-sm text-emerald-700 dark:text-emerald-300">已记录“{{ resultName(feedbackResult) }}”。同日再练不会重复加分或连续升级。</p>
            <button class="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-bold mr-2" @click="revealed = false; feedbackResult = null">再练一次</button>
            <button class="px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold" @click="nextItem">下一项 / 返回清单</button>
          </div>
        </template>
        <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      </section>
    </div>
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import ChildTabBar from '../components/ChildTabBar.vue';
import HanziGrid from '../components/HanziGrid.vue';
import { getCharPinyin, speakHanzi } from '../utils/hanzi';
import { CATEGORIES } from '../utils/wordBook';
import { currentRole } from '../utils/session';
import { loadLearningFont } from '../utils/learningFont';

const route = useRoute(), childId = computed(() => route.params.id);
const asParent = currentRole() === 'parent';
const days = ref([]), forms = ref([]), history = ref([]), date = ref('');
const loading = ref(true), busy = ref(false), error = ref(''), notice = ref(''), showSettings = ref(false);
const active = ref(null), revealed = ref(false), charIndex = ref(0), feedbackResult = ref(null);
const nextDue = computed(() => {
  const day = days.value.find(day => day.id === active.value?.dayId);
  return day?.batches.flatMap(batch => batch.items).find(item => item.id === active.value?.item.id)?.next_due_date;
});
let pendingAttempt = null;
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const requestId = () => globalThis.crypto?.randomUUID?.() || `study-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const skillName = skill => skill === 'write' ? '书写' : '认读';
const resultName = result => ({ good: '独立完成', hinted: '提示后完成', again: '还不熟' }[result] || '待学习');
const baseCount = (day, kind) => day.batches.find(batch => !batch.is_extra)?.items.filter(item => item.kind === kind).length || 0;
const message = err => typeof err === 'string' ? err : '操作失败，请重试';

async function load() {
  const [overview, recent] = await Promise.all([api.getWordStudy(childId.value), api.getWordStudyHistory(childId.value)]);
  days.value = overview.days;
  date.value = overview.date;
  history.value = recent;
  forms.value = ['recognize', 'write'].map(skill => {
    const existing = overview.plans.find(plan => plan.skill === skill);
    return { skill, enabled: false, required: true, include_mastered: false, start_date: overview.date, new_target: 3, review_target: 10,
      points: 10, extra_points: 0, extra_reward_limit: 0, days_of_week: [1, 2, 3, 4, 5], categories: [], ...existing, existing: Boolean(existing) };
  });
  if (asParent && !overview.plans.length) showSettings.value = true;
}

async function save(form) {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await api.saveWordStudyPlan(childId.value, form.skill, form); await load(); notice.value = '设置已保存；已经生成的今日清单保持不变。'; }
  catch (err) { error.value = message(err); }
  finally { busy.value = false; }
}

function openItem(day, batch, item) {
  active.value = { dayId: day.id, batchId: batch.id, skill: day.skill, item };
  revealed.value = false; charIndex.value = 0; feedbackResult.value = null; pendingAttempt = null; error.value = '';
}
function begin(day, batch) { const item = batch.items.find(item => !item.result); if (item) openItem(day, batch, item); }
function closePractice() { if (!busy.value) { active.value = null; pendingAttempt = null; } }
function nextItem() {
  const day = days.value.find(day => day.id === active.value.dayId);
  const batch = day?.batches.find(batch => batch.id === active.value.batchId);
  const item = batch?.items.find(item => !item.result);
  if (item) openItem(day, batch, item); else closePractice();
}
async function grade(result) {
  if (busy.value || !active.value) return;
  busy.value = true; error.value = '';
  pendingAttempt ||= { result, request_id: requestId() };
  try {
    const response = await api.gradeWordStudyItem(active.value.item.id, pendingAttempt);
    days.value = days.value.map(day => day.id === response.day.id ? response.day : day);
    feedbackResult.value = pendingAttempt.result;
    pendingAttempt = null;
    notice.value = response.points_earned ? `本组完成，获得 ${response.points_earned} 积分。` : '本项练习已记录。';
    history.value = await api.getWordStudyHistory(childId.value);
  } catch (err) { error.value = message(err); }
  finally { busy.value = false; }
}
async function extra(day) {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    const updated = await api.addWordStudyExtra(day.id, requestId());
    days.value = days.value.map(entry => entry.id === updated.id ? updated : entry);
    const batch = updated.batches.find(batch => !batch.completed_at);
    if (batch) begin(updated, batch);
    else notice.value = '当前可学内容已完成，新收录字词将在后续清单安排。';
  } catch (err) { error.value = message(err); }
  finally { busy.value = false; }
}
async function refresh() {
  loading.value = true; error.value = '';
  try { await load(); } catch (err) { error.value = message(err); } finally { loading.value = false; }
}
onMounted(() => { loadLearningFont(); refresh(); });
</script>
