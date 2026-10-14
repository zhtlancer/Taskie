<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col text-slate-800 antialiased">
    <router-view />
    <div v-if="error" role="alert" class="fixed top-3 left-1/2 -translate-x-1/2 z-[100] max-w-xl bg-rose-50 border border-rose-200 rounded-xl p-4 shadow-lg flex gap-4 items-center">
      <span>{{ error }}</span>
      <button @click="reload" class="text-brand-600 whitespace-nowrap">刷新重试</button>
      <button @click="error = ''" aria-label="关闭错误提示">✕</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { initAudioUnlock } from './utils/sound';
import { useRouter } from 'vue-router';
const router = useRouter(), error = ref('');
const reload = () => window.location.reload();
const onError = event => {
  error.value = event.detail.message;
  if (event.detail.status === 401 && !event.detail.login) router.replace(router.currentRoute.value.path.startsWith('/parent') ? '/parent/login' : '/');
};

onMounted(() => {
  initAudioUnlock();
  window.addEventListener('taskie:error', onError);
});
onBeforeUnmount(() => window.removeEventListener('taskie:error', onError));
</script>
