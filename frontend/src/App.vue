<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col text-slate-800 antialiased">
    <router-view />
  </div>
</template>

<script setup>
import { onMounted } from 'vue';
import { initAudioUnlock } from './utils/sound';

onMounted(() => {
  initAudioUnlock();
});
</script>
