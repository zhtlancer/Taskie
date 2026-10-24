<template>
  <div class="app-shell bg-[#F4F6FB] dark:bg-slate-950 flex flex-col text-slate-800 dark:text-slate-100 antialiased" :class="{ 'student-shell': isStudentPage }">
    <p v-if="calendar.loading" role="status" class="p-6 text-center">正在读取家庭时区…</p>
    <div v-if="calendar.error" role="alert" class="p-4 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-100">
      {{ calendar.error }}
      <button type="button" class="min-h-11 px-3 underline font-bold" @click="reloadCalendar">重新读取家庭时区</button>
    </div>
    <router-view v-if="!calendar.loading" />
    <AppConfirmation />
    <PendingWrites />
    <div v-if="error" role="alert" class="fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-1/2 -translate-x-1/2 z-[100] w-max max-w-[calc(100vw-2rem)] sm:max-w-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl p-4 shadow-lg flex gap-4 items-center">
      <span>{{ error }}</span>
      <button @click="error = ''" aria-label="关闭错误提示">✕</button>
    </div>
  </div>
</template>

<script setup>
import { useCalendarStore } from './stores/calendar';
const reloadCalendar = () => window.location.reload();
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { initAudioUnlock } from './utils/sound';
import { useRouter, useRoute } from 'vue-router';
import { computed } from 'vue';
import AppConfirmation from './components/AppConfirmation.vue';
import PendingWrites from './components/PendingWrites.vue';
import { setMustChangePin } from './utils/session.js';
const calendar = useCalendarStore();
const router = useRouter(), error = ref('');
const route = useRoute();
const isStudentPage = computed(() => route.path.startsWith('/child/'));
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
