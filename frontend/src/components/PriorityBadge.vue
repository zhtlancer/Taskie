<template>
  <span v-if="priority !== 1" :aria-label="priority === 2 ? '高优先级' : '低优先级'"
    class="px-2 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
    :class="priority === 2 ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'">{{ priority === 2 ? '↑ 高优先' : '↓ 低优先' }}</span>
</template>
<script setup>
defineProps({ priority: { type: Number, default: 1 } });
</script>
