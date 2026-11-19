<template>
  <UiDialog v-if="modelValue" title="批量导入英语单词" wide :busy="busy" @close="close">
    <div class="space-y-4">
      <p class="text-xs font-bold text-slate-500 dark:text-slate-400">
        每行输入一个单词或短语，也可从表格粘贴“英文＋制表符＋中文释义”两列（最多 100 个）。纯英文列表也支持逗号分隔；填写的释义会优先保留。
      </p>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
          统一教材/分类（选填）
          <input
            v-model="textbook"
            :disabled="!isParent"
            type="text"
            placeholder="如 人教版四年级"
            class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
          />
        </label>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
          统一单元（选填）
          <input
            v-model="unit"
            :disabled="!isParent"
            type="text"
            placeholder="如 Unit 2"
            class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold text-slate-800 dark:text-slate-100"
          />
        </label>
      </div>

      <p v-if="!isParent" class="text-xs font-bold text-slate-500 dark:text-slate-400">教材和单元由家长设置，单词仍可自行导入。</p>

      <div>
        <span class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">默认分类：</span>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="cat in ENGLISH_CATEGORIES"
            :key="cat.key"
            type="button"
            :aria-pressed="categories.includes(cat.key)"
            class="min-h-11 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all"
            :class="categories.includes(cat.key)
              ? cat.chip
              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
            @click="toggleCat(cat.key)"
          >
            {{ cat.icon }} {{ cat.label }}
          </button>
        </div>
      </div>

      <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
        单词列表
        <textarea
          v-model="rawText"
          rows="4"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="apple&#10;book&#10;look after"
          class="mt-1 w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm font-bold text-slate-800 dark:text-slate-100"
        />
      </label>

      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          :disabled="busy || !rawText.trim()"
          class="min-h-11 px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-black disabled:opacity-50"
          @click="runPreview()"
        >
          {{ previewing ? '解析匹配中…' : '解析预览' }}
        </button>
        <button type="button" :disabled="busy || !rawText.trim()" class="ui-button-secondary min-h-11" @click="runPreview(false)">不查词，手工预览</button>
        <span v-if="previewItems.length" class="text-xs font-bold text-slate-500 dark:text-slate-400">
          可导入 {{ selectedItems.length }} · 已存在跳过 {{ duplicateCount }} · 需手填释义 {{ manualCount }}
        </span>
      </div>

      <DictionaryIndexNotice v-if="previewing && previewUsesDictionary" />
      <p v-if="error" role="alert" class="text-xs font-bold text-rose-600 dark:text-rose-300">{{ error }}</p>
      <div v-if="dictionaryWarnings.length" data-dictionary-batch-warning role="status" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
        <p v-for="notice in dictionaryWarnings" :key="notice.code">{{ notice.message }}</p>
        <p>已填释义和已匹配结果会保留，可直接手工填写后导入；再次解析只更新词典候选，不覆盖更正。</p>
      </div>

      <!-- Preview list -->
      <div v-if="previewItems.length" class="space-y-2 max-h-72 overflow-y-auto pr-1">
        <div
          v-for="(item, idx) in previewItems"
          :key="`${item.word}-${idx}`"
          :data-english-import-word="item.word"
          class="rounded-2xl border p-3 space-y-2"
          :class="rowStyle(item.status)"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2 min-w-0">
              <label v-if="item.status === 'matched' || item.status === 'manual'" class="inline-flex items-center gap-2 cursor-pointer">
                <input v-model="item.include" type="checkbox" class="w-4 h-4 accent-brand-500" />
                <span class="text-sm font-black text-slate-900 dark:text-slate-100">{{ item.word }}</span>
              </label>
              <span v-else class="text-sm font-black text-slate-700 dark:text-slate-200">{{ item.word }}</span>

              <span v-if="item.phonetic" class="text-xs font-mono text-cyan-700 dark:text-cyan-300">/{{ item.phonetic }}/</span>
            </div>

            <span class="text-xs font-bold px-2 py-0.5 rounded-full" :class="badgeStyle(item.status)">
              {{ statusLabel(item) }}
            </span>
          </div>

          <div v-if="item.status === 'matched' || item.status === 'manual'" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              v-model="item.definition_zh"
              @input="syncPrimary(item, 'definition_zh', $event.target.value)"
              type="text"
              placeholder="中文释义（如：苹果；也可导入后补填）"
              maxlength="400"
              class="w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100"
            />
            <input
              v-model="item.definition_en"
              @input="syncPrimary(item, 'definition_en', $event.target.value)"
              type="text"
              placeholder="英文释义（选填）"
              maxlength="400"
              class="w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100"
            />
          </div>
          <details v-if="item.status === 'matched' || item.status === 'manual'">
            <summary class="min-h-11 flex items-center cursor-pointer text-xs font-bold text-brand-700 dark:text-brand-300">管理义项与例句</summary>
            <EnglishSensesEditor v-model="previewItems[idx]" :candidates="item.dictionary_candidates || []" :disabled="busy" />
          </details>
          <template v-if="item.status === 'matched' || item.status === 'manual'">
            <label class="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-700 dark:text-slate-200">
              <input v-model="item.strict_case" :disabled="busy" type="checkbox" class="w-5 h-5 accent-brand-500" />
              默写时严格区分大小写
            </label>
            <EnglishCaseConfirmation v-model="item.confirmed_case_variants" :word="item.word" :variants="caseVariantsForItem(item)" :disabled="busy" />
          </template>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" :disabled="busy" class="ui-button-secondary" @click="close">取消</button>
      <button
        type="button"
        :disabled="busy || selectedItems.length === 0 || !caseConfirmed"
        class="ui-button-primary"
        @click="commitImport"
      >
        {{ importing ? '导入中…' : `确认导入 (${selectedItems.length})` }}
      </button>
    </template>
  </UiDialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import EnglishSensesEditor from './EnglishSensesEditor.vue';
