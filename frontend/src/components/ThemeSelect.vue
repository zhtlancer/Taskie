<template>
  <fieldset class="space-y-2 min-w-0">
    <legend class="text-xs font-bold text-slate-500 dark:text-slate-400">显示模式</legend>
    <div class="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
      <button v-for="option in options" :key="option.value" type="button" :aria-pressed="preference === option.value"
        class="min-h-[44px] min-w-[44px] rounded-lg px-2 text-xs font-bold transition-colors whitespace-nowrap"
        :class="preference === option.value ? 'bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100'"
        @click="setTheme(option.value)">{{ option.label }}</button>
    </div>
  </fieldset>
</template>
<script setup>
import { useTheme } from '../utils/theme';
const { preference, setTheme } = useTheme();
const options = [{ value: 'light', label: '☀ 浅色' }, { value: 'dark', label: '☾ 暗色' }, { value: 'system', label: '跟随系统' }];
</script>
