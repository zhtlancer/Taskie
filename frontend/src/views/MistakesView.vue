<template>
  <div
    class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col justify-between p-3 pb-24 sm:p-6 lg:pb-6 select-none relative"
    @dragover.prevent="isPageDragOver = true"
    @dragleave.prevent="isPageDragOver = false"
    @drop.prevent="onPageDrop"
  >
    <!-- Drag & Drop Full Page Overlay Hint -->
    <div
      v-if="isPageDragOver"
      class="fixed inset-0 z-40 bg-brand-500/80 backdrop-blur-sm flex flex-col items-center justify-center text-white border-8 border-dashed border-white/60 pointer-events-none animate-pulse"
    >
      <div class="text-7xl mb-4">📸</div>
      <h2 class="text-3xl font-black mb-2">松开即可进入错题拍照裁剪！</h2>
      <p class="text-base text-white/80 font-bold">支持旋转、九宫格区域裁剪与拉普拉斯清晰锐化</p>
    </div>

    <!-- Hidden Camera & Gallery Inputs on Page -->
    <input
      ref="headerCameraInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      @change="onHeaderFileSelected"
    />
    <input
      ref="headerGalleryInput"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onHeaderFileSelected"
    />

    <div class="max-w-5xl w-full mx-auto">
      <!-- Header -->
      <header class="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            class="hidden lg:flex w-12 h-12 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 items-center justify-center text-xl text-slate-600 dark:text-slate-300 hover:border-brand-300 dark:hover:border-brand-700 shadow-sm active:scale-95 transition-all"
            title="返回今日看板"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
              <span>📖</span>
              <span>错题智能本</span>
            </h1>
            <p class="text-xs font-bold text-slate-400">
              错题不可怕，搞懂它就是最大的进步！拍照裁剪自动锐化
            </p>
          </div>
        </div>

        <!-- Action Buttons (iPad Air 5 touch friendly) -->
        <div class="flex flex-wrap items-center gap-2.5 whitespace-nowrap">
          <!-- Primary: Camera Button -->
          <button
            type="button"
            @click="triggerCamera"
            class="h-11 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 text-white font-black text-xs shadow-button active:scale-95 transition-all flex items-center gap-1.5"
          >
            <span class="text-base">📸</span>
            <span>拍照录入错题</span>
          </button>

          <!-- Secondary: Gallery Button -->
          <button
            type="button"
            @click="triggerGallery"
            class="h-11 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center gap-1.5"
          >
            <span class="text-base">🖼️</span>
            <span>相册选图</span>
          </button>

          <!-- Secondary: Pure Text Button -->
          <button
            type="button"
            @click="openAddTextModal"
            class="h-11 px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center gap-1"
            title="纯文字输入记录"
          >
            <span>✍️</span>
            <span>文字录入</span>
          </button>

          <SoundToggle />

          <router-link
            :to="`/child/${childId}/characters`"
            @click="playClick"
            class="hidden lg:flex h-11 px-3.5 rounded-xl bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 font-bold text-xs shadow-xs hover:bg-brand-100 dark:hover:bg-brand-900/40 active:scale-95 transition-all items-center gap-1.5"
            title="生字生词本"
          >
            <span>📖</span>
            <span>生字生词本</span>
          </router-link>

          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:flex h-11 px-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all items-center"
          >
            返回今日看板
          </router-link>
        </div>
      </header>

      <!-- Filter Controls -->
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-700/80 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-4">
        <!-- Subject Filter Tabs -->
        <div class="flex flex-wrap items-center gap-2 whitespace-nowrap">
          <span class="text-xs font-bold text-slate-400 mr-1">学科：</span>
          <button
            v-for="sub in ['全部', '语文', '数学', '英语', '其他']"
            :key="sub"
            type="button"
            @click="selectedSubject = sub"
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all"
            :class="[
              selectedSubject === sub
                ? 'bg-brand-500 text-white shadow-button'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            ]"
          >
            {{ sub }}
          </button>
        </div>

        <!-- Mastered Status Tabs -->
        <div class="flex flex-wrap items-center gap-2 whitespace-nowrap">
          <span class="text-xs font-bold text-slate-400 mr-1">状态：</span>
          <button
            v-for="status in ['全部', '待复习', '已攻克']"
            :key="status"
            type="button"
            @click="statusFilter = status"
            class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all"
            :class="[
              statusFilter === status
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            ]"
          >
            {{ status }}
          </button>
        </div>
      </div>

      <!-- Mistakes Grid -->
      <div>
        <div v-if="loading" class="flex justify-center items-center py-24 text-brand-500 dark:text-brand-400 font-bold">
          <span class="animate-spin mr-2">⏳</span> 正在整理错题...
        </div>

        <div v-else-if="loadError && !mistakes.length" role="alert" class="bg-white dark:bg-slate-900 rounded-3xl p-12 border border-rose-200 dark:border-rose-800 text-center max-w-lg mx-auto space-y-3">
          <p class="text-sm font-bold text-rose-600 dark:text-rose-300">错题没有读取成功，这不代表没有错题。</p>
          <button type="button" class="min-h-[44px] px-4 rounded-xl bg-brand-500 text-white text-xs font-bold" @click="loadMistakes">重新读取</button>
        </div>

        <div
          v-else-if="filteredMistakes.length === 0"
          class="bg-white dark:bg-slate-900 rounded-3xl p-12 border border-slate-200 dark:border-slate-700 text-center shadow-card max-w-lg mx-auto"
        >
          <div class="text-5xl mb-3">🎉</div>
          <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mb-1">太棒了，暂无符合条件的错题！</h3>
          <p class="text-xs text-slate-400 mb-6">做题有疑问可立即使用 iPad 拍照录入并精准裁剪</p>

          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              @click="triggerCamera"
              class="h-12 px-6 rounded-2xl bg-gradient-to-r from-brand-500 to-indigo-600 text-white text-xs font-bold shadow-button flex items-center justify-center gap-2 active:scale-95 transition-all w-full sm:w-auto"
            >
              <span class="text-base">📸</span>
              <span>拍照录入错题</span>
            </button>
            <button
              type="button"
              @click="triggerGallery"
              class="h-12 px-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold shadow-sm hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center gap-2 active:scale-95 transition-all w-full sm:w-auto"
            >
              <span class="text-base">🖼️</span>
              <span>相册选图</span>
            </button>
          </div>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MistakeCard
            v-for="mistake in filteredMistakes"
            :key="mistake.id"
            :mistake="mistake"
            @toggle-master="handleToggleMaster"
            @delete="handleDeleteMistake"
            @preview-photo="handlePreviewPhoto"
          />
        </div>
      </div>
    </div>

    <!-- Photo Crop & Enhancement Modal (PhotoCropModal.vue) -->
    <PhotoCropModal
      v-if="showCropModal"
      :child-id="childId"
      :initial-file="cropModalFile"
      @close="closeCropModal"
      @saved="onCropMistakeSaved"
    />

    <!-- Text Only Add Mistake Modal -->
    <div
      v-if="showAddTextModal"
      class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-pop-in"
      @click.self="showAddTextModal = false"
    >
      <div class="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border-2 border-brand-100 dark:border-brand-800">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>✍️</span>
            <span>添加纯文字错题记录</span>
          </h3>
          <button
            type="button"
            @click="showAddTextModal = false"
            class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 font-bold text-lg"
          >
            ✕
          </button>
        </div>

        <form @submit.prevent="submitAddTextMistake" class="space-y-4">
          <!-- Subject Select -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">选择学科</label>
            <div class="grid grid-cols-4 gap-2">
              <button
                v-for="sub in ['语文', '数学', '英语', '其他']"
                :key="sub"
                type="button"
                @click="formSubject = sub"
                class="py-2 rounded-xl text-xs font-bold border transition-all"
                :class="[
                  formSubject === sub
                    ? 'bg-brand-500 border-brand-500 text-white shadow-button'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                ]"
              >
                {{ sub }}
              </button>
            </div>
          </div>

          <!-- Description Textarea -->
          <div>
            <label class="block text-xs font-bold text-slate-600 dark:text-slate-300 mb-1.5">题目内容与错误原因描述</label>
            <textarea
              v-model="formDescription"
              rows="4"
              required
              placeholder="记录题目、做错的原因或正确解题思路..."
              class="w-full rounded-2xl border border-slate-200 dark:border-slate-700 p-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-800 outline-none resize-none"
            ></textarea>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-700">
            <button
              type="button"
              @click="showAddTextModal = false"
              class="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="submitting || !formDescription.trim()"
              class="px-6 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-button disabled:opacity-50 transition-all"
            >
              {{ submitting ? '保存中...' : '确认保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Fullscreen Photo Viewer Modal -->
    <div
      v-if="enlargedPhotoUrl"
      class="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-4 animate-pop-in"
      @click="enlargedPhotoUrl = null"
    >
      <div class="relative max-w-4xl max-h-[90vh] flex flex-col items-center">
        <button
          type="button"
          @click.stop="enlargedPhotoUrl = null"
          class="absolute -top-12 right-0 w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 text-white font-black text-lg flex items-center justify-center transition-all"
        >
          ✕
        </button>
        <PrivatePhoto
          :src="enlargedPhotoUrl"
          alt="查看错题高清大图"
          class="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl border border-white/20"
        />
      </div>
    </div>
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import { confirmAction } from '../utils/confirmation';
import ChildTabBar from '../components/ChildTabBar.vue';
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api/client';
import { useChildStore } from '../stores/child';
import MistakeCard from '../components/MistakeCard.vue';
import PrivatePhoto from '../components/PrivatePhoto.vue';
import PhotoCropModal from '../components/PhotoCropModal.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick, playTaskComplete, playTaskUncomplete } from '../utils/sound';

const route = useRoute();
const childStore = useChildStore();

const childId = computed(() => route.params.id || childStore.childId || 'child-demo-1');
const mistakes = ref([]);
const loading = ref(true);

const selectedSubject = ref('全部');
const statusFilter = ref('全部');

// Header file inputs
const headerCameraInput = ref(null);
const headerGalleryInput = ref(null);

// Crop modal controls
const showCropModal = ref(false);
const cropModalFile = ref(null);
const isPageDragOver = ref(false);

// Text only modal
const showAddTextModal = ref(false);
const formSubject = ref('数学');
const formDescription = ref('');
const submitting = ref(false);

// Fullscreen photo preview
const enlargedPhotoUrl = ref(null);

const filteredMistakes = computed(() => {
  return mistakes.value.filter(m => {
    const matchSub = selectedSubject.value === '全部' || m.subject === selectedSubject.value;
    let matchStatus = true;
    if (statusFilter.value === '待复习') matchStatus = !m.is_mastered;
    if (statusFilter.value === '已攻克') matchStatus = m.is_mastered;
    return matchSub && matchStatus;
  });
});

onMounted(async () => {
  await loadMistakes();
});

const loadError = ref(false);
async function loadMistakes() {
  loading.value = true;
  try {
    mistakes.value = await api.getMistakes(childId.value);
    loadError.value = false;
  } catch (err) {
    loadError.value = true;
    console.error('Failed to load mistakes:', err);
  } finally {
    loading.value = false;
  }
}

function openAddTextModal() {
  playClick();
  showAddTextModal.value = true;
}

function triggerCamera() {
  playClick();
  if (headerCameraInput.value) {
    headerCameraInput.value.click();
  } else {
    cropModalFile.value = null;
    showCropModal.value = true;
  }
}

function triggerGallery() {
  playClick();
  if (headerGalleryInput.value) {
    headerGalleryInput.value.click();
  } else {
    cropModalFile.value = null;
    showCropModal.value = true;
  }
}

function onHeaderFileSelected(e) {
  const file = e.target.files?.[0];
  if (file) {
    cropModalFile.value = file;
    showCropModal.value = true;
  }
  e.target.value = '';
}

function onPageDrop(e) {
  isPageDragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    cropModalFile.value = file;
    showCropModal.value = true;
  }
}

function closeCropModal() {
  showCropModal.value = false;
  cropModalFile.value = null;
}

function onCropMistakeSaved(newRecord) {
  mistakes.value.unshift(newRecord);
  closeCropModal();
}

function handlePreviewPhoto(photoPath) {
  playClick();
  enlargedPhotoUrl.value = photoPath;
}

async function handleToggleMaster(mistake) {
  const willMaster = !mistake.is_mastered;
  try {
    if (willMaster) {
      playTaskComplete();
    } else {
      playTaskUncomplete();
    }
    const updated = await api.markMistakeMastered(mistake.id, willMaster);
    mistake.is_mastered = updated.is_mastered;
    mistake.mastered_at = updated.mastered_at;
  } catch (err) {
    console.error('Failed to toggle mistake mastered:', err);
  }
}

async function handleDeleteMistake(id) {
  if (!await confirmAction('确定要删除这条错题记录吗？')) return;
  playClick();
  try {
    await api.deleteMistake(id);
    mistakes.value = mistakes.value.filter(m => m.id !== id);
  } catch (err) {
    console.error('Failed to delete mistake:', err);
  }
}

async function submitAddTextMistake() {
  if (!formDescription.value.trim()) return;
  submitting.value = true;
  try {
    const newRecord = await api.createMistake({
      child_id: childId.value,
      subject: formSubject.value,
      description: formDescription.value.trim()
    });
    mistakes.value.unshift(newRecord);
    showAddTextModal.value = false;
    formDescription.value = '';
  } catch (err) {
    console.error('Failed to add mistake:', err);
  } finally {
    submitting.value = false;
  }
}
</script>