import { mergeEnglishBatchPreview } from '../utils/englishBatchPreview';
import UiDialog from './UiDialog.vue';
import DictionaryIndexNotice from './DictionaryIndexNotice.vue';
import EnglishCaseConfirmation from './EnglishCaseConfirmation.vue';
import api from '../api/client';
import { useEnglishWordStore } from '../stores/englishWord';
import { ENGLISH_CATEGORIES, englishCaseVariants, hasEnglishDefinition } from '../utils/englishWord';
import { currentRole } from '../utils/session';
import { useAsyncScope } from '../composables/useAsyncScope';

const props = defineProps({
  modelValue: Boolean,
  childId: { type: String, required: true }
});

const emit = defineEmits(['update:modelValue', 'imported']);
const store = useEnglishWordStore();
const isParent = ref(currentRole() === 'parent');

const rawText = ref('');
const textbook = ref('');
const unit = ref('');
const categories = ref(['recognize', 'write']);
const previewItems = ref([]);
const previewing = ref(false);
const previewUsesDictionary = ref(true);
const importing = ref(false);
const error = ref('');
const dictionaryWarnings = ref([]);
let previewSerial = 0;
const { capture } = useAsyncScope(() => [props.modelValue, props.childId, store.scopeGeneration], () => {
  isParent.value = currentRole() === 'parent';
  previewSerial++;
  previewing.value = false;
  importing.value = false;
  previewItems.value = [];
  error.value = '';
  dictionaryWarnings.value = [];
  rawText.value = '';
  textbook.value = '';
  unit.value = '';
  categories.value = ['recognize', 'write'];
});

watch(rawText, () => {
  previewSerial++;
  previewing.value = false;
  previewItems.value = [];
  error.value = '';
  dictionaryWarnings.value = [];
}, { flush: 'sync' });

const busy = computed(() => previewing.value || importing.value);
const selectedItems = computed(() => previewItems.value.filter(i => i.include && (i.status === 'matched' || i.status === 'manual')));
const duplicateCount = computed(() => previewItems.value.filter(i => i.status === 'duplicate').length);
const manualCount = computed(() => selectedItems.value.filter(item => !hasEnglishDefinition(item)).length);
const caseConfirmed = computed(() => selectedItems.value.every(item => caseVariantsForItem(item).every(word => item.confirmed_case_variants.includes(word))));

