<template>
  <!-- A small trend line of one task's recorded times; hover a point for its date and value -->
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="overflow-visible" role="img" :aria-label="label">
    <polyline v-if="points.length > 1" :points="points.map(p => `${p.x},${p.y}`).join(' ')" fill="none" :stroke="color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <circle v-if="points.length" :cx="points.at(-1).x" :cy="points.at(-1).y" r="4" :fill="color" stroke="#ffffff" stroke-width="2" />
    <circle v-for="point in points" :key="point.x" :cx="point.x" :cy="point.y" r="7" fill="transparent">
      <title>{{ point.title }}</title>
    </circle>
  </svg>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  // [{ value, title }] in time order
  values: { type: Array, required: true },
  color: { type: String, default: '#2a78d6' },
  label: { type: String, default: '' },
  width: { type: Number, default: 96 },
  height: { type: Number, default: 28 }
});

const points = computed(() => {
  const list = props.values;
  if (!list.length) return [];
  const min = Math.min(...list.map(p => p.value)), max = Math.max(...list.map(p => p.value));
  const pad = 5;
  return list.map((p, i) => ({
    x: list.length === 1 ? props.width / 2 : pad + (i * (props.width - 2 * pad)) / (list.length - 1),
    y: max === min ? props.height / 2 : pad + ((max - p.value) * (props.height - 2 * pad)) / (max - min),
    title: p.title
  }));
});
</script>
