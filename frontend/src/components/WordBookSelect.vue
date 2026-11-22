<template>
  <label v-if="isParent" class="block min-w-0 text-xs font-bold text-slate-600 dark:text-slate-300">
    收录到词本（选填）
    <select :value="modelValue" aria-label="收录到词本" :disabled="disabled || loading || Boolean(error)" class="ui-input block mt-1 w-full min-w-0 max-w-full" @change="$emit('update:modelValue', $event.target.value)">
      <option value="">暂不分本</option>
      <optgroup v-for="group in groups" :key="group.source" :label="group.label"><option v-for="book in group.books" :key="book.id" :value="book.id">{{ book.name }}</option></optgroup>
    </select>
    <span v-if="error" role="alert">{{ error }} <button type="button" :disabled="disabled" class="min-h-11 underline" @click="load">重试读取词本</button></span>
  </label>
</template>
<script setup>
import { computed, watch } from 'vue';
import { useWordBooks } from '../composables/useWordBooks';
import { groupWordBooks } from '../utils/wordBookSource';
const props = defineProps({ childId: String, language: String, modelValue: { type: String, default: '' }, disabled: Boolean });
const emit = defineEmits(['update:modelValue']);
const { books, loading, error, load, role } = useWordBooks(() => props.childId, () => props.language);
const isParent = computed(() => role.value === 'parent');
const groups = computed(() => groupWordBooks(books.value));
watch(() => [props.childId, props.language], () => emit('update:modelValue', ''));
</script>
