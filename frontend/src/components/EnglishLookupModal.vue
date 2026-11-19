<template>
  <UiDialog v-if="modelValue" title="查词与收录单词" wide :busy="saving" @close="close">
    <div class="space-y-4">
      <!-- Lookup search bar -->
      <form class="flex flex-wrap gap-2" @submit.prevent="runLookup(query)">
        <input
          v-model="query"
          type="text"
          autofocus
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="输入英文单词或短语，如 apple / May / look after"
          class="flex-1 min-w-[200px] min-h-11 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          @input="onQueryInput"
        />
        <button
          type="submit"
          :disabled="lookingUp || !query.trim()"
          class="min-h-11 px-4 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-black disabled:opacity-50"
        >
          {{ lookingUp ? '查询中…' : '🔍 查词' }}
        </button>
      </form>

      <DictionaryIndexNotice v-if="lookingUp" />

      <!-- Live autocomplete suggestions -->
      <div v-if="suggestList.length" class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs font-bold text-slate-500 dark:text-slate-400">猜你想查：</span>
        <button
          v-for="item in suggestList"
          :key="item"
          type="button"
          class="min-h-11 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 text-xs font-bold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
          @click="pickSuggestion(item)"
        >
          {{ item }}
        </button>
      </div>

      <!-- Lookup error / audio error -->
      <div v-if="lookupError" role="alert" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200 space-y-2">
        <p>{{ lookupError }} 可在下方手工填写，已有更正会保留。</p>
        <button type="button" :disabled="lookingUp || saving" class="ui-button-secondary min-h-11" @click="runLookup(query)">重试查询</button>
      </div>
      <p v-if="audioError" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200">
        {{ audioError }}
      </p>

      <!-- Dictionary match card -->
      <div v-if="matches.length" class="rounded-2xl border border-brand-200/80 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-950/20 p-4 space-y-3">
        <!-- Case variants switcher e.g. May vs may -->
        <div v-if="matches.length > 1" class="flex flex-wrap items-center gap-2">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">词条区分：</span>
          <button
            v-for="(m, idx) in matches"
            :key="m.word"
            type="button"
            class="min-h-11 min-w-11 px-3 py-1 rounded-xl text-xs font-black border"
            :class="selectedMatchIndex === idx
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'"
            @click="selectMatch(idx)"
          >
            {{ m.word }}
          </button>
        </div>

        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-2xl font-black text-slate-900 dark:text-slate-100">{{ activeMatch.word }}</span>
              <span v-if="activeMatch.pos" class="px-2 py-0.5 rounded-lg text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
                {{ activeMatch.pos }}
              </span>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-cyan-700 dark:text-cyan-300">
              <span v-if="activeMatch.phonetic_uk">英 /{{ activeMatch.phonetic_uk }}/</span>
              <span v-if="activeMatch.phonetic_us">美 /{{ activeMatch.phonetic_us }}/</span>
              <span v-else-if="activeMatch.phonetic && !activeMatch.phonetic_uk">/{{ activeMatch.phonetic }}/</span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
        <EnglishPronunciations :groups="activeMatch.pronunciations || []" :fallback="activeMatch.audio" @play="playClip" />
            <button
              type="button"
              class="min-h-11 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs font-black text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50"
              @click="articleWord = activeMatch.word"
            >
              📖 查看完整原词典
            </button>
          </div>
        </div>

        <p v-if="activeMatch.forms?.length" class="text-xs font-bold text-slate-500 dark:text-slate-400">
          词形：{{ activeMatch.forms.join(' · ') }}
        </p>
      </div>

      <!-- Inflection / similar suggestions when no exact hit -->
      <div v-else-if="lookupDone && dictSuggestions.length" class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 flex flex-wrap items-center gap-2">
        <span class="text-xs font-bold text-slate-600 dark:text-slate-300">未找到完全匹配的词条，试试：</span>
        <button
          v-for="s in dictSuggestions"
          :key="s.word"
          type="button"
          class="min-h-11 px-3 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-brand-600 dark:text-brand-300"
          @click="pickSuggestion(s.word)"
        >
          {{ s.word }} <span class="opacity-65">({{ s.reason }})</span>
        </button>
      </div>

      <div v-if="lookupDone && !lookupError && dictReason" role="status" class="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300">
        {{ dictReason || '离线词典未启用，可在下方直接手动填写音标与释义收录。' }}
      </div>

      <!-- Wordbook form (auto-filled or manual entry) -->
      <div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3 bg-white dark:bg-slate-900">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-black text-slate-800 dark:text-slate-100">录入英语单词本</h3>
          <span
            v-if="alreadyInBook"
            class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
          >
            ✅ 已在单词本中
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            英文词条 *
            <input
              v-model="form.word"
              type="text"
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
            />
          </label>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            英式音标 (BrE)
            <input
              v-model="form.phonetic_uk"
              type="text"
              placeholder="如 ˈæpl"
              class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
            />
          </label>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            美式音标 (NAmE)
            <input
              v-model="form.phonetic_us"
              type="text"
              placeholder="如 ˈæpl"
              class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
            />
          </label>
        </div>

        <EnglishSensesEditor v-model="form" :candidates="dictionaryCandidates" :pronunciations="dictionaryPronunciations" :disabled="saving" />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            教材/分类（选填）
            <input
              v-model="form.textbook"
              :disabled="!isParent"
              type="text"
              placeholder="如 人教版三年级"
              class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
            />
          </label>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            单元（选填）
            <input
              v-model="form.unit"
              :disabled="!isParent"
              type="text"
              placeholder="如 Unit 1"
              class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
            />
          </label>
        </div>

        <p v-if="!isParent" class="text-xs font-bold text-slate-500 dark:text-slate-400">教材和单元由家长设置，其他内容可以自行填写。</p>

        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
          记忆笔记（选填）
          <input
            v-model="form.note"
            type="text"
            placeholder="如 复数加 s，注意拼写"
            class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
          />
        </label>

        <div>
          <span class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">分类标记：</span>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="cat in ENGLISH_CATEGORIES"
              :key="cat.key"
              type="button"
              :aria-pressed="form.categories.includes(cat.key)"
              class="min-h-11 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all"
              :class="form.categories.includes(cat.key)
                ? cat.chip
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
              @click="toggleCat(cat.key)"
            >
              {{ cat.icon }} {{ cat.label }}
            </button>
          </div>
        </div>

        <label class="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-700 dark:text-slate-200">
          <input v-model="form.strict_case" type="checkbox" :disabled="saving" class="w-5 h-5 accent-brand-500" />
          默写时严格区分大小写
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">适合专名、缩写；普通词可保持关闭。</p>
        <EnglishCaseConfirmation v-model="form.confirmed_case_variants" :word="form.word" :variants="caseVariants" :disabled="saving" />

        <p v-if="saveError" role="alert" class="text-xs font-bold text-rose-600 dark:text-rose-300">
          {{ saveError }}
        </p>
      </div>
    </div>

    <template #footer>
      <button type="button" :disabled="saving" class="ui-button-secondary" @click="close">取消</button>
      <button
        type="button"
        :disabled="saving || alreadyInBook || !isValidEnglishWord(form.word) || !caseConfirmed"
        class="ui-button-primary"
        @click="saveWord"
      >
        {{ saving ? '保存中…' : alreadyInBook ? '已在单词本中' : '加入单词本' }}
      </button>
    </template>

    <DictionaryArticleDrawer
      v-if="articleWord"
      :initial-word="articleWord"
      allow-pick
      @close="articleWord = ''"
      @pick-word="onPickFromArticle"
    />
  </UiDialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import UiDialog from './UiDialog.vue';
