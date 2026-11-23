<template>
  <section class="mb-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-3" aria-label="词本与来源">
    <div class="flex flex-wrap items-center gap-2">
      <label class="min-w-0 flex-1 text-xs font-bold">按词本筛选
        <select :value="modelValue" :disabled="busy || loading" aria-label="按词本筛选" class="ui-input block w-full min-w-0 max-w-full mt-1" @change="$emit('update:modelValue', $event.target.value)">
          <option value="all">全部字词</option><option value="unassigned">未分本</option>
          <optgroup v-for="group in groups" :key="group.source" :label="group.label"><option v-for="book in group.books" :key="book.id" :value="book.id">{{ book.name }}（{{ book.item_count }}）</option></optgroup>
        </select>
      </label>
      <template v-if="role === 'parent'">
        <button type="button" :disabled="busy || loading || Boolean(error)" class="ui-button-secondary" @click="openEditor()">新建词本</button>
        <button v-if="selected" type="button" :disabled="busy" class="ui-button-secondary" @click="openEditor(selected)">编辑词本</button>
        <button v-if="selected" type="button" :disabled="busy" class="ui-button-secondary" @click="managing = true">管理词条</button>
      </template>
      <router-link v-if="selected && !busy" :to="{ path: `/child/${childId}/word-test`, query: { language, book: selected.id } }" class="ui-button-secondary">按此词本自测</router-link>
    </div>
    <p v-if="error" role="alert" class="text-xs text-rose-600 dark:text-rose-300">{{ error }} <button type="button" class="min-h-11 underline" @click="load">重试读取词本</button></p>
    <p v-if="!loading && !error && modelValue !== 'all' && modelValue !== 'unassigned' && !selected" role="alert" class="text-xs text-amber-700 dark:text-amber-300">所选词本已不可用，请重新选择范围。</p>
    <div v-if="selected" class="text-xs text-slate-500 dark:text-slate-400 space-y-1 [overflow-wrap:anywhere]">
      <p>{{ typeLabel(selected.source_type) }} · {{ selected.source || '未填写来源' }}<span v-if="selected.unit"> · {{ selected.unit }}</span> · {{ selected.item_count }} 项，未掌握 {{ selected.unmastered_count }} 项</p>
      <p v-if="selected.note">{{ selected.note }}</p>
      <router-link v-if="selected.recent_test && !busy" :to="{ path: `/child/${childId}/word-test`, query: { language, test: selected.recent_test.id } }" class="inline-flex items-center min-h-11 underline">最近自测：本词本正确 {{ selected.recent_test.correct_count }}/{{ selected.recent_test.total_count }} 题</router-link>
    </div>
    <UiDialog v-if="editor" :title="editor.id ? '编辑词本' : '新建词本'" :busy="busy" @close="editor = null">
      <form class="space-y-3" @submit.prevent="save">
        <fieldset :disabled="busy || uncertain" class="space-y-3 min-w-0">
          <WordBookFields v-model="editor" :sources="sources" />
        </fieldset>
        <p v-if="actionError" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ actionError }}</p>
        <p v-if="uncertain" class="text-xs text-amber-700 dark:text-amber-300">保存结果尚未确认，请按原内容重试或关闭后核对词本列表。</p>
        <button type="submit" :disabled="busy" class="ui-button-primary w-full">{{ busy ? '保存中…' : uncertain ? '重试确认保存' : '保存词本' }}</button>
      </form>
      <template #footer>
        <button v-if="editor.id" type="button" :disabled="busy || uncertain" class="ui-button-secondary text-rose-600 dark:text-rose-300" @click="removeBook">删除词本</button>
        <button type="button" :disabled="busy" class="ui-button-secondary" @click="editor = null">取消</button>
      </template>
    </UiDialog>
    <UiDialog v-if="managing && selected" :title="'管理词条 · ' + selected.name" :busy="busy" wide @close="managing = false">
      <p class="text-xs text-slate-500 dark:text-slate-400 mb-3">加入或移出只改变本词本归属，不删除字词。语文读音留空时继承主拼音。</p>
      <input v-model="search" type="search" aria-label="搜索待归类字词" placeholder="搜索字词…" class="ui-input block w-full mb-3" />
      <p v-if="actionError" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ actionError }}</p>
      <div class="space-y-2">
        <div v-for="entry in managerEntries" :key="entry.id" class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <div class="flex flex-wrap justify-between items-center gap-2"><span class="font-bold [overflow-wrap:anywhere]">{{ entry.char || entry.word }}</span>
            <button type="button" :disabled="busy" class="ui-button-secondary" :aria-label="(membership(entry) ? '移出' : '加入') + '「' + (entry.char || entry.word) + '」'" @click="toggleEntry(entry)">{{ membership(entry) ? '移出本词本' : '加入本词本' }}</button>
          </div>
          <div v-if="language === 'zh' && membership(entry)" class="flex flex-wrap gap-2">
            <label class="flex-1 min-w-0 text-xs">本词本读音<input :value="pinyinDrafts[entry.id] ?? membership(entry).pinyin_override ?? ''" :disabled="busy" class="ui-input block w-full mt-1" :aria-label="'「' + entry.char + '」在本词本的读音'" placeholder="留空继承主拼音，如 zhang3" @input="pinyinDrafts[entry.id] = $event.target.value" /></label>
            <button type="button" :disabled="busy" class="ui-button-secondary self-end" @click="savePinyin(entry)">保存读音</button>
          </div>
        </div>
        <p v-if="!managerEntries.length" class="text-sm text-slate-500">暂无匹配字词，请先收录字词。</p>
      </div>
    </UiDialog>
  </section>
