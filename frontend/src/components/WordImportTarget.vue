<template>
  <div v-if="role === 'parent'" class="space-y-3">
    <label class="block text-sm font-bold">导入到词本
      <select :value="selected" :disabled="loading" aria-label="导入到词本" class="ui-input block w-full mt-1" @change="choose($event.target.value)">
        <option value="">不分本，导入散词</option><option value="new">新建词本并导入</option>
        <option v-if="selected && selected !== 'new' && !books.some(book => book.id === selected)" :value="selected">所选词本不可用，请重新选择</option>
        <optgroup v-for="group in groups" :key="group.source" :label="group.label"><option v-for="book in group.books" :key="book.id" :value="book.id">{{ book.name }}</option></optgroup>
      </select>
    </label>
    <p v-if="error" role="alert" class="text-xs text-rose-600 dark:text-rose-300">{{ error }} <button type="button" class="min-h-11 underline" @click="load">重试读取词本</button></p>
    <WordBookFields v-if="modelValue.book_meta" :model-value="modelValue.book_meta" :sources="sources" @update:model-value="$emit('update:modelValue', { book_meta: $event })" />
  </div>
</template>
<script setup>
import { computed } from 'vue';
import WordBookFields from './WordBookFields.vue';
import { useWordBooks } from '../composables/useWordBooks';
import { groupWordBooks } from '../utils/wordBookSource';
const props = defineProps({ childId: String, language: String, modelValue: { type: Object, required: true } });
const emit = defineEmits(['update:modelValue']);
const { books, loading, error, load, role } = useWordBooks(() => props.childId, () => props.language);
const groups = computed(() => groupWordBooks(books.value)), sources = computed(() => [...new Set(books.value.map(book => book.source).filter(Boolean))]);
const selected = computed(() => props.modelValue.book_meta ? 'new' : props.modelValue.book_id || '');
function choose(value) {
  emit('update:modelValue', value === 'new' ? { book_meta: { name: '', source: '', unit: '', source_type: '', note: '' } } : value ? { book_id: value } : {});
}
</script>