import EnglishPronunciations from './EnglishPronunciations.vue';
import DictionaryIndexNotice from './DictionaryIndexNotice.vue';
import DictionaryArticleDrawer from './DictionaryArticleDrawer.vue';
import EnglishSensesEditor from './EnglishSensesEditor.vue';
import { newEnglishSense, withEnglishSenses, sensesFromEntry } from '../utils/englishSenses';
import EnglishCaseConfirmation from './EnglishCaseConfirmation.vue';
import api from '../api/client';
import { useEnglishWordStore } from '../stores/englishWord';
import { currentRole } from '../utils/session';
import { useAsyncScope } from '../composables/useAsyncScope';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';
import { dictionaryLookupNotice, dictionaryErrorMessage, isDictionaryAbort } from '../utils/dictionaryState';
import {
  ENGLISH_CATEGORIES,
  identityKey,
  englishCaseVariants,
  isValidEnglishWord,
  normalizeWordDisplay
} from '../utils/englishWord';

const props = defineProps({
  modelValue: Boolean,
  childId: { type: String, required: true },
  initialWord: { type: String, default: '' }
});

const emit = defineEmits(['update:modelValue', 'added']);
const store = useEnglishWordStore();
const isParent = ref(currentRole() === 'parent');

const query = ref('');
const lookingUp = ref(false);
const lookupDone = ref(false);
const lookupError = ref('');
const dictReason = ref('');
const matches = ref([]);
const selectedMatchIndex = ref(0);
const dictSuggestions = ref([]);
const suggestList = ref([]);
const audioError = ref('');
const articleWord = ref('');
const saving = ref(false);
const saveError = ref('');
const serverCaseVariants = ref([]);

