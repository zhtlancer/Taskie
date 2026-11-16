<template>
  <p v-if="notice.message" :role="notice.failed ? 'alert' : 'status'" class="p-4 rounded-xl text-sm break-words"
    :class="notice.failed ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'">{{ notice.message }}</p>
</template>
<script setup>
defineProps({ notice: { type: Object, required: true } });
</script>
