<template>
  <div class="relative inline-flex items-center justify-center" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" class="transform -rotate-90">
      <!-- Background Circle -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        stroke="#E2E8F0"
        :stroke-width="strokeWidth"
        fill="transparent"
      />
      <!-- Progress Circle with gradient -->
      <circle
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke="strokeColor"
        :stroke-width="strokeWidth"
        stroke-linecap="round"
        fill="transparent"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        class="transition-all duration-500 ease-out"
      />
    </svg>

    <!-- Center Label -->
    <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
      <span class="text-xs font-bold text-slate-400" v-if="subtitle">{{ subtitle }}</span>
      <span class="font-black text-slate-800 dark:text-slate-100" :style="{ fontSize: fontSize }">
        {{ Math.round(percentage) }}%
      </span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  percentage: {
    type: Number,
    default: 0
  },
  size: {
    type: Number,
    default: 60
  },
  strokeWidth: {
    type: Number,
    default: 6
  },
  subtitle: {
    type: String,
    default: ''
  }
});

const center = computed(() => props.size / 2);
const radius = computed(() => (props.size - props.strokeWidth) / 2);
const circumference = computed(() => 2 * Math.PI * radius.value);

const dashOffset = computed(() => {
  const p = Math.min(Math.max(props.percentage, 0), 100);
  return circumference.value - (p / 100) * circumference.value;
});

const strokeColor = computed(() => {
  if (props.percentage >= 100) return '#10B981'; // emerald
  if (props.percentage >= 50) return '#6C63FF'; // brand
  return '#FFD93D'; // accent
});

const fontSize = computed(() => {
  return Math.max(12, Math.floor(props.size * 0.22)) + 'px';
});
</script>
