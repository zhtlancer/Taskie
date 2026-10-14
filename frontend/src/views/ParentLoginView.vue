<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col justify-between p-6 select-none">
    <!-- Header -->
    <header class="max-w-md w-full mx-auto flex items-center justify-between py-4">
      <router-link
        to="/"
        class="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-bold transition-colors"
      >
        <span>←</span>
        <span>返回孩子端</span>
      </router-link>
      <span class="text-xs text-slate-400 font-bold">iPad 安全管理中心</span>
    </header>

    <!-- Main Pin Input Card -->
    <main class="max-w-md w-full mx-auto my-auto bg-white rounded-3xl p-8 border border-slate-200 shadow-card text-center">
      <div class="w-20 h-20 mx-auto rounded-3xl bg-brand-50 text-brand-600 flex items-center justify-center text-4xl mb-4 shadow-inner">
        🔒
      </div>

      <h2 class="text-2xl font-black text-slate-800 tracking-tight mb-1">
        家长身份验证
      </h2>
      <p class="text-xs text-slate-400 mb-4">
        请输入 4 位数字管理 PIN 码进入家长工作台
      </p>

      <!-- Pin Input (Key size >= 64px for touch friendliness) -->
      <PinInput
        :max-length="4"
        :error-message="errorMessage"
        @complete="handlePinComplete"
      />

      <!-- Default PIN hint, shown only until the default PIN has been replaced -->
      <div v-if="defaultPinActive" class="mt-6 pt-4 border-t border-slate-100 text-xs text-slate-400">
        💡 首次使用：初始 PIN 码为 <span class="font-bold text-brand-600">1234</span>，登录后需要设置新 PIN
      </div>
    </main>

    <!-- Footer -->
    <footer class="text-center text-xs text-slate-400 py-3">
      保护孩子独立使用空间 · 家长专注配置与陪伴
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../api/client';
import { useRouter } from 'vue-router';
import { useParentStore } from '../stores/parent';
import PinInput from '../components/PinInput.vue';

const router = useRouter();
const parentStore = useParentStore();

const errorMessage = ref('');
const defaultPinActive = ref(false);

onMounted(async () => {
  try {
    defaultPinActive.value = (await api.getAuthSetup()).parent_pin_is_default;
  } catch {
    defaultPinActive.value = false;
  }
});

async function handlePinComplete(pin) {
  try {
    errorMessage.value = '';
    const success = await parentStore.login(pin);
    if (success) {
      router.push(parentStore.pendingPin ? '/parent/setup-pin' : '/parent/dashboard');
    }
  } catch (err) {
    errorMessage.value = typeof err === 'string' ? err : 'PIN 码错误，请重新输入';
  }
}
</script>
