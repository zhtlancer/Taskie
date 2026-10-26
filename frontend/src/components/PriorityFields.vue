<template>
  <fieldset class="min-w-0">
    <legend class="mb-1.5 text-xs font-bold text-slate-600 dark:text-slate-300">优先级</legend>
    <div class="grid grid-cols-3 gap-2">
      <label v-for="option in options" :key="option.value"
        class="relative flex items-center justify-center min-h-[44px] gap-1.5 rounded-xl border px-2 py-2 text-sm font-bold cursor-pointer"
        :class="modelValue === option.value ? 'bg-brand-50 dark:bg-brand-900/40 border-brand-400 text-brand-700 dark:text-brand-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
        <input type="radio" :name="name" :value="option.value" :checked="modelValue === option.value" class="accent-indigo-600"
          @change="$emit('update:modelValue', option.value)" />
        {{ option.label }}
      </label>
    </div>
  </fieldset>
</template>
<script setup>
import { useId } from 'vue';
defineProps({ modelValue: { type: Number, default: 1 } });
defineEmits(['update:modelValue']);
const name = useId();
const options = [{ value: 2, label: '高' }, { value: 1, label: '普通' }, { value: 0, label: '低' }];
</script>
