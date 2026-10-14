<template>
  <img v-if="image" :src="image" />
  <span v-else class="block p-4 text-sm text-slate-500">{{ failed ? '图片加载失败，请刷新重试' : '图片加载中…' }}</span>
</template>
<script setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import api from '../api/client';
const props = defineProps({ src: { type: String, required: true } });
const image = ref('');
const failed = ref(false);
let version = 0;
const release = value => { if (value?.startsWith('blob:')) URL.revokeObjectURL(value); };
watch(() => props.src, async src => {
  const current = ++version;
  release(image.value); image.value = ''; failed.value = false;
  try {
    const url = await api.loadPhoto(src);
    if (current === version) image.value = url; else release(url);
  } catch { if (current === version) failed.value = true; }
}, { immediate: true });
onBeforeUnmount(() => { version++; release(image.value); });
</script>