</template>
<script setup>
import { ref, computed, watch } from 'vue';
import UiDialog from './UiDialog.vue';
import WordBookFields from './WordBookFields.vue';
import api from '../api/client';
import { getDataGeneration } from '../utils/session';
import { useAsyncScope } from '../composables/useAsyncScope';
import { useWordBooks, BOOK_REQUEST, notifyWordBooks } from '../composables/useWordBooks';
import { SOURCE_TYPES, groupWordBooks, createPendingBookLinks } from '../utils/wordBookSource';
import { confirmAction } from '../utils/confirmation';
import { newRequestId } from '../utils/requestId';
const props = defineProps({ childId: String, language: String, entries: { type: Array, default: () => [] }, modelValue: { type: String, default: 'all' } });
const emit = defineEmits(['update:modelValue', 'changed']);
const { books, loading, error, load, role } = useWordBooks(() => props.childId, () => props.language);
const groups = computed(() => groupWordBooks(books.value));
const sources = computed(() => [...new Set(books.value.map(book => book.source).filter(Boolean))]);
const selected = computed(() => books.value.find(book => book.id === props.modelValue));
const editor = ref(null), managing = ref(false), busy = ref(false), uncertain = ref(false), actionError = ref(''), search = ref(''), pinyinDrafts = ref({});
let attempt = null, generation;
const pendingLinks = createPendingBookLinks();
const { capture } = useAsyncScope(() => [props.childId, props.language, props.modelValue], () => {
  editor.value = null; managing.value = false; busy.value = false; uncertain.value = false; actionError.value = ''; attempt = null; pinyinDrafts.value = {}; pendingLinks.clear();
});
const managerEntries = computed(() => props.entries.filter(entry => (entry.char || entry.word).toLowerCase().includes(search.value.trim().toLowerCase())));
const membership = entry => entry.books?.find(book => book.id === props.modelValue);
const typeLabel = value => SOURCE_TYPES.find(type => type.value === value)?.label || '未指定';
function openEditor(book = null) {
  actionError.value = ''; uncertain.value = false; attempt = null; generation = getDataGeneration();
  editor.value = book ? { ...book } : { name: '', source: '', unit: '', source_type: '', note: '' };
}
function changed() { notifyWordBooks(props.childId, props.language); emit('changed'); }
async function save() {
  if (busy.value || !editor.value) return;
  const matches = capture(), editing = editor.value.id;
  if (!attempt) attempt = { child_id: props.childId, language: props.language, name: editor.value.name, source: editor.value.source,
    unit: editor.value.unit, source_type: editor.value.source_type, note: editor.value.note,
    ...(editing ? { expected_version: editor.value.version } : { request_id: newRequestId() }) };
  busy.value = true; actionError.value = '';
  try {
    const result = editing ? await api.updateWordBook(editing, attempt, BOOK_REQUEST, generation) : await api.createWordBook(attempt, BOOK_REQUEST);
    if (!matches()) return;
    editor.value = null; uncertain.value = false; attempt = null; changed(); emit('update:modelValue', result.id);
  } catch (err) { if (matches()) { actionError.value = err?.message || String(err); uncertain.value = Boolean(err?.networkFailure); if (!uncertain.value) attempt = null; } }
  finally { if (matches()) busy.value = false; }
}
async function removeBook() {
  if (busy.value || !editor.value?.id) return;
  const matches = capture(), target = { ...editor.value };
  busy.value = true; actionError.value = '';
  try {
    const latest = await api.getWordBook(target.id, undefined, BOOK_REQUEST);
    if (!matches()) return;
    if (latest.version !== target.version) throw new Error('词本已被修改，请关闭后重新读取，再核对是否删除。');
    busy.value = false;
    if (!await confirmAction(`删除词本只移除归属，字词与学习记录会保留。${latest.plan_count ? `有 ${latest.plan_count} 个学习计划引用本词本；删除后会移除该范围，选本为空的计划等待重新配置。` : ''}当天已有清单不变，确定删除吗？`) || !matches()) return;
    busy.value = true;
    await api.deleteWordBook(target.id, target.version, BOOK_REQUEST, generation);
    if (matches()) { editor.value = null; changed(); emit('update:modelValue', 'all'); }
  }
  catch (err) { if (matches()) actionError.value = err?.message || String(err); }
  finally { if (matches()) busy.value = false; }
}
async function mutateEntry(operation) {
  if (busy.value) return;
  const matches = capture(); busy.value = true; actionError.value = '';
  try { await operation(matches); if (matches()) { changed(); pinyinDrafts.value = {}; } }
  catch (err) { if (matches()) actionError.value = err?.message || String(err); }
  finally { if (matches()) busy.value = false; }
}
async function toggleEntry(entry) {
  if (busy.value) return;
  const member = membership(entry), target = props.modelValue;
  const key = target + ':' + entry.id;
  return mutateEntry(matches => member
    ? api.deleteWordBookItem(target, member.item_id, member.item_version, BOOK_REQUEST, getDataGeneration())
    : pendingLinks.run(
      key,
      () => ({ [props.language === 'zh' ? 'character_id' : 'english_word_id']: entry.id }),
      payload => api.addWordBookItem(target, payload, BOOK_REQUEST),
      matches
    ));
}
function savePinyin(entry) {
  const member = membership(entry);
  return mutateEntry(() => api.updateWordBookItem(props.modelValue, member.item_id, { expected_version: member.item_version, pinyin_override: pinyinDrafts.value[entry.id] ?? member.pinyin_override ?? '' }, BOOK_REQUEST, getDataGeneration()));
}
watch(managing, open => { actionError.value = ''; search.value = ''; pinyinDrafts.value = {}; if (!open) pendingLinks.clear(); });
</script>
