<template>
  <button
    type="button"
    @click="handleToggle"
    :title="isMuted ? '声音已静音（点击开启）' : '声音已开启（点击静音）'"
    :aria-label="isMuted ? '声音已静音' : '声音已开启'"
    class="relative group flex items-center justify-center min-w-[48px] min-h-[48px] w-12 h-12 rounded-2xl border-2 transition-all duration-200 active:scale-95 select-none focus:outline-none focus:ring-2 focus:ring-brand-300 shrink-0 cursor-pointer"
    :class="[
      isMuted
        ? 'bg-slate-100 hover:bg-slate-200 border-slate-200 text-slate-400 shadow-none'
        : 'bg-gradient-to-tr from-amber-50 via-indigo-50/60 to-purple-50 hover:from-amber-100 hover:to-indigo-100 border-amber-300/80 text-amber-600 shadow-sm hover:shadow-md'
    ]"
  >
    <!-- Ripple wave animation when sound is active -->
    <span
      v-if="!isMuted"
      class="absolute inset-0 rounded-2xl border-2 border-amber-400/50 pointer-events-none animate-sound-ripple"
    ></span>

    <!-- Status Icon: 🔊 / 🔇 -->
    <span
      class="text-2xl transition-transform duration-200 group-hover:scale-110 leading-none"
    >
      {{ isMuted ? '🔇' : '🔊' }}
    </span>
  </button>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { isMuted as getMuted, toggleMute, initAudioUnlock } from '../utils/sound';

const isMuted = ref(getMuted());

function handleToggle() {
  isMuted.value = toggleMute();
}

function handleMutedChange(event) {
  if (event.detail && typeof event.detail.muted === 'boolean') {
    isMuted.value = event.detail.muted;
  } else {
    isMuted.value = getMuted();
  }
}

function handleStorage(e) {
  if (e.key === 'app_sound_muted') {
    isMuted.value = getMuted();
  }
}

onMounted(() => {
  initAudioUnlock();
  isMuted.value = getMuted();
  if (typeof window !== 'undefined') {
    window.addEventListener('app_sound_muted_changed', handleMutedChange);
    window.addEventListener('storage', handleStorage);
  }
});

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('app_sound_muted_changed', handleMutedChange);
    window.removeEventListener('storage', handleStorage);
  }
});
</script>

<style scoped>
@keyframes soundRipple {
  0% {
    transform: scale(0.96);
    opacity: 0.8;
  }
  50% {
    transform: scale(1.12);
    opacity: 0.15;
  }
  100% {
    transform: scale(0.96);
    opacity: 0.8;
  }
}

.animate-sound-ripple {
  animation: soundRipple 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>
