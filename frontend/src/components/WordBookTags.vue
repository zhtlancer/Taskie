<template>
  <span v-if="books?.length" class="flex flex-wrap gap-1 text-xs text-slate-600 dark:text-slate-300" aria-label="所属词本">
    <span v-for="book in books.slice(0, 2)" :key="book.id" class="max-w-full rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 break-words [overflow-wrap:anywhere]">{{ book.name }}</span>
    <span v-if="books.length > 2" class="px-1 py-1">另 {{ books.length - 2 }} 本</span>
  </span>
</template>
<script setup>
defineProps({ books: Array });
</script>