const emptyForm = () => withEnglishSenses({
  word: '',
  phonetic_uk: '',
  phonetic_us: '',
  pos: '',
  definition_zh: '',
  definition_en: '',
  textbook: '',
  unit: '',
  note: '',
  categories: ['recognize', 'write'],
  strict_case: false, confirmed_case_variants: []
}, [newEnglishSense()]);
const form = ref(emptyForm());

let lookupController = null;
let suggestController = null;
let suggestTimer = null;
let lookupSerial = 0;
let suggestSerial = 0;
const { capture } = useAsyncScope(() => [props.modelValue, props.childId, store.scopeGeneration], reset);

function reset() {
  isParent.value = currentRole() === 'parent';
  lookupSerial++;
  suggestSerial++;
  clearTimeout(suggestTimer);
  lookupController?.abort();
  suggestController?.abort();
  stopDictionaryAudio();
  lookingUp.value = false;
  saving.value = false;
  lookupDone.value = false;
  lookupError.value = '';
  audioError.value = '';
  saveError.value = '';
  serverCaseVariants.value = [];
  matches.value = [];
  dictSuggestions.value = [];
  suggestList.value = [];
  articleWord.value = '';
  form.value = emptyForm();
  query.value = props.initialWord || '';
}

const activeMatch = computed(() => matches.value[selectedMatchIndex.value] || null);
const dictionaryCandidates = computed(() => identityKey(form.value.word) === identityKey(activeMatch.value?.word) ? activeMatch.value?.senses || [] : []);
const dictionaryPronunciations = computed(() => identityKey(form.value.word) === identityKey(activeMatch.value?.word) ? activeMatch.value?.pronunciations || [] : []);
const alreadyInBook = computed(() => {
  const key = identityKey(form.value.word);
  return Boolean(key && store.isWordInBook(key, props.childId));
});
const caseVariants = computed(() => englishCaseVariants(form.value.word, [
  ...(store.isLoadedFor(props.childId) ? store.words.map(word => word.word) : []), ...serverCaseVariants.value
]));
const caseConfirmed = computed(() => caseVariants.value.every(word => form.value.confirmed_case_variants.includes(word)));
watch(() => form.value.word, () => {
  serverCaseVariants.value = [];
  form.value.confirmed_case_variants = [];
}, { flush: 'sync' });

function close() {
  if (!saving.value) emit('update:modelValue', false);
}

function applyMatchToForm(match, preserveEdits = false) {
  if (!match) return;
  if ((preserveEdits || identityKey(form.value.word) === identityKey(match.word)) && (form.value.phonetic_uk || form.value.phonetic_us
    || form.value.senses.some(sense => sense.pos || sense.definition_zh || sense.definition_en || sense.example || sense.audio_refs?.length))) return;
  const senses = sensesFromEntry(match);
  form.value = withEnglishSenses({
    ...form.value,
    word: match.word || normalizeWordDisplay(query.value),
    phonetic_uk: match.phonetic_uk || '',
    phonetic_us: match.phonetic_us || (!match.phonetic_uk && match.phonetic ? match.phonetic : '')
  }, [senses[0]]);
}

function selectMatch(idx) {
  selectedMatchIndex.value = idx;
  applyMatchToForm(matches.value[idx]);
}

function toggleCat(key) {
  const cur = form.value.categories;
  form.value.categories = cur.includes(key) ? cur.filter(c => c !== key) : [...cur, key];
}

