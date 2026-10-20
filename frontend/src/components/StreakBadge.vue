<template>
  <!-- Its text reads 连续打卡 N 天 on its own; tapping only plays the flame wiggle, so it is not a button. -->
  <div
    class="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 select-none shadow-sm cursor-pointer hover:bg-amber-100/80 dark:hover:bg-amber-950/40 transition-colors"
    @click="triggerWiggle"
  >
    <!-- Flame Icon with wiggle animation -->
    <span
      aria-hidden="true"
      class="text-2xl transition-transform inline-block"
      :class="{ 'animate-flame-wiggle': isWiggling }"
    >
      🔥
    </span>

    <!-- Streak Content -->
    <div class="flex flex-col text-left">
      <span class="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">连续打卡</span>
      <div class="flex items-baseline gap-1">
        <span
          class="text-lg font-black text-amber-600 dark:text-amber-300 transition-transform inline-block"
          :class="{ 'scale-125 text-amber-500 dark:text-amber-400 font-extrabold': isWiggling }"
        >
          {{ count }}
        </span>
        <span class="text-xs font-bold text-amber-700 dark:text-amber-300">天</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  count: {
    type: Number,
    default: 0
  }
});

const isWiggling = ref(false);

watch(() => props.count, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    triggerWiggle();
  }
});

function triggerWiggle() {
  isWiggling.value = true;
  setTimeout(() => {
    isWiggling.value = false;
  }, 700);
}

defineExpose({
  wiggle: triggerWiggle
});
</script>
