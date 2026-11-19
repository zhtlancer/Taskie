<template>
  <p v-if="status?.indexing" data-dictionary-index-progress role="status" class="rounded-xl border border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-800 dark:text-cyan-200">
    词典正在准备中{{ detail }}。已填写的内容会保留，准备完成后继续查询。
  </p>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import api from '../api/client';

const status = ref(null);
let active = true;
let timer;
const controller = new AbortController();
const detail = computed(() => {
  const progress = status.value?.progress;
  const dictionary = status.value?.dictionaries?.find(item => item.dict_id === progress?.dict_id);
  const prefix = dictionary ? `：${dictionary.name}` : '';
  if (progress?.phase === 'entries') return `${prefix}，已读取 ${Number(progress.processed || 0).toLocaleString()} 个词条`;
  if (progress?.phase === 'media') return `${prefix}，已整理 ${Number(progress.processed || 0).toLocaleString()} 个资源`;
  if (progress?.phase === 'finalizing' || progress?.phase === 'checking') return '，正在完成最后检查';
  return '，首次准备可能需要数十秒';
});

async function poll() {
  try {
    const result = await api.getDictionaryStatus(controller.signal, { silentError: true, preserveError: true });
    if (active) status.value = result;
  } catch { /* Optional progress must not interrupt lookup or manual editing. */ }
  finally {
    if (active) timer = setTimeout(poll, 1000);
  }
}

onMounted(poll);
onUnmounted(() => {
  active = false;
  clearTimeout(timer);
  controller.abort();
});
</script>
