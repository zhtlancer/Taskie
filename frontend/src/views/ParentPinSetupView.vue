<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col justify-between select-none">
    <header class="px-6 py-4 flex items-center justify-between max-w-sm w-full mx-auto">
      <button type="button" class="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" @click="cancel">← 退出</button>
      <span class="text-xs font-bold text-slate-400">首次使用设置</span>
    </header>

    <main class="flex-1 flex flex-col items-center justify-center p-4">
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-card border border-slate-200/80 dark:border-slate-700/80 max-w-sm w-full text-center">
        <div class="w-14 h-14 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-2xl mb-3">🔐</div>
        <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight mb-1">{{ steps[step].title }}</h2>
        <p class="text-xs text-slate-400 mb-4">{{ steps[step].hint }}</p>

        <PinInput :key="step" ref="pinInput" :max-length="4" :error-message="errorMessage" @complete="handleComplete" />
        <p v-if="busy" class="mt-3 text-xs font-bold text-brand-500 dark:text-brand-400">正在保存…</p>
      </div>
    </main>

    <footer class="text-center text-xs text-slate-400 py-3">
      默认 PIN 人人都知道，换成只有家长知道的 PIN，孩子就不会误改设置
    </footer>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api/client';
import { useParentStore } from '../stores/parent';
import PinInput from '../components/PinInput.vue';

const router = useRouter();
const parentStore = useParentStore();

// The current PIN is remembered from login; after a page reload it has to be entered again.
const steps = {
  current: { title: '请输入当前 PIN', hint: '为了安全，请再次输入刚才登录用的默认 PIN' },
  new: { title: '设置新的家长 PIN', hint: '当前仍在使用默认 PIN，请设置一个只有家长知道的 4 位数字' },
  confirm: { title: '再输入一次新 PIN', hint: '确认两次输入一致' }
};
const step = ref(parentStore.pendingPin ? 'new' : 'current');
const currentPin = ref(parentStore.pendingPin || '');
const newPin = ref('');
const errorMessage = ref('');
const busy = ref(false);
const pinInput = ref(null);

function retry(message, nextStep = step.value) {
  errorMessage.value = message;
  step.value = nextStep;
  setTimeout(() => pinInput.value?.clear(), 400);
}

async function handleComplete(pin) {
  errorMessage.value = '';
  if (step.value === 'current') {
    currentPin.value = pin;
    step.value = 'new';
  } else if (step.value === 'new') {
    newPin.value = pin;
    step.value = 'confirm';
  } else if (pin !== newPin.value) {
    retry('两次输入不一致，请重新设置', 'new');
  } else {
    await save();
  }
}

async function save() {
  busy.value = true;
  try {
    await api.changeParentPin(currentPin.value, newPin.value);
    // Changing the PIN ends every session, so sign straight back in with the new one.
    parentStore.logout();
    await parentStore.login(newPin.value);
    router.replace('/parent/dashboard');
  } catch (err) {
    const message = typeof err === 'string' ? err : '保存失败，请重试';
    // A wrong current PIN means starting over; other problems only need a different new PIN.
    if (/当前|incorrect/i.test(message)) retry('当前 PIN 不正确，请重新输入', 'current');
    else retry(message, 'new');
  } finally {
    busy.value = false;
  }
}

function cancel() {
  parentStore.logout();
  router.replace('/');
}
</script>
