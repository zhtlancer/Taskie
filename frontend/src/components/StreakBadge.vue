<template>
  <div
    class="relative inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-amber-50 border border-amber-200 select-none shadow-sm cursor-pointer hover:bg-amber-100/80 transition-colors"
    @click="triggerWiggle"
  >
    <!-- Flame Icon with wiggle animation -->
    <span
      class="text-2xl transition-transform inline-block"
      :class="{ 'animate-flame-wiggle': isWiggling }"
    >
      🔥
    </span>

    <!-- Streak Content -->
    <div class="flex flex-col text-left">
      <span class="text-[10px] font-black uppercase tracking-wider text-amber-700">连续打卡</span>
      <div class="flex items-baseline gap-1">
        <span
          class="text-lg font-black text-amber-600 transition-transform inline-block"
          :class="{ 'scale-125 text-amber-500 font-extrabold': isWiggling }"
        >
          {{ count }}
        </span>
        <span class="text-xs font-bold text-amber-700">天</span>
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
