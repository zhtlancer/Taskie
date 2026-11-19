<template>
  <section class="space-y-4">
    <!-- Language switcher: Chinese characters vs English words -->
    <div class="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
      <div class="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1" role="tablist" aria-label="学习计划语言切换">
        <button
          type="button"
          role="tab"
          :disabled="loading || savingSkill !== ''"
          :aria-selected="language === 'zh'"
          class="min-h-11 px-4 py-1.5 rounded-lg text-sm font-black transition-all"
          :class="language === 'zh' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-300 shadow-xs' : 'text-slate-600 dark:text-slate-300'"
          @click="switchLanguage('zh')"
        >
          🇨🇳 语文字词计划
        </button>
        <button
          type="button"
          role="tab"
          :disabled="loading || savingSkill !== ''"
          :aria-selected="language === 'en'"
          class="min-h-11 px-4 py-1.5 rounded-lg text-sm font-black transition-all"
          :class="language === 'en' ? 'bg-white dark:bg-slate-900 text-brand-600 dark:text-brand-300 shadow-xs' : 'text-slate-600 dark:text-slate-300'"
          @click="switchLanguage('en')"
        >
          🔤 英语单词计划
        </button>
      </div>

      <router-link
        :to="`/child/${childId}/word-study?language=${language}`"
        class="min-h-11 inline-flex items-center px-3.5 py-2 rounded-xl bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 text-xs font-black border border-brand-200 dark:border-brand-800"
      >
        前往{{ language === 'en' ? '英语单词学习' : '语文字词学习' }} →
      </router-link>
    </div>

    <div v-if="language === 'en' && missingDefCount > 0" class="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs font-bold text-amber-800 dark:text-amber-200">
      提示：孩子当前有 {{ missingDefCount }} 个英语单词缺少中英文释义，这些词暂不会进入认读/默写待学池。
    </div>

    <PageState v-if="loading" kind="loading" title="正在读取学习计划…" />
    <PageState v-else-if="error" kind="error" title="学习计划未能读取" :description="error" @retry="load" />

    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <article
        v-for="skill in ['recognize', 'write']"
        :key="`${language}-${skill}`"
        class="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm"
      >
        <fieldset :disabled="savingSkill === skill" class="space-y-4 min-w-0">
        <header class="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 class="text-base font-black text-slate-800 dark:text-slate-100">
              {{ skillTitle(skill) }}
            </h3>
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">
              {{ skillDesc(skill) }}
            </p>
          </div>
          <label class="inline-flex items-center gap-2 min-h-11 cursor-pointer">
            <input v-model="forms[skill].enabled" type="checkbox" class="w-5 h-5 accent-brand-500" />
            <span class="text-sm font-black">{{ forms[skill].enabled ? '已开启' : '未开启' }}</span>
          </label>
        </header>

        <div class="grid grid-cols-2 gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
          <label>
            每日新学目标
            <input v-model.number="forms[skill].new_target" type="number" min="0" :max="50" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100" />
          </label>
          <label>
            每日复习上限
            <input v-model.number="forms[skill].review_target" type="number" min="0" max="100" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100" />
          </label>
          <label>
            完成奖励积分
            <input v-model.number="forms[skill].points" type="number" min="0" max="10000" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100" />
          </label>
          <label>
            额外练习单次积分
            <input v-model.number="forms[skill].extra_points" type="number" min="0" max="10000" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100" />
          </label>
          <label>
            每日加练有奖次数
            <input v-model.number="forms[skill].extra_reward_limit" type="number" min="0" max="20" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100" />
          </label>
          <label>
            开始日期
            <input v-model="forms[skill].start_date" type="date" :min="forms[skill].exists ? undefined : (serverDate || calendar.today || undefined)" :disabled="forms[skill].exists" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100 disabled:opacity-60" />
          </label>
        </div>

        <label class="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input v-model="forms[skill].required" type="checkbox" class="w-4 h-4 accent-brand-500" />
          <span>列入每日必做（未完成影响连续达标）</span>
        </label>

        <label class="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
          <input v-model="forms[skill].include_mastered" type="checkbox" class="w-4 h-4 accent-brand-500" />
          <span>包含单词本/字词本中已标“已掌握”的条目</span>
        </label>

        <!-- Weekdays -->
        <div class="space-y-1.5">
          <span class="block text-xs font-bold text-slate-500 dark:text-slate-400">学习日：</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="(label, idx) in WEEKDAYS"
              :key="idx"
              type="button"
              :aria-pressed="forms[skill].days_of_week.includes(idx)"
              class="min-h-11 min-w-11 px-2.5 py-1 rounded-xl border text-xs font-bold"
              :class="forms[skill].days_of_week.includes(idx)
                ? 'bg-brand-500 text-white border-brand-500'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
              @click="toggleWeekday(skill, idx)"
            >
              {{ label }}
            </button>
          </div>
        </div>

        <!-- Categories filter -->
        <div class="space-y-1.5">
          <span class="block text-xs font-bold text-slate-500 dark:text-slate-400">范围分类（全不选表示全部）：</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="cat in categoryList"
              :key="cat.key"
              type="button"
              :aria-pressed="forms[skill].categories.includes(cat.key)"
              class="min-h-11 px-3 py-1 rounded-xl border text-xs font-bold"
              :class="forms[skill].categories.includes(cat.key)
                ? cat.chip
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
              @click="toggleCat(skill, cat.key)"
            >
              {{ cat.icon }} {{ cat.label }}
            </button>
          </div>
        </div>

        <!-- English Textbook & Unit scope -->
        <div v-if="language === 'en'" class="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <label class="block text-xs font-bold text-slate-500 dark:text-slate-400">
            限定教材（选填，留空为不限）：
            <select
              v-model="forms[skill].textbook"
              class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-bold text-slate-800 dark:text-slate-100"
            >
              <option value="">全部教材</option>
              <option v-for="tb in taxonomy.textbooks" :key="tb" :value="tb">{{ tb }}</option>
            </select>
          </label>

          <div v-if="taxonomy.units.length" class="space-y-1.5">
            <span class="block text-xs font-bold text-slate-500 dark:text-slate-400">限定单元（全不选为全部单元）：</span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="u in taxonomy.units"
                :key="u"
                type="button"
                :aria-pressed="forms[skill].units.includes(u)"
                class="min-h-11 min-w-11 px-3 py-1 rounded-xl border text-xs font-bold"
                :class="forms[skill].units.includes(u)
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
                @click="toggleUnit(skill, u)"
              >
                {{ u }}
              </button>
            </div>
          </div>
        </div>

        <p v-if="skillErrors[skill]" role="alert" class="text-xs font-bold text-rose-600 dark:text-rose-300">{{ skillErrors[skill] }}</p>
        <p v-if="skillNotices[skill]" role="status" class="text-xs font-bold text-emerald-600 dark:text-emerald-300">{{ skillNotices[skill] }}</p>

        <button
          type="button"
          class="w-full ui-button-primary"
          @click="save(skill)"
        >
          {{ savingSkill === skill ? '保存中…' : `保存${skillTitle(skill)}计划` }}
        </button>
        </fieldset>
      </article>
    </div>
  </section>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import PageState from './ParentPageState.vue';
