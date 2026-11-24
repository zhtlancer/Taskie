<template>
  <section :id="`parent-todo-${kind}`" :data-todo-group="kind" class="min-w-0 scroll-mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
    <header class="mb-3 flex flex-wrap items-center gap-2">
      <h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">{{ icon }} {{ title }}</h3>
      <span class="rounded-lg bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 text-xs font-bold text-brand-700 dark:text-brand-300" :aria-label="`${title} ${count} 项`">{{ count }}</span>
      <span v-if="error" class="text-xs text-rose-700 dark:text-rose-300">未更新</span>
    </header>
    <p v-if="description" class="mb-3 text-xs text-slate-500 dark:text-slate-400">{{ description }}</p>
    <div v-if="error" role="alert" class="mb-3 flex flex-wrap items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
      <span>{{ error }}</span><button type="button" :disabled="busy" class="ui-button-secondary" @click="$emit('retry')">{{ retryLabel || `重新读取${title}` }}</button>
    </div>
    <div :id="contentId"><slot :items="visibleItems" /></div>
    <button v-if="items.length > previewSize" type="button" :disabled="busy" :aria-expanded="expanded" :aria-controls="contentId" :aria-label="`${expanded ? '收起' : '展开'}${title}`" class="mt-2 min-h-11 rounded-xl px-3 text-sm font-bold text-brand-700 dark:text-brand-300 disabled:opacity-50" @click="expanded = !expanded">
      {{ expanded ? '收起' : `展开更多（${items.length - previewSize} 条）` }}
    </button>
    <p v-if="count > items.length" class="mt-2 text-xs text-slate-500 dark:text-slate-400">本页载入 {{ items.length }} 条，共 {{ count }} 条；处理后会显示后续记录。</p>
  </section>
</template>
<script setup>
import { computed, ref, useId } from 'vue';
const props = defineProps({ kind: { type: String, required: true }, title: { type: String, required: true }, icon: String,
  items: { type: Array, required: true }, total: Number, description: String, error: String, busy: Boolean, retryLabel: String });
defineEmits(['retry']);
const expanded = ref(false), previewSize = 3, contentId = useId();
const count = computed(() => props.total ?? props.items.length);
const visibleItems = computed(() => expanded.value ? props.items : props.items.slice(0, previewSize));
</script>
