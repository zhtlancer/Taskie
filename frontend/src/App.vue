<template>
  <div class="app-shell bg-[#F4F6FB] dark:bg-slate-950 flex flex-col text-slate-800 dark:text-slate-100 antialiased" :class="{ 'student-shell': isStudentPage }">
    <router-view />
    <AppConfirmation />
    <div v-if="error" role="alert" class="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-1/2 -translate-x-1/2 z-[100] w-max max-w-[calc(100vw-2rem)] sm:max-w-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-4 shadow-lg flex gap-4 items-center">
      <span>{{ error }}</span>
      <button @click="reload" class="text-brand-600 dark:text-brand-300 whitespace-nowrap">刷新重试</button>
      <button @click="error = ''" aria-label="关闭错误提示">✕</button>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { initAudioUnlock } from './utils/sound';
import { useRouter, useRoute } from 'vue-router';
import { computed } from 'vue';
import AppConfirmation from './components/AppConfirmation.vue';
import { setMustChangePin } from './utils/session.js';
const router = useRouter(), error = ref('');
const route = useRoute();
const isStudentPage = computed(() => route.path.startsWith('/child/'));
const reload = () => window.location.reload();
const onError = event => {
  // The server still holds the default parent PIN: go set a new one instead of showing an error.
  if (event.detail.code === 'PARENT_PIN_CHANGE_REQUIRED') {
    setMustChangePin(true);
    router.replace('/parent/setup-pin');
    return;
  }
  error.value = event.detail.message;
  if (event.detail.status === 401 && !event.detail.login) router.replace(router.currentRoute.value.path.startsWith('/parent') ? '/parent/login' : '/');
};

onMounted(() => {
  initAudioUnlock();
  window.addEventListener('taskie:error', onError);
});
onBeforeUnmount(() => window.removeEventListener('taskie:error', onError));
</script>