import api from '../api/client';
import { CATEGORIES as ZH_CATEGORIES } from '../utils/wordBook';
import { ENGLISH_CATEGORIES } from '../utils/englishWord';
import { useCalendarStore } from '../stores/calendar';
import { useAsyncScope } from '../composables/useAsyncScope';

const props = defineProps({
  childId: { type: String, required: true }
});

const emit = defineEmits(['busy']);
const calendar = useCalendarStore();

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const language = ref('zh');
const serverDate = ref('');
const loading = ref(true);
const error = ref('');
const savingSkill = ref('');
const missingDefCount = ref(0);
const taxonomy = ref({ textbooks: [], units: [] });
const skillErrors = ref({ recognize: '', write: '' });
const skillNotices = ref({ recognize: '', write: '' });
let loadSerial = 0;
let loadController = null;
const REQUEST_OPTIONS = { silentError: true, preserveError: true };
const { capture } = useAsyncScope(() => [props.childId, language.value], () => {
  loadSerial++;
  loadController?.abort();
  savingSkill.value = '';
  skillErrors.value = { recognize: '', write: '' };
  skillNotices.value = { recognize: '', write: '' };
});

const defaultForm = (lang, skill, dateFallback = '') => ({
  exists: false,
  enabled: false,
  required: true,
  include_mastered: false,
  new_target: 3,
  review_target: 10,
  points: 10,
  extra_points: 0,
  extra_reward_limit: 0,
  days_of_week: [1, 2, 3, 4, 5],
  categories: lang === 'en' ? [skill] : [],
  textbook: '',
  units: [],
  start_date: dateFallback || serverDate.value || calendar.today || ''
});

const forms = ref({
  recognize: defaultForm('zh', 'recognize'),
  write: defaultForm('zh', 'write')
});

const categoryList = computed(() => (language.value === 'en' ? ENGLISH_CATEGORIES : ZH_CATEGORIES));

function skillTitle(skill) {
  if (language.value === 'en') return skill === 'write' ? '英语单词默写' : '英语单词认读';
  return skill === 'write' ? '语文字词书写' : '语文字词认读';
}

function skillDesc(skill) {
  if (language.value === 'en') {
    return skill === 'write'
      ? '看中文释义、听发音后在屏幕输入拼写并核对'
      : '看单词、音标与听发音，回忆中文释义后自评掌握情况';
  }
  return skill === 'write' ? '听写与手写巩固' : '看字回忆读音与识记';
}