function caseVariantsForItem(item) {
  return englishCaseVariants(item.word, [...(item.existing_case_variants || []),
    ...selectedItems.value.map(row => row.word), ...(item.server_case_variants || [])]);
}

function close() {
  if (!busy.value) emit('update:modelValue', false);
}

function toggleCat(key) {
  categories.value = categories.value.includes(key)
    ? categories.value.filter(k => k !== key)
    : [...categories.value, key];
}

function statusLabel(item) {
  const { status, error: errMsg, dictionary_notice: notice } = item;
  if (status === 'matched') return '词典已匹配';
  if (status === 'manual') return ({ DICTIONARY_UNCONFIGURED: '未配置词典（可手填）', DICTIONARY_NOT_READY: '词典未就绪（可手填）',
    DICTIONARY_NOT_FOUND: '词典未收录（可手填）', DICTIONARY_MANUAL: '手工填写' }[notice?.code] || '查词不可用（可手填）');
  if (status === 'duplicate') return '已在单词本中（跳过）';
  return errMsg || '格式无效';
}

function badgeStyle(status) {
  if (status === 'matched') return 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300';
  if (status === 'manual') return 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-200';
  if (status === 'duplicate') return 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300';
  return 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300';
}

function rowStyle(status) {
  if (status === 'duplicate' || status === 'invalid') {
    return 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 opacity-75';
  }
  return 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60';
}

async function runPreview(useDictionary = true) {
  if (busy.value || !rawText.value.trim()) return;
  previewing.value = true;
  previewUsesDictionary.value = useDictionary;
  error.value = '';
  const serial = ++previewSerial;
  const matchesScope = capture();
  try {
    const res = await api.previewEnglishBatch(props.childId, rawText.value, { silentError: true, preserveError: true }, useDictionary);
    if (!matchesScope() || serial !== previewSerial) return;
    previewItems.value = mergeEnglishBatchPreview(previewItems.value, res.items || []);
    dictionaryWarnings.value = Array.isArray(res.dictionary_warnings) ? res.dictionary_warnings : [];
  } catch (err) {
    if (matchesScope() && serial === previewSerial) error.value = err?.message || '解析预览失败';
  } finally {
    if (matchesScope() && serial === previewSerial) previewing.value = false;
  }
}

function syncPrimary(item, key, value) {
  item[key] = value;
  item.senses = item.senses.map(sense => sense.id === item.primary_sense_id
    ? { ...sense, definition_zh: item.definition_zh, definition_en: item.definition_en } : sense);
}

async function commitImport() {
  if (busy.value || !selectedItems.value.length) return;
  importing.value = true;
  error.value = '';
  const matchesScope = capture();
  try {
    const res = await store.batchImportWords({
      child_id: props.childId,
      ...(isParent.value ? { textbook: textbook.value, unit: unit.value } : {}),
      categories: categories.value,
      items: selectedItems.value.map(i => ({
        word: i.word,
        phonetic: i.phonetic,
        phonetic_uk: i.phonetic_uk,
        phonetic_us: i.phonetic_us,
        pos: i.pos,
        definition_zh: i.definition_zh,
        definition_en: i.definition_en,
        senses: i.senses, primary_sense_id: i.primary_sense_id,
        strict_case: i.strict_case, confirmed_case_variants: i.confirmed_case_variants
      }))
    });
    if (matchesScope() && res) {
      emit('imported', res);
      emit('update:modelValue', false);
    }
  } catch (err) {
    if (matchesScope() && err?.code === 'ENGLISH_CASE_CONFIRMATION_REQUIRED') {
      for (const item of previewItems.value) {
        item.server_case_variants = err.conflicts?.find(conflict => conflict.word === item.word)?.variants || [];
      }
    }
    if (matchesScope()) error.value = err?.message || '导入失败，请重试';
  } finally {
    if (matchesScope()) importing.value = false;
  }
}

</script>
