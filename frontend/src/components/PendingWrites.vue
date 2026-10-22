<template>
  <aside v-if="entries.length" aria-label="待确认请求" class="relative z-40 m-3 p-3 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100 text-sm">
    <p class="font-bold">有操作尚未确认。下面保留了当时的内容，可以继续确认。</p>
    <ul class="space-y-2 mt-2">
      <li v-for="entry in entries" :key="entry.request_id" class="flex flex-wrap items-center gap-2">
        <span class="break-words">{{ entry.child_name || '孩子' }} · {{ description(entry) }}</span>
        <button type="button" :disabled="busy" class="min-h-[44px] px-3 rounded-xl bg-amber-700 text-white font-bold disabled:opacity-50" @click="retry(entry)">确认这次操作</button>
      </li>
    </ul>
    <p v-if="error" role="alert" class="text-rose-700 dark:text-rose-300">{{ error }}</p>
  </aside>
  <p v-else-if="confirmed" role="status" class="m-3 text-sm text-emerald-700 dark:text-emerald-300">操作已确认。</p>
</template>
<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import { currentRole } from '../utils/session.js';
import { activeWrites, pendingWriteStore } from '../utils/requestId.js';
const route = useRoute(), revision = ref(0), busy = ref(false), error = ref(''), confirmed = ref(false);
const update = () => revision.value++;
const entries = computed(() => {
  revision.value;
  if (['/parent/login', '/parent/setup-pin'].includes(route.path)) return [];
  const parent = route.path.startsWith('/parent/') && currentRole() === 'parent';
  const child = route.path.startsWith('/child/') ? route.params.id : null;
  if (!parent && !child) return [];
  try {
    return pendingWriteStore.list().filter(entry => !activeWrites.has(entry.request_id) && entry.role === currentRole() && (parent || entry.child_id === child));
  } catch { return []; }
});
const description = entry => entry.kind === 'redemption' ? `兑换「${entry.title}」` : `${entry.payload.date} · ${entry.kind === 'backfill' ? '补记' : '记录'}「${entry.title}」${entry.payload.position !== undefined ? `到第 ${entry.payload.position}` : entry.payload.amount !== undefined ? ` ${entry.payload.amount}` : ''}${entry.payload.duration_seconds !== undefined ? ` · 用时 ${entry.payload.duration_seconds} 秒` : ''}`;
async function retry(entry) {
  busy.value = true; error.value = '';
  try {
    await api.retryPendingWrite(entry);
    confirmed.value = true;
    window.dispatchEvent(new Event('taskie:write-confirmed'));
  } catch (err) { error.value = String(err); }
  finally { busy.value = false; }
}
onMounted(() => window.addEventListener('taskie:pending-writes', update));
onBeforeUnmount(() => window.removeEventListener('taskie:pending-writes', update));
</script>
