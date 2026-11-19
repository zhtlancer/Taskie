<template>
  <div v-if="variants.length" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-900 dark:text-amber-200 break-words [overflow-wrap:anywhere]">
    <p>大小写相近词条：{{ variants.join('、') }}。含义可能不同，请核对后分别保留。</p>
    <label class="flex items-center gap-2 min-h-11 cursor-pointer">
      <input type="checkbox" :checked="confirmed" :disabled="disabled" class="w-5 h-5 shrink-0 accent-brand-500"
        @change="$emit('update:modelValue', $event.target.checked ? [...variants] : [])" />
      <span class="min-w-0">确认将“{{ word }}”作为独立词条保留</span>
    </label>
  </div>
</template>

<script setup>
import { computed } from 'vue';
const props = defineProps({
  word: { type: String, required: true },
  variants: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  disabled: Boolean
});
defineEmits(['update:modelValue']);
const confirmed = computed(() => props.variants.every(word => props.modelValue.includes(word)));
</script>
