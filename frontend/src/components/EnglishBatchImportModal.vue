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
          @click="runPreview"
        >
          {{ previewing ? '解析匹配中…' : '解析预览' }}
        </button>
        <span v-if="previewItems.length" class="text-xs font-bold text-slate-500 dark:text-slate-400">
          可导入 {{ selectedItems.length }} · 已存在跳过 {{ duplicateCount }} · 需手填释义 {{ manualCount }}
        </span>
      </div>

      <p v-if="error" role="alert" class="text-xs font-bold text-rose-600 dark:text-rose-300">{{ error }}</p>

      <!-- Preview list -->
      <div v-if="previewItems.length" class="space-y-2 max-h-72 overflow-y-auto pr-1">
        <div
          v-for="(item, idx) in previewItems"
          :key="`${item.word}-${idx}`"
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
              {{ statusLabel(item.status, item.error) }}
            </span>
          </div>

          <div v-if="item.status === 'matched' || item.status === 'manual'" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              v-model="item.definition_zh"
              type="text"
              placeholder="中文释义（如：苹果；也可导入后补填）"
              class="w-full min-h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100"
            />
            <input
              v-model="item.definition_en"
              type="text"
              placeholder="英文释义（选填）"
              class="w-full min-h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button type="button" :disabled="busy" class="ui-button-secondary" @click="close">取消</button>
      <button
        type="button"
        :disabled="busy || selectedItems.length === 0"
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
import UiDialog from './UiDialog.vue';
import api from '../api/client';
import { useEnglishWordStore } from '../stores/englishWord';
import { ENGLISH_CATEGORIES } from '../utils/englishWord';
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
const importing = ref(false);
const error = ref('');
let previewSerial = 0;
const { capture } = useAsyncScope(() => [props.modelValue, props.childId, store.scopeGeneration], () => {
  isParent.value = currentRole() === 'parent';
  previewSerial++;
  previewing.value = false;
  importing.value = false;
  previewItems.value = [];
  error.value = '';
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
}, { flush: 'sync' });

const busy = computed(() => previewing.value || importing.value);
const selectedItems = computed(() => previewItems.value.filter(i => i.include && (i.status === 'matched' || i.status === 'manual')));
const duplicateCount = computed(() => previewItems.value.filter(i => i.status === 'duplicate').length);
const manualCount = computed(() => previewItems.value.filter(i => i.status === 'manual').length);

function close() {
  if (!busy.value) emit('update:modelValue', false);
}

function toggleCat(key) {
  categories.value = categories.value.includes(key)
    ? categories.value.filter(k => k !== key)
    : [...categories.value, key];
}

function statusLabel(status, errMsg) {
  if (status === 'matched') return '词典已匹配';
  if (status === 'manual') return '词典未收录（可手填）';
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

async function runPreview() {
  if (busy.value || !rawText.value.trim()) return;
  previewing.value = true;
  error.value = '';
  const serial = ++previewSerial;
  const matchesScope = capture();
  try {
    const res = await api.previewEnglishBatch(props.childId, rawText.value, { silentError: true, preserveError: true });
    if (!matchesScope() || serial !== previewSerial) return;
    previewItems.value = (res.items || []).map(item => ({
      ...item,
      include: item.status === 'matched' || item.status === 'manual'
    }));
  } catch (err) {
    if (matchesScope() && serial === previewSerial) error.value = err?.message || '解析预览失败';
  } finally {
    if (matchesScope() && serial === previewSerial) previewing.value = false;
  }
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
        definition_en: i.definition_en
      }))
    });
    if (matchesScope() && res) {
      emit('imported', res);
      emit('update:modelValue', false);
    }
  } catch (err) {
    if (matchesScope()) error.value = err?.message || '导入失败，请重试';
  } finally {
    if (matchesScope()) importing.value = false;
  }
}

</script>
