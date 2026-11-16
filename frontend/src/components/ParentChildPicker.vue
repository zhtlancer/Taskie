<template>
  <section class="mb-4 space-y-2" aria-label="选择孩子">
    <p class="text-xs font-bold text-slate-500 dark:text-slate-400">当前孩子</p>
    <div v-if="children.length" class="flex flex-wrap gap-2">
      <button v-for="child in children" :key="child.id" type="button" :disabled="disabled"
        :aria-pressed="modelValue?.id === child.id" class="min-h-11 min-w-0 max-w-full break-words px-4 py-2 rounded-xl border text-sm font-bold disabled:opacity-50"
        :class="modelValue?.id === child.id ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'"
        @click="$emit('change', child)">{{ child.avatar_emoji }} {{ child.name }}</button>
    </div>
    <p v-else-if="loading || failed" class="text-sm text-slate-500 dark:text-slate-400">{{ loading ? '正在读取孩子档案…' : '孩子档案尚未读取成功，请重试。' }}</p>
    <p v-else class="text-sm text-slate-500 dark:text-slate-400">还没有孩子档案。<router-link to="/parent/children" class="inline-flex items-center min-h-11 px-2 text-brand-600 dark:text-brand-300 font-bold">添加孩子</router-link></p>
  </section>
</template>
<script setup>
defineProps({ children: { type: Array, required: true }, modelValue: { type: Object, default: null }, disabled: Boolean, loading: Boolean, failed: Boolean });
defineEmits(['change']);
</script>
