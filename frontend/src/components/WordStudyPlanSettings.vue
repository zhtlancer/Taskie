<template>
  <div class="space-y-4">
    <ParentPageState v-if="loading" kind="loading" title="正在读取字词计划…" />
    <ParentPageState v-if="loadError" kind="error" title="字词计划未能读取" :description="loadError" :busy="loading" @retry="load" />
    <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">{{ notice }}</p>
      <section v-if="!loading && forms.length" class="space-y-4">
        <p class="text-xs text-slate-500 dark:text-slate-400">自动从字词本选词，新加入的字词进入后续清单。每个字词条算一项；认读、书写分别安排。设置变更作用于下一份清单，今天已经生成的清单保持不变。</p>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <form v-for="form in forms" :key="form.skill" class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3" @submit.prevent="save(form)">
          <fieldset :disabled="busy" class="space-y-3 min-w-0">
          <h2 class="font-black text-slate-800 dark:text-slate-100">{{ skillName(form.skill) }}计划</h2>
          <div class="flex flex-wrap gap-4 text-sm">
            <label><input v-model="form.enabled" type="checkbox" /> 开启自动学习</label>
            <label><input v-model="form.required" type="checkbox" /> 基础目标计入每日必做</label>
            <label><input v-model="form.include_mastered" type="checkbox" /> 纳入字词本中已掌握的内容</label>
          </div>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">开始日期 <input v-model="form.start_date" type="date" :disabled="form.existing" :min="date" required class="ui-date-time max-w-sm mt-1 p-2 border border-slate-200 dark:border-slate-700 rounded-lg" /></label>
          <div class="flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
            <label>每日新学目标 <input v-model.number="form.new_target" type="number" min="0" max="30" required class="min-h-11 w-16 border border-slate-200 dark:border-slate-700 rounded-lg p-2" /> 项</label>
            <label>每日复习目标 <input v-model.number="form.review_target" type="number" min="0" max="100" required class="min-h-11 w-16 border border-slate-200 dark:border-slate-700 rounded-lg p-2" /> 项</label>
          </div>
          <p class="text-xs text-slate-400">按实际可学数量安排，不足时不凑数；超过目标的到期复习不会强塞进当天必做量。</p>
          <div class="flex flex-wrap gap-3 text-xs"><label v-for="(label, index) in weekdays" :key="index"><input v-model="form.days_of_week" type="checkbox" :value="index" /> {{ label }}</label></div>
          <div class="flex flex-wrap gap-3 text-xs"><span>纳入分类（不选即全部）：</span><label v-for="category in CATEGORIES" :key="category.key"><input v-model="form.categories" type="checkbox" :value="category.key" /> {{ category.label }}</label></div>
          <div class="flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
            <label>基础完成奖励 <input v-model.number="form.points" type="number" min="0" max="10000" required class="min-h-11 w-20 border border-slate-200 dark:border-slate-700 rounded-lg p-2" /> 分</label>
            <label>额外每组奖励 <input v-model.number="form.extra_points" type="number" min="0" max="10000" required class="min-h-11 w-20 border border-slate-200 dark:border-slate-700 rounded-lg p-2" /> 分</label>
            <label>每天最多奖励额外 <input v-model.number="form.extra_reward_limit" type="number" min="0" max="20" required class="min-h-11 w-16 border border-slate-200 dark:border-slate-700 rounded-lg p-2" /> 组</label>
          </div>
          <p class="text-xs text-slate-400">额外每组最多 3 项，奖励默认关闭；超过奖励名额仍能学习。奖励完成练习，不要求每项都答对。</p>
          <button :disabled="busy" class="min-h-[44px] px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-bold disabled:opacity-50">保存{{ skillName(form.skill) }}计划</button>
          </fieldset>
        </form>
        </div>
        <p class="text-xs text-slate-500 dark:text-slate-400">独立答对后逐步采用 1、3、7、14、30 天的复习间隔；需要提示或答错时安排次日复习。具体间隔是可迭代的初始规则，并非适合所有孩子的固定最佳周期。不自动修改字词本的“已掌握”或分类标记。</p>
      </section>

  </div>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client';
import ParentPageState from './ParentPageState.vue';
import { CATEGORIES } from '../utils/wordBook';
const props = defineProps({ childId: { type: String, required: true } });
const emit = defineEmits(['busy']);
const forms = ref([]), date = ref(''), loading = ref(true), busy = ref(false), loadError = ref(''), error = ref(''), notice = ref('');
const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const skillName = skill => skill === 'write' ? '书写' : '认读';
let alive = true;
async function load() {
  loading.value = true; loadError.value = ''; error.value = '';
  try {
    const overview = await api.getWordStudy(props.childId);
    if (!alive) return;
    loadError.value = ''; date.value = overview.date;
    forms.value = ['recognize', 'write'].map(skill => {
      const existing = overview.plans.find(plan => plan.skill === skill);
      return { skill, enabled: false, required: true, include_mastered: false, start_date: overview.date, new_target: 3, review_target: 10,
        points: 10, extra_points: 0, extra_reward_limit: 0, days_of_week: [1, 2, 3, 4, 5], categories: [], ...existing, existing: Boolean(existing) };
    });
  } catch (err) { if (alive) loadError.value = err.message || String(err); }
  finally { if (alive) loading.value = false; }
}
async function save(form) {
  if (busy.value) return;
  busy.value = true; emit('busy', true); error.value = ''; notice.value = '';
  try {
    const saved = await api.saveWordStudyPlan(props.childId, form.skill, form);
    if (alive) { Object.assign(form, saved, { existing: true }); notice.value = '设置已保存；已经生成的今日清单保持不变。'; }
  } catch (err) { if (alive) error.value = err.message || String(err); }
  finally { busy.value = false; emit('busy', false); }
}
onMounted(load);
onBeforeUnmount(() => { alive = false; });
</script>
