<template>
  <UiDialog v-if="modelValue" title="批量导入语文字词" wide :busy="busy" @close="close">
    <div class="space-y-4">
      <p class="text-xs text-slate-500 dark:text-slate-400">每行一条汉字或词语，也可粘贴“字词＋制表符＋拼音”两列；纯汉字支持逗号、顿号分隔。每批最多 200 条，每条 1–8 个汉字。</p>
      <fieldset :disabled="busy || uncertain" class="space-y-4 min-w-0">
        <WordImportTarget v-model="target" :child-id="childId" language="zh" />
        <label class="block text-sm font-bold">字词列表<textarea v-model="rawText" rows="5" class="ui-input block w-full mt-1" placeholder="银行&#9;yin2 hang2&#10;长&#9;zhang3&#10;爸爸" /></label>
        <button type="button" :disabled="!rawText.trim()" class="ui-button-secondary" @click="preview">解析预览</button>
        <p v-if="rows.length" class="text-xs text-slate-500 dark:text-slate-400">自动注音请核对多音字；可逐条更正，重新解析会保留更正。数字声调如 zhang3，轻声用 0/5。</p>
        <div v-for="row in rows" :key="row.key" :data-character-import-row="row.char" class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <div class="flex flex-wrap gap-2 items-center justify-between">
            <label class="min-h-11 flex items-center gap-2"><input v-model="row.include" type="checkbox" :disabled="!row.char" class="w-5 h-5" /><span class="font-bold [overflow-wrap:anywhere]">{{ row.char || '无效条目' }}</span></label>
            <span class="text-xs">{{ labels[row.status] }}</span>
          </div>
          <label class="block text-xs">拼音<input v-model="row.draft" :aria-label="row.char + '的导入拼音'" maxlength="200" class="ui-input block w-full mt-1" @input="row.edited = true" /></label>
          <p v-if="row.draft" class="text-sm" :aria-label="row.char + '的拼音预览'">{{ displayPinyin(row.draft) }}</p>
          <p v-if="row.error" class="text-xs text-amber-700 dark:text-amber-300">{{ row.error }}</p>
          <p v-else-if="row.automatic" class="text-xs text-slate-500 dark:text-slate-400">自动注音，请确认读音</p>
        </div>
      </fieldset>
      <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
      <p v-if="uncertain" class="text-xs text-amber-700 dark:text-amber-300">导入结果尚未确认，请按原内容重试。不要改用新的请求重复导入。</p>
      <p v-if="result" role="status" class="text-sm text-emerald-700 dark:text-emerald-300">导入完成：新增 {{ result.added_count }} 项，已有字词加入词本 {{ result.linked_count }} 项，跳过 {{ result.skipped_count }} 项。</p>
    </div>
    <template #footer>
      <button type="button" :disabled="busy" class="ui-button-secondary" @click="close">关闭</button>
      <button type="button" :disabled="busy || (!uncertain && !selected.length) || Boolean(result)" class="ui-button-primary" @click="submit">{{ saving ? '导入中…' : uncertain ? '重试确认导入' : '导入所选字词' }}</button>
    </template>
  </UiDialog>
</template>
<script setup>
import { ref, computed } from 'vue';
import UiDialog from './UiDialog.vue';
import WordImportTarget from './WordImportTarget.vue';
import api from '../api/client';
import { useAsyncScope } from '../composables/useAsyncScope';
import { BOOK_REQUEST, notifyWordBooks } from '../composables/useWordBooks';
import { newRequestId } from '../utils/requestId';
import { displayPinyin } from '../utils/pinyinInput';
const props = defineProps({ modelValue: Boolean, childId: String });
const emit = defineEmits(['update:modelValue', 'imported']);
const target = ref({}), rawText = ref(''), rows = ref([]), error = ref(''), uncertain = ref(false), result = ref(null), previewing = ref(false), saving = ref(false);
const busy = computed(() => previewing.value || saving.value), selected = computed(() => rows.value.filter(row => row.include));
const labels = { new: '新增字词', link: '已有字词，将加入词本', existing: '已有散词，将跳过', in_book: '已在目标词本', conflict: '读音冲突', invalid: '无效，请更正' };
let attempt;
const { capture } = useAsyncScope(() => [props.modelValue, props.childId], () => {
  target.value = {}; rawText.value = ''; rows.value = []; error.value = ''; uncertain.value = false; result.value = null; previewing.value = false; saving.value = false; attempt = null;
});
function keyed(items) {
  const counts = new Map();
  return items.map(row => { const n = counts.get(row.char) || 0; counts.set(row.char, n + 1); return { ...row, key: row.char + ':' + n }; });
}
async function preview() {
  if (busy.value || uncertain.value) return;
  const matches = capture(), corrections = new Map(rows.value.filter(row => row.edited).map(row => [row.key, row.draft]));
  previewing.value = true; error.value = ''; result.value = null; attempt = null;
  try {
    let response = await api.previewCharacterBatch({ child_id: props.childId, text: rawText.value, ...target.value }, BOOK_REQUEST);
    if (!matches()) return;
    if (corrections.size) response = await api.previewCharacterBatch({ child_id: props.childId, ...target.value,
      items: keyed(response.items).map(row => ({ char: row.char, pinyin: corrections.get(row.key) ?? row.input_pinyin,
        ...(row.status === 'invalid' && !corrections.has(row.key) ? { error: row.error } : {}) })) }, BOOK_REQUEST);
    if (!matches()) return;
    rows.value = keyed(response.items).map(row => ({ ...row, draft: corrections.get(row.key) ?? row.pinyin ?? row.input_pinyin,
      edited: corrections.has(row.key), include: !['invalid', 'conflict'].includes(row.status) }));
  } catch (err) { if (matches()) error.value = err?.message || String(err); }
  finally { if (matches()) previewing.value = false; }
}
async function submit() {
  if (busy.value || result.value) return;
  const matches = capture(); saving.value = true; error.value = '';
  if (!attempt) attempt = { child_id: props.childId, items: selected.value.map(row => ({ char: row.char, pinyin: row.draft })), ...JSON.parse(JSON.stringify(target.value)), request_id: newRequestId() };
  try {
    const response = await api.importCharacterBatch(attempt, BOOK_REQUEST);
    if (!matches()) return;
    result.value = response; uncertain.value = false; attempt = null;
    notifyWordBooks(props.childId, 'zh'); emit('imported');
  } catch (err) { if (matches()) { error.value = err?.message || String(err); uncertain.value = Boolean(err?.networkFailure); if (!uncertain.value) attempt = null; } }
  finally { if (matches()) saving.value = false; }
}
function close() { if (!busy.value) emit('update:modelValue', false); }
</script>