function onQueryInput() {
  lookupSerial++;
  lookupController?.abort();
  lookingUp.value = false;
  matches.value = [];
  lookupDone.value = false;
  lookupError.value = '';
  dictReason.value = '';
  const serial = ++suggestSerial;
  suggestController?.abort();
  const matchesScope = capture();
  saveError.value = '';
  clearTimeout(suggestTimer);
  suggestList.value = [];
  const text = normalizeWordDisplay(query.value);
  if (text.length < 2) {
    suggestList.value = [];
    return;
  }
  suggestTimer = setTimeout(async () => {
    suggestController?.abort();
    suggestController = new AbortController();
    try {
      const res = await api.suggestDictionary(text, 8, suggestController.signal, { silentError: true });
      if (matchesScope() && serial === suggestSerial) suggestList.value = Array.isArray(res.items) ? res.items : [];
    } catch {}
  }, 180);
}

function prepareManualWord(word) {
  if (identityKey(form.value.word) === identityKey(word)) return;
  form.value = { ...emptyForm(), word,
    textbook: form.value.textbook, unit: form.value.unit, categories: form.value.categories };
}

async function runLookup(raw) {
  const clean = normalizeWordDisplay(raw);
  if (!clean) return;
  suggestList.value = [];
  clearTimeout(suggestTimer);
  suggestSerial++;
  suggestController?.abort();

  const serial = ++lookupSerial;
  const matchesScope = capture();
  stopDictionaryAudio();
  lookupController?.abort();
  lookupController = new AbortController();
  lookingUp.value = true;
  lookupDone.value = false;
  matches.value = [];
  dictSuggestions.value = [];
  prepareManualWord(clean);
  lookupError.value = '';
  audioError.value = '';
  saveError.value = '';

  try {
    const res = await api.lookupDictionary(clean, lookupController.signal, { silentError: true, preserveError: true });
    if (!matchesScope() || serial !== lookupSerial) return;
    lookupDone.value = true;
    matches.value = Array.isArray(res.exact_matches) ? res.exact_matches : [];
    dictReason.value = dictionaryLookupNotice(res, matches.value[0])?.message || '';
    dictSuggestions.value = Array.isArray(res.suggestions) ? res.suggestions : [];
    selectedMatchIndex.value = 0;

    if (matches.value.length > 0 && identityKey(form.value.word) === identityKey(clean)) {
      applyMatchToForm(matches.value[0], true);
    }
  } catch (err) {
    if (isDictionaryAbort(err)) return;
    if (!matchesScope() || serial !== lookupSerial) return;
    lookupDone.value = true;
    lookupError.value = dictionaryErrorMessage(err);
  } finally {
    if (matchesScope() && serial === lookupSerial) lookingUp.value = false;
  }
}

function pickSuggestion(word) {
  query.value = word;
  runLookup(word);
}

function onPickFromArticle(word) {
  articleWord.value = '';
  query.value = word;
  runLookup(word);
}

async function playClip(url) {
  const matchesScope = capture();
  const serial = lookupSerial;
  audioError.value = '';
  try {
    await playDictionaryAudio(url);
  } catch (err) {
    if (matchesScope() && serial === lookupSerial) audioError.value = err?.message || '发音播放失败';
  }
}

async function saveWord() {
  if (saving.value || alreadyInBook.value) return;
  if (!isValidEnglishWord(form.value.word)) {
    saveError.value = '请输入有效的英文单词或短语';
    return;
  }
  saving.value = true;
  saveError.value = '';
  const matchesScope = capture();
  const targetWord = identityKey(form.value.word);
  try {
    const created = await store.addWord({
      child_id: props.childId,
      ...form.value,
      phonetic: form.value.phonetic_uk || form.value.phonetic_us || ''
    });
    if (matchesScope() && created) {
      emit('added', created);
      emit('update:modelValue', false);
    }
  } catch (err) {
    if (matchesScope() && targetWord === identityKey(form.value.word) && err?.code === 'ENGLISH_CASE_CONFIRMATION_REQUIRED') {
      serverCaseVariants.value = err.conflicts?.find(item => item.word === targetWord)?.variants || [];
    }
    if (matchesScope()) saveError.value = typeof err === 'string' ? err : err?.message || '保存失败，请重试';
  } finally {
    if (matchesScope()) saving.value = false;
  }
}

watch(() => props.modelValue, (open) => {
  if (open) {
    query.value = props.initialWord || '';
    if (query.value) runLookup(query.value);
  }
}, { immediate: true });
</script>
