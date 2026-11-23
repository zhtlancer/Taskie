<template>
  <section class="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800" aria-label="学习词本范围">
    <label class="block text-xs font-bold">字词来源范围
      <select :value="modelValue.scope_mode" aria-label="字词来源范围" class="ui-input block w-full mt-1" @change="changeMode($event.target.value)">
        <option value="all">全部字词（含未分本）</option><option value="books">指定词本</option><option v-if="allowLegacy" value="legacy">保留原教材/单元范围</option>
      </select>
    </label>
    <template v-if="modelValue.scope_mode === 'books'">
      <p class="text-xs text-slate-500 dark:text-slate-400">同一技能的清单和加练中，每个字词每天只选一次。语文多本读音不同时，采用排在前面的词本读音；复习进度仍按字词统一跟踪。</p>
      <p v-if="error" role="alert" class="text-xs text-rose-600 dark:text-rose-300">{{ error }} <button type="button" class="min-h-11 underline" @click="load">重试读取词本</button></p>
      <details v-for="group in groups" :key="group.source" open class="rounded-xl border border-slate-200 dark:border-slate-700 p-2 min-w-0">
        <summary class="min-h-11 flex items-center cursor-pointer text-xs font-bold [overflow-wrap:anywhere]">{{ group.label }}</summary>
        <label v-for="book in group.books" :key="book.id" class="min-h-11 flex items-center gap-2 text-xs [overflow-wrap:anywhere]">
          <input type="checkbox" :checked="modelValue.book_ids.includes(book.id)" :aria-label="'选择词本「' + book.name + '」'" class="w-5 h-5 shrink-0" @change="toggle(book.id)" />{{ book.name }}（{{ book.item_count }} 项）
        </label>
      </details>
      <p v-if="!loading && !books.length && !error" class="text-xs text-slate-500 dark:text-slate-400">暂无词本，请先到字词本整理来源。</p>
      <p v-if="!modelValue.book_ids.length" role="alert" class="text-xs text-amber-700 dark:text-amber-300">未选择有效词本，计划将等待重新配置，不会扩大为全部字词。</p>
      <ol class="space-y-1">
        <li v-for="(id, index) in modelValue.book_ids" :key="id" class="flex flex-wrap items-center gap-2 text-xs">
          <span class="min-w-0 flex-1 [overflow-wrap:anywhere]">{{ index + 1 }}. {{ books.find(book => book.id === id)?.name || '已不可用的词本' }}</span>
          <button type="button" :disabled="index === 0" class="ui-button-secondary" :aria-label="'提高第 ' + (index + 1) + ' 本优先级'" @click="move(index, -1)">上移</button>
          <button type="button" :disabled="index === modelValue.book_ids.length - 1" class="ui-button-secondary" :aria-label="'降低第 ' + (index + 1) + ' 本优先级'" @click="move(index, 1)">下移</button>
        </li>
      </ol>
      <p v-if="previewError" role="alert" class="text-xs text-rose-600 dark:text-rose-300">{{ previewError }} <button type="button" class="min-h-11 underline" @click="previewScope">重试核对范围</button></p>
      <div v-if="preview && (preview.conflict_count || preview.invalid_count)" class="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1">
        <p v-if="preview.conflict_count">有 {{ preview.conflict_count }} 项读音不同，以下为当前采用的读音：</p>
        <p v-for="item in preview.conflicts" :key="item.id" class="[overflow-wrap:anywhere]">{{ item.text }}：{{ item.chosen.pinyin || '需要补全' }}（{{ item.chosen.source_book_name }}）</p>
        <p v-if="preview.invalid_count">{{ preview.invalid_count }} 项拼音无效，暂不加入新清单；请到词本管理中补全。</p>
      </div>
    </template>
  </section>
</template>
<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import api from '../api/client';
import { useWordBooks, BOOK_REQUEST } from '../composables/useWordBooks';
import { useAsyncScope } from '../composables/useAsyncScope';
import { groupWordBooks } from '../utils/wordBookSource';
const props = defineProps({ childId: String, language: String, modelValue: { type: Object, required: true }, allowLegacy: Boolean });
const emit = defineEmits(['update:modelValue']);
const { books, loading, error, load } = useWordBooks(() => props.childId, () => props.language);
const groups = computed(() => groupWordBooks(books.value)), preview = ref(null), previewError = ref('');
let serial = 0, timer;
const { capture } = useAsyncScope(() => [props.childId, props.language], () => { serial++; clearTimeout(timer); preview.value = null; previewError.value = ''; });
function changeMode(mode) { emit('update:modelValue', { scope_mode: mode, book_ids: mode === 'books' ? [...props.modelValue.book_ids] : [] }); }
function toggle(id) { const ids = props.modelValue.book_ids; emit('update:modelValue', { scope_mode: 'books', book_ids: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] }); }
function move(index, direction) { const ids = [...props.modelValue.book_ids]; [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]; emit('update:modelValue', { scope_mode: 'books', book_ids: ids }); }
async function previewScope() {
  const request = ++serial, matches = capture(); preview.value = null; previewError.value = '';
  if (props.modelValue.scope_mode !== 'books' || !props.modelValue.book_ids.length) return;
  try {
    const result = await api.previewWordStudyScope(props.childId, props.language, [...props.modelValue.book_ids], BOOK_REQUEST);
    if (matches() && request === serial) preview.value = result;
  } catch (err) { if (matches() && request === serial) previewError.value = err?.message || String(err); }
}
watch(() => [props.modelValue.scope_mode, JSON.stringify(props.modelValue.book_ids), props.childId, props.language], () => {
  serial++; clearTimeout(timer); preview.value = null; previewError.value = ''; timer = setTimeout(previewScope, 250);
}, { immediate: true });
onBeforeUnmount(() => { serial++; clearTimeout(timer); });
</script>
