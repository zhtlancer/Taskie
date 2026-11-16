<template>
  <header class="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 flex-1 basis-64">
      <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 break-words"><span v-if="icon" class="mr-2" aria-hidden="true">{{ icon }}</span>{{ title }}</h1>
      <p v-if="description" class="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex flex-wrap items-center gap-2 shrink-0"><slot name="actions" /></div>
  </header>
</template>
<script setup>
defineProps({ title: { type: String, required: true }, description: { type: String, default: '' }, icon: { type: String, default: '' } });
</script>
