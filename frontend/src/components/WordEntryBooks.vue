<template>
  <section class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2" aria-label="字词的词本归属">
    <p class="text-xs font-bold">所属词本</p>
    <div v-if="current.books?.length" class="flex flex-wrap gap-2">
      <div v-for="book in current.books" :key="book.id" class="max-w-full flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-2 text-xs [overflow-wrap:anywhere]">
        <span>{{ book.name }}<span v-if="book.pinyin_override"> · {{ book.pinyin_override }}</span></span>
        <button v-if="role === 'parent'" type="button" :disabled="busy || disabled" class="min-h-11 px-2 font-bold text-rose-600 dark:text-rose-300" :aria-label="'从「' + book.name + '」移出'" @click="remove(book)">移出</button>
      </div>
    </div>
    <p v-else class="text-xs text-slate-500 dark:text-slate-400">未分本</p>
    <div v-if="role === 'parent'" class="flex flex-wrap gap-2">
      <select v-model="target" aria-label="加入已有词本" :disabled="busy || disabled || loading" class="ui-input flex-1 min-w-0 max-w-full text-sm">
        <option value="">选择词本</option><optgroup v-for="group in groups" :key="group.source" :label="group.label"><option v-for="book in group.books" :key="book.id" :value="book.id" :disabled="current.books?.some(item => item.id === book.id)">{{ book.name }}</option></optgroup>
      </select>
      <button type="button" :disabled="busy || disabled || !target" class="ui-button-secondary" @click="add">加入词本</button>
    </div>
    <p v-if="error || localError" role="alert" class="text-xs text-rose-600 dark:text-rose-300">{{ localError || error }} <button v-if="error" type="button" :disabled="busy || disabled" class="min-h-11 underline" @click="load">重试读取词本</button></p>
  </section>
</template>
<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import api from '../api/client';
import { useAsyncScope } from '../composables/useAsyncScope';
import { useWordBooks, BOOK_REQUEST, notifyWordBooks } from '../composables/useWordBooks';
import { groupWordBooks } from '../utils/wordBookSource';
import { getDataGeneration } from '../utils/session';
import { newRequestId } from '../utils/requestId';
const props = defineProps({ entry: Object, language: String, disabled: Boolean });
const emit = defineEmits(['updated', 'busy']);
const current = ref(props.entry), target = ref(''), busy = ref(false), localError = ref('');
const { books, role, loading, error, load } = useWordBooks(() => props.entry.child_id, () => props.language);
const groups = computed(() => groupWordBooks(books.value));
const { capture } = useAsyncScope(() => [props.entry.id, props.entry.child_id, props.language], () => {
  busy.value = false; emit('busy', false); localError.value = ''; target.value = ''; attempts.clear();
});
const attempts = new Map();
watch(() => props.entry, value => { current.value = value; });
async function change(operation) {
  if (busy.value || props.disabled) return;
  const matches = capture(), id = props.entry.id, childId = props.entry.child_id, lang = props.language;
  busy.value = true; emit('busy', true); localError.value = '';
  try {
    await operation();
    if (!matches()) return;
    notifyWordBooks(childId, lang);
    const fresh = lang === 'zh' ? await api.getCharacter(id, undefined, BOOK_REQUEST) : await api.getEnglishWord(id, undefined, BOOK_REQUEST);
    if (matches()) { current.value = fresh; target.value = ''; emit('updated', fresh); }
  } catch (err) { if (matches()) localError.value = err?.message || String(err); }
  finally { if (matches()) { busy.value = false; emit('busy', false); } }
}
function add() {
  const bookId = target.value;
  if (!attempts.has(bookId)) attempts.set(bookId, { [props.language === 'zh' ? 'character_id' : 'english_word_id']: props.entry.id, request_id: newRequestId() });
  return change(async () => { await api.addWordBookItem(bookId, attempts.get(bookId), BOOK_REQUEST); attempts.delete(bookId); });
}
const remove = book => change(() => api.deleteWordBookItem(book.id, book.item_id, book.item_version, BOOK_REQUEST, getDataGeneration()));
onBeforeUnmount(() => emit('busy', false));
</script>
