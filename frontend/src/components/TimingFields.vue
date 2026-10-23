<template>
  <!-- Parent form fields: whether a task records time, and optionally how long it should take -->
  <div class="rounded-2xl border border-violet-100 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/40 p-3">
    <label class="flex items-start gap-2 cursor-pointer">
      <input v-model="trackTime" type="checkbox" class="mt-0.5 w-4 h-4 accent-violet-500" />
      <span>
        <span class="block text-xs font-bold text-slate-700 dark:text-slate-200">⏱ 记录用时</span>
        <span class="block text-xs font-bold text-slate-400">孩子可以开始计时，或完成时填写用了多久</span>
      </span>
    </label>
    <div v-if="trackTime" class="mt-2.5 pl-6">
      <span class="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">预计用时（可不填）</span>
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          v-for="option in [10, 15, 20, 30, 45, 60]"
          :key="option"
          type="button"
          class="min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-lg text-xs font-bold border"
          :class="expectedMinutes === option ? 'bg-violet-500 border-violet-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'"
          @click="expectedMinutes = expectedMinutes === option ? null : option"
        >
          {{ option }}
        </button>
        <input
          :value="expectedMinutes"
          type="number"
          min="1"
          max="600"
          placeholder="分钟"
          class="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-center outline-none focus:border-violet-500"
          @input="expectedMinutes = $event.target.value === '' ? null : Number($event.target.value)"
        />
        <span class="text-xs font-bold text-slate-500 dark:text-slate-400">分钟</span>
      </div>
    </div>
  </div>
</template>

<script setup>
const trackTime = defineModel('trackTime', { type: Boolean, default: false });
const expectedMinutes = defineModel('expectedMinutes', { type: Number, default: null });
</script>
