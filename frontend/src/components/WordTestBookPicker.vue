<template>
  <section class="space-y-3" aria-label="自测词本选择">
    <p class="text-xs text-slate-500 dark:text-slate-400">
      至少选择一本。语文同字不同读音分别出题；相同读音及英语单词会合并。词本顺序用于顺序出题。
    </p>
    <p v-if="error" role="alert" class="text-sm text-rose-600 dark:text-rose-300">
      {{ error }} <button type="button" class="ui-button-secondary" @click="load">重试读取词本</button>
    </p>
    <p v-if="loading" role="status" class="text-xs">正在读取词本…</p>
    <details
      v-for="group in groups"
      :key="group.source"
      open
      class="rounded-xl border border-slate-200 dark:border-slate-700 p-3 min-w-0"
    >
      <summary class="min-h-11 cursor-pointer text-sm font-bold [overflow-wrap:anywhere]">
        {{ group.label }}
      </summary>
      <button type="button" class="ui-button-secondary my-1" @click="toggleGroup(group.books)">
        {{ group.books.every((book) => modelValue.includes(book.id)) ? '取消全选' : '全选' }}「{{
          group.label
        }}」
      </button>
      <label
        v-for="book in group.books"
        :key="book.id"
        class="min-h-11 flex items-center gap-2 text-sm [overflow-wrap:anywhere]"
      >
        <input
          type="checkbox"
          :checked="modelValue.includes(book.id)"
          :aria-label="'自测词本「' + book.name + '」'"
          class="w-5 h-5 shrink-0"
          @change="toggle(book.id)"
        />{{ book.name }}（{{ book.item_count }} 项）
      </label>
    </details>
    <p v-if="!loading && !error && !books.length" class="text-sm text-slate-500 dark:text-slate-400">
      暂无词本，请先请家长在字词本整理来源。
    </p>
    <ol class="space-y-2">
      <li v-for="(id, index) in modelValue" :key="id" class="flex flex-wrap items-center gap-2 text-sm">
        <span class="flex-1 min-w-0 [overflow-wrap:anywhere]"
          >{{ index + 1 }}. {{ books.find((book) => book.id === id)?.name || '已不可用的词本，请移除' }}</span
        >
        <button
          type="button"
          :disabled="index === 0"
          class="ui-button-secondary"
          :aria-label="'自测词本第 ' + (index + 1) + ' 本上移'"
          @click="move(index, -1)"
        >
          上移
        </button>
        <button
          type="button"
          class="ui-button-secondary"
          :aria-label="'移除自测词本第 ' + (index + 1) + ' 本'"
          @click="toggle(id)"
        >
          移除
        </button>
      </li>
    </ol>
  </section>
</template>
<script setup>
import { computed } from 'vue';
import { useWordBooks } from '../composables/useWordBooks';
import { groupWordBooks } from '../utils/wordBookSource';
const props = defineProps({ childId: String, language: String, modelValue: { type: Array, required: true } });
const emit = defineEmits(['update:modelValue']);
const { books, loading, error, load } = useWordBooks(
  () => props.childId,
  () => props.language,
);
const groups = computed(() => groupWordBooks(books.value));
function toggle(id) {
  emit(
    'update:modelValue',
    props.modelValue.includes(id)
      ? props.modelValue.filter((value) => value !== id)
      : [...props.modelValue, id],
  );
}
function toggleGroup(group) {
  const ids = group.map((book) => book.id),
    all = ids.every((id) => props.modelValue.includes(id));
  emit(
    'update:modelValue',
    all ? props.modelValue.filter((id) => !ids.includes(id)) : [...new Set([...props.modelValue, ...ids])],
  );
}
function move(index, direction) {
  const ids = [...props.modelValue];
  [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
  emit('update:modelValue', ids);
}
</script>
