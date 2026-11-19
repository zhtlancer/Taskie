<template>
  <span ref="container" data-dictionary-image :data-resource="url" class="block my-2 min-w-0 max-w-full rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
    <span v-if="error" role="status" class="flex flex-wrap items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300">
      <span class="min-w-0 [overflow-wrap:anywhere]">{{ error }}</span>
      <button type="button" class="ui-button-secondary min-h-11 min-w-11" @click="load">重试图片</button>
    </span>
    <template v-else>
      <span v-if="!loaded" role="status" class="block p-3 text-xs text-slate-500 dark:text-slate-400">正在加载词典图片…</span>
      <img v-if="objectUrl" :key="objectUrl" :src="objectUrl" :alt="alt" class="block max-w-full h-auto mx-auto bg-white" :class="{ hidden: !loaded }" @load="imageLoaded" @error="decodeFailed" />
    </template>
  </span>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import api from '../api/client';

const props = defineProps({ url: { type: String, required: true }, alt: { type: String, default: '原词典图片' } });
const container = ref(null);
const objectUrl = ref('');
const loaded = ref(false);
const error = ref('');
let controller;
let serial = 0;
let visible = false;
let observer;

function reset() {
  serial++;
  controller?.abort();
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = '';
  loaded.value = false;
  error.value = '';
}
function imageLoaded(event) {
  if (event.target.getAttribute('src') === objectUrl.value) loaded.value = true;
}
function decodeFailed(event) {
  if (event.target.getAttribute('src') !== objectUrl.value) return;
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = '';
  error.value = '词典图片无法显示，可以重试';
}
async function load() {
  reset();
  const current = serial;
  controller = new AbortController();
  try {
    const blob = await api.fetchDictionaryImageBlob(props.url, controller.signal);
    if (current !== serial) return;
    objectUrl.value = URL.createObjectURL(blob);
  } catch (err) {
    if (current === serial) error.value = err?.message || '词典图片读取失败，可以重试';
  }
}
watch(() => props.url, () => { reset(); if (visible) load(); }, { flush: 'sync' });
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { visible = true; load(); return; }
  observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    visible = true;
    observer.disconnect();
    load();
  }, { rootMargin: '200px' });
  observer.observe(container.value);
});
onBeforeUnmount(() => { observer?.disconnect(); reset(); });
</script>
