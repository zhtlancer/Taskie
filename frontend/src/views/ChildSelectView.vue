<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col justify-between p-4 max-[359px]:px-3 sm:p-6 select-none">
    <!-- Top Bar: one row at every width; on phones the title shrinks, the tagline hides and the
         parent entrance reads 家长, so nothing is squeezed into a column -->
    <header class="max-w-5xl w-full mx-auto flex items-center justify-between gap-2 sm:gap-3 py-2 sm:py-4">
      <div class="flex items-center gap-2 sm:gap-3 min-w-0">
        <span class="text-3xl sm:text-4xl shrink-0">🎒</span>
        <div class="min-w-0">
          <h1 class="text-lg sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight truncate">
            小学霸日常作业站
          </h1>
          <p class="hidden sm:block text-xs font-bold text-slate-400">每天进步一点点，收获满满成就感 ✨</p>
        </div>
      </div>

      <!-- Right: Sound Toggle & Parent Entrance, both 48px tall -->
      <div class="flex items-center gap-2 sm:gap-3 shrink-0">
        <SoundToggle />
        <router-link
          to="/parent/login"
          aria-label="家长入口"
          title="家长入口"
          @click="playClick"
          class="flex items-center gap-1 sm:gap-2 h-12 px-3 sm:px-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm hover:border-brand-300 dark:hover:border-brand-700 text-slate-700 dark:text-slate-200 font-bold text-sm whitespace-nowrap transition-all active:scale-95 hover:shadow-card"
        >
          <span>⚙️</span>
          <!-- Below 360px only the icon fits beside the full title -->
          <span class="max-[359px]:hidden">家长<span class="hidden sm:inline">入口</span></span>
        </router-link>
      </div>
    </header>

    <!-- Main Content: Children Card Selection -->
    <main class="max-w-5xl w-full mx-auto my-auto py-8">
      <div class="text-center mb-8">
        <h2 class="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight mb-2">
          你是哪位小朋友？
        </h2>
        <p class="text-slate-500 dark:text-slate-400 font-medium text-base max-[359px]:text-sm">
          点击你的头像卡片，开启今天的学习挑战吧！
        </p>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="flex justify-center items-center py-20 text-brand-500 dark:text-brand-400 text-lg font-bold">
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
      <div v-else class="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 max-w-md mx-auto p-8 shadow-sm">
        <div class="text-5xl mb-3">👶</div>
        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2">还没有添加小朋友账号</h3>
        <p class="text-sm text-slate-500 dark:text-slate-400 mb-6">请家长先登录后台添加小朋友账号哦</p>
        <router-link
          to="/parent/login"
          class="inline-block px-6 py-3 rounded-2xl bg-brand-500 text-white font-bold shadow-button"
        >
          进入家长后台添加
        </router-link>
      </div>
    </main>

    <!-- Footer -->
    <footer class="text-center text-xs text-slate-400 py-3 space-y-3">
      <div class="max-w-xs mx-auto"><ThemeSelect /></div>
      iPad 与手机都能用 · 陪伴孩子快乐自律成长
    </footer>

    <!-- PIN Verification Modal -->
    <div
      v-if="activePinChild"
      class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in"
      @click.self="activePinChild = null"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl border-2 border-brand-100 dark:border-brand-800">
        <div class="w-20 h-20 mx-auto rounded-full bg-brand-50 dark:bg-brand-900/40 flex items-center justify-center text-4xl mb-3">
          {{ activePinChild.avatar_emoji || '🐱' }}
        </div>
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 mb-1">
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
            class="text-sm font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2"
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
import ThemeSelect from '../components/ThemeSelect.vue';
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