function toggleWeekday(skill, dayIdx) {
  const cur = forms.value[skill].days_of_week;
  if (cur.includes(dayIdx) && cur.length === 1) return;
  forms.value[skill].days_of_week = cur.includes(dayIdx)
    ? cur.filter(d => d !== dayIdx)
    : [...cur, dayIdx].sort();
}

function toggleCat(skill, key) {
  const cur = forms.value[skill].categories;
  forms.value[skill].categories = cur.includes(key) ? cur.filter(c => c !== key) : [...cur, key];
}

function toggleUnit(skill, unit) {
  const cur = forms.value[skill].units;
  forms.value[skill].units = cur.includes(unit) ? cur.filter(u => u !== unit) : [...cur, unit];
}

function switchLanguage(nextLang) {
  if (nextLang === language.value || savingSkill.value) return;
  language.value = nextLang;
  load();
}

async function load() {
  const serial = ++loadSerial;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const targetChild = props.childId;
  const lang = language.value;
  const matchesScope = capture();
  const isCurrent = () => matchesScope() && serial === loadSerial;
  loading.value = true;
  error.value = '';
  skillErrors.value = { recognize: '', write: '' };
  skillNotices.value = { recognize: '', write: '' };
  emit('busy', true);
  try {
    const reqs = [api.getWordStudy(targetChild, lang, controller.signal, REQUEST_OPTIONS)];
    if (lang === 'en') reqs.push(api.getEnglishWordTaxonomy(targetChild, controller.signal, REQUEST_OPTIONS));
    const [studyRes, taxRes] = await Promise.all(reqs);
    if (!isCurrent()) return;
    serverDate.value = studyRes.date || '';
    missingDefCount.value = studyRes.missing_definition_count || 0;
    taxonomy.value = taxRes || { textbooks: [], units: [] };

    const nextForms = {
      recognize: defaultForm(lang, 'recognize', serverDate.value),
      write: defaultForm(lang, 'write', serverDate.value)
    };
    for (const plan of studyRes.plans || []) {
      nextForms[plan.skill] = {
        exists: true,
        enabled: Boolean(plan.enabled),
        required: Boolean(plan.required),
        include_mastered: Boolean(plan.include_mastered),
        new_target: plan.new_target,
        review_target: plan.review_target,
        points: plan.points,
        extra_points: plan.extra_points,
        extra_reward_limit: plan.extra_reward_limit,
        days_of_week: [...(plan.days_of_week || [1, 2, 3, 4, 5])],
        categories: [...(plan.categories || [])],
        textbook: plan.textbook || '',
        units: [...(plan.units || [])],
        start_date: plan.start_date
      };
    }
    forms.value = nextForms;
  } catch (err) {
    if (isCurrent()) error.value = typeof err === 'string' ? err : err?.message || '读取计划失败';
  } finally {
    if (isCurrent()) {
      loadController = null;
      loading.value = false;
      emit('busy', Boolean(savingSkill.value));
    }
  }
}

async function save(skill) {
  if (savingSkill.value || loading.value) return;
  const targetChild = props.childId;
  const targetLang = language.value;
  const matchesScope = capture();
  savingSkill.value = skill;
  skillErrors.value[skill] = '';
  skillNotices.value[skill] = '';
  emit('busy', true);
  try {
    const f = forms.value[skill];
    const saved = await api.saveWordStudyPlan(targetChild, skill, {
      language: targetLang,
      enabled: f.enabled,
      required: f.required,
      include_mastered: f.include_mastered,
      new_target: Number(f.new_target) || 0,
      review_target: Number(f.review_target) || 0,
      points: Number(f.points) || 0,
      extra_points: Number(f.extra_points) || 0,
      extra_reward_limit: Number(f.extra_reward_limit) || 0,
      days_of_week: f.days_of_week,
      categories: f.categories,
      textbook: targetLang === 'en' ? f.textbook || null : null,
      units: targetLang === 'en' ? f.units : [],
      start_date: f.start_date
    }, targetLang, REQUEST_OPTIONS);
    if (matchesScope()) {
      forms.value[skill].exists = true;
      forms.value[skill].start_date = saved.start_date;
      skillNotices.value[skill] = '计划已保存，并按约定生效。';
    }
  } catch (err) {
    if (matchesScope()) {
      skillErrors.value[skill] = typeof err === 'string' ? err : err?.message || '保存失败';
    }
  } finally {
    if (matchesScope()) {
      savingSkill.value = '';
      emit('busy', loading.value);
    }
  }
}

watch(() => props.childId, load, { flush: 'sync' });
onMounted(() => {
  load();
  window.addEventListener('taskie:data-restored', load);
  window.addEventListener('taskie:session-changed', load);
});
onBeforeUnmount(() => {
  loadSerial++;
  window.removeEventListener('taskie:data-restored', load);
  window.removeEventListener('taskie:session-changed', load);
});
</script>
