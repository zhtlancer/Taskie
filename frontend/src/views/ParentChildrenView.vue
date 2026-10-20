<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <!-- Title & Actions Bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6 [&>*:last-child]:whitespace-nowrap">
        <div>
          <h2 class="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
            <span>👶</span>
            <span>孩子账号管理</span>
          </h2>
          <p class="text-xs font-bold text-slate-400 mt-0.5">
            配置孩子基本信息、专属可爱 Emoji 头像以及独立 PIN 码
          </p>
        </div>

        <button
          type="button"
          @click="openAddModal"
          class="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs shadow-button active:scale-95 transition-all"
        >
          <span>➕</span>
          <span>添加新孩子账号</span>
        </button>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="text-center py-20 text-brand-500 dark:text-brand-400 font-bold">
        <span class="animate-spin mr-2">⏳</span> 正在加载孩子账号...
      </div>

      <!-- Empty State -->
      <div v-else-if="children.length === 0" class="text-center py-16 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700">
        <div class="text-5xl mb-3">👶</div>
        <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">暂无孩子账号</h3>
        <p class="text-xs text-slate-400 mb-6">点击右上角“添加新孩子账号”开始使用</p>
      </div>

      <!-- Children List Cards -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="child in children"
          :key="child.id"
          class="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200/80 dark:border-slate-700/80 shadow-card flex flex-col justify-between"
        >
          <div>
            <div class="flex items-start justify-between mb-4">
              <div class="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/40 flex items-center justify-center text-4xl shadow-inner">
                {{ child.avatar_emoji || '🐱' }}
              </div>

              <span
                class="px-2.5 py-1 rounded-full text-xs font-bold"
                :class="child.has_pin ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'"
              >
                {{ child.has_pin ? '🔒 PIN 保护' : '⚡ 免密直接登录' }}
              </span>
            </div>

            <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1">
              {{ child.name }}
            </h3>
            <p class="text-xs text-slate-400">
              账号 ID: {{ child.id }}
            </p>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="openEditModal(child)"
                class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
              >
                ✏️ 编辑资料
              </button>
              <!-- Opens with the parent session, which may also take categories away -->
              <router-link
                :to="`/child/${child.id}/characters`"
                class="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
              >
                📖 字词本
              </router-link>
              <router-link :to="`/child/${child.id}/word-study`" class="px-3.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 font-bold text-xs">📚 学习计划</router-link>
            </div>

            <button
              type="button"
              @click="handleDelete(child.id)"
              class="px-3 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-bold text-xs transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- Add/Edit Modal -->
    <div
      v-if="showModal"
      class="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in"
      @click.self="showModal = false"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border-2 border-brand-100 dark:border-brand-800">
        <div class="flex items-center justify-between mb-5">
          <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>{{ isEditing ? '✏️ 编辑孩子账号' : '➕ 添加新孩子账号' }}</span>
          </h3>
          <button
            type="button"
            @click="showModal = false"
            class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold text-lg"
          >
            ✕
          </button>
        </div>

        <form @submit.prevent="submitChildForm" class="space-y-4">
          <!-- Name Input -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">孩子昵称</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="例如：小明、琪琪"
              class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none"
            />
          </div>

          <!-- Emoji Avatar Picker -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">选择专属 Emoji 头像</label>
            <div class="grid grid-cols-6 gap-2 bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-100 dark:border-slate-700">
              <button
                v-for="emoji in availableEmojis"
                :key="emoji"
                type="button"
                @click="form.avatar_emoji = emoji"
                class="w-10 h-10 rounded-xl flex items-center justify-center text-2xl transition-all"
                :class="[
                  form.avatar_emoji === emoji
                    ? 'bg-brand-500 text-white shadow-button scale-110'
                    : 'bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 active:scale-95'
                ]"
              >
                {{ emoji }}
              </button>
            </div>
          </div>

          <!-- PIN Code Input -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">
              4 位独立 PIN 密码
              <span class="text-slate-400 font-normal">(可选，留空则免密码进入)</span>
            </label>
            <input
              v-model="form.pin"
              type="password"
              maxlength="4"
              placeholder="如 1234，留空则免密"
              class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none"
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              @click="showModal = false"
              class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="submitting || !form.name.trim()"
              class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50 transition-all"
            >
              {{ submitting ? '保存中...' : '确认保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { confirmAction } from '../utils/confirmation';
import { ref, onMounted } from 'vue';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';

const children = ref([]);
const loading = ref(true);

const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const submitting = ref(false);

const availableEmojis = ['🐱', '🦁', '🐼', '🐰', '🦊', '🐨', '🦄', '🐯', '🐶', '🐻', '🐵', '🐸'];

const form = ref({
  name: '',
  avatar_emoji: '🐱',
  pin: ''
});

onMounted(async () => {
  await loadChildren();
});

async function loadChildren() {
  loading.value = true;
  try {
    children.value = await api.getChildren();
  } catch (err) {
    console.error('Failed to load children:', err);
  } finally {
    loading.value = false;
  }
}

function openAddModal() {
  isEditing.value = false;
  editingId.value = null;
  form.value = {
    name: '',
    avatar_emoji: '🐱',
    pin: ''
  };
  showModal.value = true;
}

function openEditModal(child) {
  isEditing.value = true;
  editingId.value = child.id;
  form.value = {
    name: child.name,
    avatar_emoji: child.avatar_emoji || '🐱',
    pin: ''
  };
  showModal.value = true;
}

async function submitChildForm() {
  if (!form.value.name.trim()) return;
  submitting.value = true;
  try {
    if (isEditing.value) {
      await api.updateChild(editingId.value, {
        name: form.value.name.trim(),
        avatar_emoji: form.value.avatar_emoji,
        pin: form.value.pin ? form.value.pin.trim() : undefined
      });
    } else {
      await api.createChild({
        name: form.value.name.trim(),
        avatar_emoji: form.value.avatar_emoji,
        pin: form.value.pin ? form.value.pin.trim() : undefined
      });
    }
    showModal.value = false;
    await loadChildren();
  } catch (err) {
    console.error('Failed to save child:', err);
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id) {
  if (!await confirmAction('确定要删除该孩子账号吗？删除后相关日常任务和记录将被清除。')) return;
  try {
    await api.deleteChild(id);
    await loadChildren();
  } catch (err) {
    console.error('Failed to delete child:', err);
  }
}
</script>
