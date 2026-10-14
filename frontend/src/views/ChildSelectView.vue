<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col justify-between p-6 select-none">
    <!-- Top Bar -->
    <header class="max-w-5xl w-full mx-auto flex items-center justify-between py-4">
      <div class="flex items-center gap-3">
        <span class="text-4xl">🎒</span>
        <div>
          <h1 class="text-2xl font-black text-slate-800 tracking-tight">
            小学霸日常作业站
          </h1>
          <p class="text-xs font-bold text-slate-400">每天进步一点点，收获满满成就感 ✨</p>
        </div>
      </div>

      <!-- Right: Sound Toggle & Parent Entrance -->
      <div class="flex items-center gap-3">
        <SoundToggle />
        <router-link
          to="/parent/login"
          @click="playClick"
          class="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-brand-300 text-slate-700 font-bold text-sm transition-all active:scale-95 hover:shadow-card"
        >
          <span>⚙️</span>
          <span>家长入口</span>
        </router-link>
      </div>
    </header>

    <!-- Main Content: Children Card Selection -->
    <main class="max-w-5xl w-full mx-auto my-auto py-8">
      <div class="text-center mb-8">
        <h2 class="text-3xl font-black text-slate-800 tracking-tight mb-2">
          你是哪位小朋友？
        </h2>
        <p class="text-slate-500 font-medium text-base">
          点击你的头像卡片，开启今天的学习挑战吧！
        </p>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center items-center py-20 text-brand-500 text-lg font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在加载小朋友信息...
      </div>

      <!-- Children Grid -->
      <div v-else-if="children.length > 0" class="flex flex-wrap justify-center items-center gap-8">
        <ChildSelectCard
          v-for="child in children"
          :key="child.id"
          :child="child"
          @select="handleChildSelect"
        />
      </div>

      <!-- Empty state -->
      <div v-else class="text-center py-16 bg-white rounded-3xl border border-slate-200 max-w-md mx-auto p-8 shadow-sm">
        <div class="text-5xl mb-3">👶</div>
        <h3 class="text-lg font-bold text-slate-800 mb-2">还没有添加小朋友账号</h3>
        <p class="text-sm text-slate-500 mb-6">请家长先登录后台添加小朋友账号哦</p>
        <router-link
          to="/parent/login"
          class="inline-block px-6 py-3 rounded-2xl bg-brand-500 text-white font-bold shadow-button"
        >
          进入家长后台添加
        </router-link>
      </div>
    </main>

    <!-- Footer -->
    <footer class="text-center text-xs text-slate-400 py-3">
      iPad 与手机都能用 · 陪伴孩子快乐自律成长
    </footer>

    <!-- PIN Verification Modal -->
    <div
      v-if="activePinChild"
      class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in"
      @click.self="activePinChild = null"
    >
      <div class="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl border-2 border-brand-100">
        <div class="w-20 h-20 mx-auto rounded-full bg-brand-50 flex items-center justify-center text-4xl mb-3">
          {{ activePinChild.avatar_emoji || '🐱' }}
        </div>
        <h3 class="text-xl font-black text-slate-800 mb-1">
          {{ activePinChild.name }} 的 PIN 码
        </h3>
        <p class="text-xs text-slate-400 mb-2">请输入你的 4 位数字密码</p>

        <PinInput
          :max-length="4"
          :error-message="pinError"
          @complete="verifyChildPin"
        />

        <div class="mt-4">
          <button
            type="button"
            @click="activePinChild = null"
            class="text-sm font-bold text-slate-400 hover:text-slate-600 py-2"
          >
            取消返回
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import ChildSelectCard from '../components/ChildSelectCard.vue';
import PinInput from '../components/PinInput.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick } from '../utils/sound';

const router = useRouter();
const childStore = useChildStore();

const children = ref([]);
const loading = ref(true);
const activePinChild = ref(null);
const pinError = ref('');

onMounted(async () => {
  try {
    children.value = await api.getChildren();
  } catch (err) {
    console.error('Failed to load children:', err);
  } finally {
    loading.value = false;
  }
});

async function handleChildSelect(child) {
  if (child.has_pin) {
    activePinChild.value = child;
    pinError.value = '';
  } else {
    try { const result = await api.loginChild({ child_id: child.id }); enterChild(result.child); }
    catch (error) { console.error(error); }
  }
}

async function verifyChildPin(pin) {
  if (!activePinChild.value) return;
  try {
    const res = await api.loginChild({ child_id: activePinChild.value.id, pin });
    if (res.success) {
      enterChild(res.child || activePinChild.value);
    }
  } catch (err) {
    pinError.value = typeof err === 'string' ? err : 'PIN 码错误，请重试';
  }
}

function enterChild(child) {
  childStore.setChild(child);
  router.push(`/child/${child.id}/today`);
}
</script>
