<template>
  <section :role="kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined" :data-page-state="kind"
    class="rounded-2xl border bg-white dark:bg-slate-900 p-5 sm:p-6 mb-4 text-center space-y-2"
    :class="kind === 'error' ? 'border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'">
    <p v-if="kind === 'loading'" class="text-sm font-bold text-brand-600 dark:text-brand-300">{{ title }}</p>
    <h3 v-else class="text-base font-bold">{{ title }}</h3>
    <p v-if="description" class="text-sm leading-relaxed" :class="kind === 'error' ? '' : 'text-slate-500 dark:text-slate-400'">{{ description }}</p>
    <div v-if="kind === 'error' || $slots.actions" class="flex flex-wrap justify-center gap-2 pt-2">
      <button v-if="kind === 'error'" type="button" :disabled="busy" class="ui-button-secondary" @click="$emit('retry')">{{ busy ? '正在读取…' : '重新读取' }}</button>
      <slot name="actions" />
    </div>
  </section>
</template>
<script setup>
defineProps({ kind: { type: String, default: 'empty' }, title: { type: String, required: true }, description: { type: String, default: '' }, busy: Boolean });
defineEmits(['retry']);
</script>
