<template>
  <div class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col select-none">
    <ParentNavBar />

    <main class="max-w-6xl w-full mx-auto p-4 sm:p-6 flex-1">
      <ParentPageHeader icon="👶" title="孩子档案" description="配置孩子基本信息、头像和独立 PIN 码。">
        <template #actions><button type="button" :disabled="actionsDisabled" class="ui-button-primary" @click="openAddModal">➕ 添加新孩子账号</button></template>
      </ParentPageHeader>

      <ParentSectionNav section="management" />

      <ParentPageState v-if="loading" kind="loading" title="正在读取孩子档案…" />
      <ParentPageState v-if="loadError" kind="error" title="孩子档案未能读取" :description="loadError" :busy="loading || busy" @retry="loadChildren" />
      <p v-if="pageError" role="alert" class="mb-4 text-sm text-rose-600 dark:text-rose-300">{{ pageError }}</p>
      <ParentPageState v-if="!loading && !loadError && !children.length" title="暂无孩子账号" description="添加孩子档案，设置昵称、头像和登录方式。">
        <template #actions><button type="button" :disabled="actionsDisabled" class="ui-button-secondary" @click="openAddModal">添加孩子</button></template>
      </ParentPageState>

      <!-- Children List Cards -->
      <div v-if="!loading && children.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="child in children"
          :key="child.id"
          :data-child-id="child.id"
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

            <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100 mb-1 break-words">
              {{ child.name }}
            </h3>
            <p class="text-xs text-slate-400">
              账号 ID: {{ child.id }}
            </p>
          </div>

          <div class="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-2">
              <button
                type="button"
                :disabled="actionsDisabled"
                @click="openEditModal(child)"
                class="min-h-11 min-w-11 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
              >
                ✏️ 编辑资料
              </button>
              <!-- Opens with the parent session, which may also take categories away -->
              <router-link
                :to="`/child/${child.id}/characters`"
                class="inline-flex items-center min-h-11 min-w-11 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-brand-50 dark:hover:bg-brand-900/40 hover:text-brand-600 dark:hover:text-brand-300 text-slate-600 dark:text-slate-300 font-bold text-xs transition-colors"
              >
                📖 字词本
              </router-link>
              <router-link :to="{ path: '/parent/word-plans', query: { child: child.id } }" class="inline-flex items-center min-h-11 min-w-11 px-3.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 font-bold text-xs">📚 学习计划</router-link>

            <button
              type="button"
              :disabled="actionsDisabled"
              @click="handleDelete(child.id)"
              class="ml-auto min-h-11 min-w-11 px-3 py-1.5 rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 dark:hover:text-rose-300 font-bold text-xs transition-colors"
            >
              删除
            </button>
          </div>
        </div>
      </div>
    </main>

    <!-- Add/Edit Modal -->
    <UiDialog v-if="showModal" :title="isEditing ? '✏️ 编辑孩子账号' : '➕ 添加新孩子账号'" :busy="submitting" @close="closeForm">
        <form @submit.prevent="submitChildForm">
          <fieldset :disabled="submitting" class="space-y-4 min-w-0">
          <p v-if="formError" role="alert" class="text-sm text-rose-600 dark:text-rose-300">{{ formError }}</p>
          <!-- Name Input -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">孩子昵称</label>
            <input
              v-model="form.name"
              aria-label="孩子昵称" autofocus
              type="text"
              required
              placeholder="例如：小明、琪琪"
              class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none"
            />
          </div>

          <!-- Emoji Avatar Picker -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">选择专属 Emoji 头像</label>
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-2 bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-100 dark:border-slate-700">
              <button
                v-for="emoji in availableEmojis"
                :key="emoji"
                type="button"
                @click="form.avatar_emoji = emoji"
                :aria-pressed="form.avatar_emoji === emoji"
                class="min-w-11 min-h-11 rounded-xl flex items-center justify-center text-2xl transition-all"
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
              <span class="text-slate-400 font-normal">{{ isEditing ? '(可选，留空保留原登录方式)' : '(可选，留空则免密码进入)' }}</span>
            </label>
            <input
              v-model="form.pin"
              aria-label="4 位独立 PIN 密码" inputmode="numeric" pattern="[0-9]{4}" autocomplete="new-password"
              type="password"
              maxlength="4"
              :placeholder="isEditing ? '留空保留原登录方式' : '如 1234，留空则免密'"
              class="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none"
            />
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              @click="closeForm"
              class="min-h-11 min-w-11 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="submitting || !form.name.trim()"
              class="min-h-11 min-w-11 px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50 transition-all"
            >
              {{ submitting ? '保存中...' : '确认保存' }}
            </button>
          </div>
          </fieldset>
        </form>
    </UiDialog>
  </div>
</template>

<script setup>
import { confirmAction } from '../utils/confirmation';
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { hasSession } from '../utils/session';
import api from '../api/client';
import ParentNavBar from '../components/ParentNavBar.vue';
import ParentPageHeader from '../components/ParentPageHeader.vue';
import ParentPageState from '../components/ParentPageState.vue';
import UiDialog from '../components/UiDialog.vue';
import ParentSectionNav from '../components/ParentSectionNav.vue';

const children = ref([]);
const loading = ref(true);

const showModal = ref(false);
const isEditing = ref(false);
const editingId = ref(null);
const submitting = ref(false);
const mutationBusy = ref(false), loadError = ref(''), formError = ref(''), pageError = ref('');
const busy = computed(() => submitting.value || mutationBusy.value);
const actionsDisabled = computed(() => busy.value || loading.value || Boolean(loadError.value));
let alive = true, loadSerial = 0;
const closeForm = () => { if (!submitting.value) showModal.value = false; };
onBeforeRouteLeave(to => !hasSession('parent') || ['/parent/login', '/parent/setup-pin'].includes(to.path) || !busy.value);
const restored = () => { showModal.value = false; formError.value = ''; pageError.value = ''; loadChildren(); };
onMounted(() => window.addEventListener('taskie:data-restored', restored));
onBeforeUnmount(() => { alive = false; loadSerial++; window.removeEventListener('taskie:data-restored', restored); });

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
  const serial = ++loadSerial;
  loading.value = true; loadError.value = '';
  try {
    const rows = await api.getChildren();
    if (alive && serial === loadSerial) { children.value = rows; loadError.value = ''; }
  } catch (err) {
    if (alive && serial === loadSerial) loadError.value = err.message || String(err);
  } finally {
    if (alive && serial === loadSerial) loading.value = false;
  }
}

function openAddModal() {
  if (actionsDisabled.value) return;
  formError.value = '';
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
  if (actionsDisabled.value) return;
  formError.value = '';
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
  if (busy.value || !form.value.name.trim()) return;
  submitting.value = true; formError.value = '';
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
    formError.value = err.message || String(err);
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id) {
  if (actionsDisabled.value) return;
  if (!await confirmAction('确定要删除该孩子账号吗？删除后相关日常任务和记录将被清除。')) return;
  if (actionsDisabled.value || !alive) return;
  mutationBusy.value = true; pageError.value = '';
  try {
    await api.deleteChild(id);
    await loadChildren();
  } catch (err) {
    pageError.value = err.message || String(err);
  } finally { mutationBusy.value = false; }
}
</script>
