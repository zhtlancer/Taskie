<template>
  <div
    class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 select-none"
    @click.self="handleClose"
  >
    <!-- Modal Window (Optimized for iPad Air 5 Landscape 1180x820) -->
    <div
      class="bg-white rounded-3xl shadow-2xl border border-slate-200/80 w-full max-w-5xl h-[760px] max-h-[94vh] flex flex-col overflow-hidden animate-pop-in"
    >
      <!-- Modal Header -->
      <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0 bg-white">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-brand-50 flex items-center justify-center text-xl text-brand-500 font-black">
            {{ step === 'select' ? '📸' : step === 'crop' ? '✂️' : '✨' }}
          </div>
          <div>
            <h2 class="text-base sm:text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <span v-if="step === 'select'">拍照或选择错题图片</span>
              <span v-else-if="step === 'crop'">交互式区域裁剪 & 旋转</span>
              <span v-else>清晰锐化增强 & 完善错题</span>
            </h2>
            <p class="hidden sm:block text-xs text-slate-400 font-medium">
              <span v-if="step === 'select'">支持 iPad 相机拍照、相册选图或拖拽文件</span>
              <span v-else-if="step === 'crop'">拖动手势缩放裁剪框，四角自由拉伸，支持 90° 旋转校正</span>
              <span v-else>应用拉普拉斯 3×3 锐化及白纸去灰底滤镜，高质量压缩保存</span>
            </p>
          </div>
        </div>

        <!-- Step Indicator & Close Button -->
        <div class="flex items-center gap-4">
          <div v-if="step !== 'select'" class="hidden md:flex items-center gap-2 text-xs font-bold whitespace-nowrap">
            <span
              class="px-3 py-1 rounded-full transition-all"
              :class="step === 'crop' ? 'bg-brand-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'"
            >
              1. 裁剪旋转
            </span>
            <span class="text-slate-300">→</span>
            <span
              class="px-3 py-1 rounded-full transition-all"
              :class="step === 'filter' ? 'bg-brand-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500'"
            >
              2. 滤镜保存
            </span>
          </div>

          <button
            type="button"
            @click="handleClose"
            class="w-12 h-12 rounded-2xl hover:bg-slate-100 active:scale-95 text-slate-400 hover:text-slate-600 font-bold text-xl flex items-center justify-center transition-all"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Hidden standard file inputs -->
      <input
        ref="cameraInputRef"
        type="file"
        accept="image/*"
        capture="environment"
        class="hidden"
        @change="onFileInputChange"
      />
      <input
        ref="galleryInputRef"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onFileInputChange"
      />

      <!-- ================= STEP 0: Select File / Camera / Dropzone ================= -->
      <div
        v-if="step === 'select'"
        class="flex-1 p-8 flex flex-col items-center justify-center bg-slate-50/50"
        @dragover.prevent="isDragOver = true"
        @dragleave.prevent="isDragOver = false"
        @drop.prevent="onDropFile"
      >
        <div
          class="w-full max-w-2xl border-3 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center text-center transition-all"
          :class="[
            isDragOver
              ? 'border-brand-500 bg-brand-50/50 scale-[1.01]'
              : 'border-slate-300 hover:border-brand-400 bg-white shadow-sm'
          ]"
        >
          <div class="text-6xl mb-4 animate-bounce">📸</div>
          <h3 class="text-2xl font-black text-slate-800 mb-2">录入错题拍照图片</h3>
          <p class="text-sm text-slate-400 max-w-md mb-8">
            专为小学生 iPad 横屏设计。拍完后可自由框选错题区域，系统将自动锐化字迹并滤除纸张暗底！
          </p>

          <!-- Big Touch Buttons (≥ 48px height) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
            <button
              type="button"
              @click="triggerCamera"
              class="h-16 rounded-2xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 text-white font-black text-base shadow-button flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <span class="text-2xl">📸</span>
              <span>拍照录入错题</span>
            </button>

            <button
              type="button"
              @click="triggerGallery"
              class="h-16 rounded-2xl bg-white border-2 border-slate-200 hover:border-brand-300 hover:bg-slate-50 text-slate-700 font-black text-base shadow-sm flex items-center justify-center gap-2 active:scale-95 transition-all"
            >
              <span class="text-2xl">🖼️</span>
              <span>相册选图</span>
            </button>
          </div>

          <div class="mt-6 text-xs text-slate-400 font-bold flex items-center gap-1.5">
            <span>💡</span>
            <span>亦可直接将错题图片拖拽至此区域</span>
          </div>
        </div>
      </div>

      <!-- ================= STEP 1: Interactive Crop & Rotate ================= -->
      <div v-else-if="step === 'crop'" class="flex-1 flex flex-col overflow-hidden bg-slate-900/95">
        <!-- Interactive Workspace -->
        <div
          ref="cropContainerRef"
          class="flex-1 relative overflow-hidden flex items-center justify-center select-none touch-none"
        >
          <!-- Display Canvas for Rotated Source Image -->
          <canvas
            ref="sourceCanvasRef"
            class="shadow-2xl pointer-events-none rounded-sm"
            :style="{
              width: displayMetrics.width + 'px',
              height: displayMetrics.height + 'px'
            }"
          ></canvas>

          <!-- Dark Masks Outside Crop Area -->
          <div
            class="absolute bg-slate-950/70 pointer-events-none"
            :style="{
              left: displayMetrics.left + 'px',
              top: displayMetrics.top + 'px',
              width: displayMetrics.width + 'px',
              height: Math.max(0, cropRect.y - displayMetrics.top) + 'px'
            }"
          ></div>
          <div
            class="absolute bg-slate-950/70 pointer-events-none"
            :style="{
              left: displayMetrics.left + 'px',
              top: (cropRect.y + cropRect.height) + 'px',
              width: displayMetrics.width + 'px',
              height: Math.max(0, (displayMetrics.top + displayMetrics.height) - (cropRect.y + cropRect.height)) + 'px'
            }"
          ></div>
          <div
            class="absolute bg-slate-950/70 pointer-events-none"
            :style="{
              left: displayMetrics.left + 'px',
              top: cropRect.y + 'px',
              width: Math.max(0, cropRect.x - displayMetrics.left) + 'px',
              height: cropRect.height + 'px'
            }"
          ></div>
          <div
            class="absolute bg-slate-950/70 pointer-events-none"
            :style="{
              left: (cropRect.x + cropRect.width) + 'px',
              top: cropRect.y + 'px',
              width: Math.max(0, (displayMetrics.left + displayMetrics.width) - (cropRect.x + cropRect.width)) + 'px',
              height: cropRect.height + 'px'
            }"
          ></div>

          <!-- Interactive Crop Box -->
          <div
            class="absolute cursor-move border-2 border-brand-400 shadow-[0_0_0_1px_rgba(255,255,255,0.7)] touch-none"
            :style="{
              left: cropRect.x + 'px',
              top: cropRect.y + 'px',
              width: cropRect.width + 'px',
              height: cropRect.height + 'px'
            }"
            @pointerdown.stop.prevent="startDrag($event, 'move')"
          >
            <!-- 3x3 Grid Guidelines (九宫格辅助线) -->
            <div class="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
              <div class="border-r border-b border-dashed border-white/40"></div>
              <div class="border-r border-b border-dashed border-white/40"></div>
              <div class="border-b border-dashed border-white/40"></div>
              <div class="border-r border-b border-dashed border-white/40"></div>
              <div class="border-r border-b border-dashed border-white/40"></div>
              <div class="border-b border-dashed border-white/40"></div>
              <div class="border-r border-dashed border-white/40"></div>
              <div class="border-r border-dashed border-white/40"></div>
              <div></div>
            </div>

            <!-- Touch-friendly Corner Handles (Hit area: 48x48px, meets iPad touch standard) -->
            <!-- Top-Left Handle -->
            <div
              class="absolute -top-6 -left-6 w-12 h-12 flex items-center justify-center cursor-nwse-resize touch-none z-20"
              @pointerdown.stop.prevent="startDrag($event, 'tl')"
            >
              <div class="w-5 h-5 rounded-full bg-white border-2 border-brand-500 shadow-md"></div>
            </div>

            <!-- Top-Right Handle -->
            <div
              class="absolute -top-6 -right-6 w-12 h-12 flex items-center justify-center cursor-nesw-resize touch-none z-20"
              @pointerdown.stop.prevent="startDrag($event, 'tr')"
            >
              <div class="w-5 h-5 rounded-full bg-white border-2 border-brand-500 shadow-md"></div>
            </div>

            <!-- Bottom-Left Handle -->
            <div
              class="absolute -bottom-6 -left-6 w-12 h-12 flex items-center justify-center cursor-nesw-resize touch-none z-20"
              @pointerdown.stop.prevent="startDrag($event, 'bl')"
            >
              <div class="w-5 h-5 rounded-full bg-white border-2 border-brand-500 shadow-md"></div>
            </div>

            <!-- Bottom-Right Handle -->
            <div
              class="absolute -bottom-6 -right-6 w-12 h-12 flex items-center justify-center cursor-nwse-resize touch-none z-20"
              @pointerdown.stop.prevent="startDrag($event, 'br')"
            >
              <div class="w-5 h-5 rounded-full bg-white border-2 border-brand-500 shadow-md"></div>
            </div>

            <!-- Edge Handles (Hit area: 48x48px) -->
            <!-- Top Edge -->
            <div
              class="absolute -top-6 left-1/2 -translate-x-1/2 w-12 h-12 flex items-center justify-center cursor-ns-resize touch-none z-10"
              @pointerdown.stop.prevent="startDrag($event, 't')"
            >
              <div class="w-6 h-2 rounded-full bg-white/90 border border-brand-500 shadow-sm"></div>
            </div>
            <!-- Bottom Edge -->
            <div
              class="absolute -bottom-6 left-1/2 -translate-x-1/2 w-12 h-12 flex items-center justify-center cursor-ns-resize touch-none z-10"
              @pointerdown.stop.prevent="startDrag($event, 'b')"
            >
              <div class="w-6 h-2 rounded-full bg-white/90 border border-brand-500 shadow-sm"></div>
            </div>
            <!-- Left Edge -->
            <div
              class="absolute top-1/2 -translate-y-1/2 -left-6 w-12 h-12 flex items-center justify-center cursor-ew-resize touch-none z-10"
              @pointerdown.stop.prevent="startDrag($event, 'l')"
            >
              <div class="w-2 h-6 rounded-full bg-white/90 border border-brand-500 shadow-sm"></div>
            </div>
            <!-- Right Edge -->
            <div
              class="absolute top-1/2 -translate-y-1/2 -right-6 w-12 h-12 flex items-center justify-center cursor-ew-resize touch-none z-10"
              @pointerdown.stop.prevent="startDrag($event, 'r')"
            >
              <div class="w-2 h-6 rounded-full bg-white/90 border border-brand-500 shadow-sm"></div>
            </div>
          </div>
        </div>

        <!-- Crop Controls Bottom Bar (Touch-friendly buttons ≥ 48px height) -->
        <div class="sm:h-20 py-3 sm:py-0 bg-slate-900 border-t border-slate-800 px-3 sm:px-6 flex items-center justify-between gap-2 shrink-0 whitespace-nowrap">
          <div class="flex items-center gap-2 sm:gap-3">
            <!-- Rotate 90° Button -->
            <button
              type="button"
              @click="rotateClockwise"
              class="h-12 px-3.5 sm:px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center gap-2 border border-slate-700 active:scale-95 transition-all"
            >
              <span class="text-base">↻</span>
              <span class="hidden sm:inline">顺时针旋转 90°</span>
            </button>

            <!-- Reset Crop -->
            <button
              type="button"
              @click="resetCropRect"
              class="h-12 px-3.5 sm:px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2 border border-slate-700 active:scale-95 transition-all"
            >
              <span>⟲</span>
              <span class="hidden sm:inline">重置选区</span>
            </button>

            <!-- Switch Photo -->
            <button
              type="button"
              @click="step = 'select'"
              class="h-12 px-3.5 sm:px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-2 border border-slate-700 active:scale-95 transition-all"
            >
              <span>🖼️</span>
              <span class="hidden sm:inline">换一张</span>
            </button>
          </div>

          <!-- Proceed to Filter & Save -->
          <button
            type="button"
            @click="proceedToFilter"
            class="h-12 px-4 sm:px-6 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 text-white font-bold text-sm shadow-button flex items-center gap-2 active:scale-95 transition-all"
          >
            <span class="sm:hidden">下一步</span>
            <span class="hidden sm:inline">✨ 完成裁剪，下一步 (滤镜增强)</span>
            <span>→</span>
          </button>
        </div>
      </div>

      <!-- ================= STEP 2: Filter Preview & Metadata Form ================= -->
      <div v-else-if="step === 'filter'" class="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden bg-slate-50">
        <!-- Left: Image Preview & Filter Mode Switcher (55% width; stacked on phones) -->
        <div class="w-full lg:w-7/12 p-4 lg:p-6 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200/80 bg-white">
          <!-- Filter Mode Buttons (≥ 48px height) -->
          <div class="mb-4">
            <label class="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
              图像滤镜处理模式
            </label>
            <div class="grid grid-cols-3 gap-2">
              <!-- Filter: Enhanced (Default) -->
              <button
                type="button"
                @click="switchFilter('enhanced')"
                class="h-14 rounded-2xl font-bold text-xs border-2 flex flex-col items-center justify-center transition-all"
                :class="[
                  activeFilter === 'enhanced'
                    ? 'bg-brand-500 border-brand-500 text-white shadow-button'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-brand-200 hover:bg-slate-50'
                ]"
              >
                <span class="flex items-center gap-1 text-sm">
                  <span>✨</span>
                  <span>清晰增强</span>
                </span>
                <span class="text-[10px] opacity-80">默认推荐 · 锐化去灰底</span>
              </button>

              <!-- Filter: Black & White Document -->
              <button
                type="button"
                @click="switchFilter('bw')"
                class="h-14 rounded-2xl font-bold text-xs border-2 flex flex-col items-center justify-center transition-all"
                :class="[
                  activeFilter === 'bw'
                    ? 'bg-slate-800 border-slate-800 text-white shadow-button'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                ]"
              >
                <span class="flex items-center gap-1 text-sm">
                  <span>📄</span>
                  <span>黑白文档</span>
                </span>
                <span class="text-[10px] opacity-80">自适应二值化 · 仿全能王</span>
              </button>

              <!-- Filter: Original -->
              <button
                type="button"
                @click="switchFilter('original')"
                class="h-14 rounded-2xl font-bold text-xs border-2 flex flex-col items-center justify-center transition-all"
                :class="[
                  activeFilter === 'original'
                    ? 'bg-slate-700 border-slate-700 text-white shadow-button'
                    : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                ]"
              >
                <span class="flex items-center gap-1 text-sm">
                  <span>📷</span>
                  <span>原图模式</span>
                </span>
                <span class="text-[10px] opacity-80">保留真实拍摄原貌</span>
              </button>
            </div>
          </div>

          <!-- Canvas Preview Window -->
          <div class="flex-1 min-h-[240px] lg:min-h-0 bg-slate-900 rounded-2xl p-3 flex items-center justify-center relative overflow-hidden shadow-inner">
            <div v-if="filterProcessing" class="absolute inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-10 text-white font-bold text-sm">
              <span class="animate-spin mr-2">⚙️</span> 滤镜渲染中...
            </div>
            <img
              v-if="processedPreviewUrl"
              :src="processedPreviewUrl"
              alt="裁剪增强预览"
              class="max-w-full max-h-full object-contain rounded-lg shadow-lg"
            />
          </div>

          <!-- Compression info badge -->
          <div class="mt-3 px-3 py-2 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
            <div class="flex items-center gap-2">
              <span class="font-bold text-emerald-600">✓ 压缩就绪</span>
              <span>·</span>
              <span>格式: <strong class="text-slate-700 uppercase">{{ compressionResult?.mimeType?.split('/')[1] || 'WEBP' }}</strong></span>
              <span>·</span>
              <span>体积: <strong class="text-brand-600">{{ formatFileSize(compressionResult?.size) }}</strong></span>
            </div>
            <span class="text-[11px] text-slate-400">已自动优化为 150~300KB 高清存储</span>
          </div>
        </div>

        <!-- Right: Form Fields (Subject, Description & Save) (45% width) -->
        <div class="w-full lg:w-5/12 p-4 lg:p-6 flex flex-col justify-between gap-4">
          <div class="space-y-5">
            <!-- Subject Selection (≥ 48px touch buttons) -->
            <div>
              <label class="block text-xs font-black text-slate-600 uppercase tracking-wider mb-2">
                所属学科
              </label>
              <div class="grid grid-cols-4 gap-2">
                <button
                  v-for="sub in ['语文', '数学', '英语', '其他']"
                  :key="sub"
                  type="button"
                  @click="formSubject = sub"
                  class="h-12 rounded-xl text-xs font-black border transition-all active:scale-95 flex items-center justify-center"
                  :class="[
                    formSubject === sub
                      ? 'bg-brand-500 border-brand-500 text-white shadow-button'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  ]"
                >
                  {{ sub }}
                </button>
              </div>
            </div>

            <!-- Description / Reflection Textarea -->
            <div>
              <label class="block text-xs font-black text-slate-600 uppercase tracking-wider mb-2">
                题目内容与错因记录
              </label>
              <textarea
                v-model="formDescription"
                rows="6"
                placeholder="记录题目重点、为什么做错、或正解要点（例如：看错审题条件、计算混合运算顺序有误...）"
                class="w-full rounded-2xl border border-slate-200 p-3.5 text-sm font-chinese text-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none resize-none bg-white shadow-sm"
              ></textarea>
            </div>

            <!-- Quick Hint Card -->
            <div class="p-3.5 rounded-2xl bg-indigo-50/70 border border-indigo-100/80 text-xs text-indigo-700 flex items-start gap-2.5">
              <span class="text-base">💡</span>
              <span class="leading-relaxed">
                拍好的错题图片已经完成边缘锐化与对比度增强，后续在错题本中支持一键复习与攻克标记！
              </span>
            </div>
          </div>

          <!-- Bottom Action Buttons (≥ 48px height) -->
          <div class="pt-4 border-t border-slate-200/80 flex items-center justify-between gap-3">
            <button
              type="button"
              @click="step = 'crop'"
              class="h-12 px-5 rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-100 font-bold text-xs flex items-center gap-1 active:scale-95 transition-all"
            >
              <span>←</span>
              <span>重新裁剪</span>
            </button>

            <button
              type="button"
              :disabled="saving || !formDescription.trim()"
              @click="saveMistakeRecord"
              class="h-12 flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-sm shadow-button disabled:opacity-50 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <span v-if="saving" class="animate-spin">⏳</span>
              <span>{{ saving ? '正在保存中...' : '✓ 确认保存至错题本' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, nextTick, onMounted, onUnmounted } from 'vue';
import {
  createRotatedCanvas,
  cropCanvasRegion,
  processCanvasWithFilter,
  compressCanvas
} from '../utils/imageProcess';
import api from '../api/client';
import { playCameraShutter, playClick } from '../utils/sound';

const props = defineProps({
  childId: {
    type: String,
    required: true
  },
  initialFile: {
    type: [File, Blob],
    default: null
  }
});

const emit = defineEmits(['close', 'saved']);

// Steps: 'select' -> 'crop' -> 'filter'
const step = ref('select');
const isDragOver = ref(false);

const cameraInputRef = ref(null);
const galleryInputRef = ref(null);
const cropContainerRef = ref(null);
const sourceCanvasRef = ref(null);

// Image & rotation state
let originalImage = null; // HTMLImageElement
const rotation = ref(0);
let currentRotatedCanvas = null;

// Display canvas metrics relative to cropContainerRef
const displayMetrics = reactive({
  left: 0,
  top: 0,
  width: 300,
  height: 200,
  scale: 1
});

// Interactive crop rectangle relative to cropContainerRef
const cropRect = reactive({
  x: 0,
  y: 0,
  width: 200,
  height: 150
});

// Dragging state
const dragState = reactive({
  active: false,
  type: null, // 'move', 'tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r'
  startX: 0,
  startY: 0,
  initCropX: 0,
  initCropY: 0,
  initCropW: 0,
  initCropH: 0
});

// Filter & form state
let baseCroppedCanvas = null; // Unfiltered cropped canvas
const activeFilter = ref('enhanced'); // 'enhanced', 'bw', 'original'
const filterProcessing = ref(false);
const processedPreviewUrl = ref('');
const compressionResult = ref(null);

const formSubject = ref('数学');
const formDescription = ref('');
const saving = ref(false);

// Lifecycle
onMounted(() => {
  window.addEventListener('pointermove', onGlobalPointerMove);
  window.addEventListener('pointerup', onGlobalPointerUp);
  window.addEventListener('pointercancel', onGlobalPointerUp);

  if (props.initialFile) {
    loadSourceFile(props.initialFile);
  }
});

onUnmounted(() => {
  window.removeEventListener('pointermove', onGlobalPointerMove);
  window.removeEventListener('pointerup', onGlobalPointerUp);
  window.removeEventListener('pointercancel', onGlobalPointerUp);
});

function handleClose() {
  emit('close');
}

function triggerCamera() {
  cameraInputRef.value?.click();
}

function triggerGallery() {
  galleryInputRef.value?.click();
}

function onFileInputChange(e) {
  const file = e.target.files?.[0];
  if (file) {
    loadSourceFile(file);
  }
  // Reset input so same file can be selected again
  e.target.value = '';
}

function onDropFile(e) {
  isDragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    loadSourceFile(file);
  }
}

function loadSourceFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      rotation.value = 0;
      step.value = 'crop';
      nextTick(() => {
        initCropWorkspace();
      });
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// Initialize crop canvas and dimensions
function initCropWorkspace() {
  if (!originalImage || !cropContainerRef.value) return;

  // 1. Create rotated canvas
  currentRotatedCanvas = createRotatedCanvas(originalImage, rotation.value);

  // 2. Measure container
  const containerW = cropContainerRef.value.clientWidth;
  const containerH = cropContainerRef.value.clientHeight;

  const pad = 36;
  const availW = Math.max(100, containerW - pad * 2);
  const availH = Math.max(100, containerH - pad * 2);

  const imgW = currentRotatedCanvas.width;
  const imgH = currentRotatedCanvas.height;

  const scale = Math.min(availW / imgW, availH / imgH);
  const dispW = Math.round(imgW * scale);
  const dispH = Math.round(imgH * scale);
  const dispX = Math.round((containerW - dispW) / 2);
  const dispY = Math.round((containerH - dispH) / 2);

  displayMetrics.left = dispX;
  displayMetrics.top = dispY;
  displayMetrics.width = dispW;
  displayMetrics.height = dispH;
  displayMetrics.scale = scale;

  // 3. Render rotated image to display canvas
  if (sourceCanvasRef.value) {
    sourceCanvasRef.value.width = dispW;
    sourceCanvasRef.value.height = dispH;
    const ctx = sourceCanvasRef.value.getContext('2d');
    ctx.clearRect(0, 0, dispW, dispH);
    ctx.drawImage(currentRotatedCanvas, 0, 0, dispW, dispH);
  }

  // 4. Set initial crop rect (90% centered)
  resetCropRect();
}

function resetCropRect() {
  const insetX = Math.round(displayMetrics.width * 0.05);
  const insetY = Math.round(displayMetrics.height * 0.05);

  cropRect.x = displayMetrics.left + insetX;
  cropRect.y = displayMetrics.top + insetY;
  cropRect.width = displayMetrics.width - insetX * 2;
  cropRect.height = displayMetrics.height - insetY * 2;
}

function rotateClockwise() {
  rotation.value = (rotation.value + 90) % 360;
  initCropWorkspace();
}

// Drag & Resize Handlers
function startDrag(e, type) {
  dragState.active = true;
  dragState.type = type;
  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.initCropX = cropRect.x;
  dragState.initCropY = cropRect.y;
  dragState.initCropW = cropRect.width;
  dragState.initCropH = cropRect.height;
}

function onGlobalPointerMove(e) {
  if (!dragState.active) return;

  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  const minSize = 60;

  const minX = displayMetrics.left;
  const maxX = displayMetrics.left + displayMetrics.width;
  const minY = displayMetrics.top;
  const maxY = displayMetrics.top + displayMetrics.height;

  if (dragState.type === 'move') {
    let nextX = dragState.initCropX + dx;
    let nextY = dragState.initCropY + dy;

    nextX = Math.max(minX, Math.min(nextX, maxX - cropRect.width));
    nextY = Math.max(minY, Math.min(nextY, maxY - cropRect.height));

    cropRect.x = nextX;
    cropRect.y = nextY;
  } else if (dragState.type === 'br') {
    let nextW = Math.max(minSize, Math.min(dragState.initCropW + dx, maxX - dragState.initCropX));
    let nextH = Math.max(minSize, Math.min(dragState.initCropH + dy, maxY - dragState.initCropY));
    cropRect.width = nextW;
    cropRect.height = nextH;
  } else if (dragState.type === 'tl') {
    let nextX = Math.max(minX, Math.min(dragState.initCropX + dx, dragState.initCropX + dragState.initCropW - minSize));
    let nextY = Math.max(minY, Math.min(dragState.initCropY + dy, dragState.initCropY + dragState.initCropH - minSize));
    cropRect.width = dragState.initCropW - (nextX - dragState.initCropX);
    cropRect.height = dragState.initCropH - (nextY - dragState.initCropY);
    cropRect.x = nextX;
    cropRect.y = nextY;
  } else if (dragState.type === 'tr') {
    let nextW = Math.max(minSize, Math.min(dragState.initCropW + dx, maxX - dragState.initCropX));
    let nextY = Math.max(minY, Math.min(dragState.initCropY + dy, dragState.initCropY + dragState.initCropH - minSize));
    cropRect.width = nextW;
    cropRect.height = dragState.initCropH - (nextY - dragState.initCropY);
    cropRect.y = nextY;
  } else if (dragState.type === 'bl') {
    let nextX = Math.max(minX, Math.min(dragState.initCropX + dx, dragState.initCropX + dragState.initCropW - minSize));
    let nextH = Math.max(minSize, Math.min(dragState.initCropH + dy, maxY - dragState.initCropY));
    cropRect.width = dragState.initCropW - (nextX - dragState.initCropX);
    cropRect.height = nextH;
    cropRect.x = nextX;
  } else if (dragState.type === 't') {
    let nextY = Math.max(minY, Math.min(dragState.initCropY + dy, dragState.initCropY + dragState.initCropH - minSize));
    cropRect.height = dragState.initCropH - (nextY - dragState.initCropY);
    cropRect.y = nextY;
  } else if (dragState.type === 'b') {
    cropRect.height = Math.max(minSize, Math.min(dragState.initCropH + dy, maxY - dragState.initCropY));
  } else if (dragState.type === 'l') {
    let nextX = Math.max(minX, Math.min(dragState.initCropX + dx, dragState.initCropX + dragState.initCropW - minSize));
    cropRect.width = dragState.initCropW - (nextX - dragState.initCropX);
    cropRect.x = nextX;
  } else if (dragState.type === 'r') {
    cropRect.width = Math.max(minSize, Math.min(dragState.initCropW + dx, maxX - dragState.initCropX));
  }
}

function onGlobalPointerUp() {
  dragState.active = false;
  dragState.type = null;
}

// Proceed to Filter Step
async function proceedToFilter() {
  if (!currentRotatedCanvas) return;

  // Convert display crop rect to natural rotated canvas coordinates
  const scale = displayMetrics.scale;
  const rawX = Math.round((cropRect.x - displayMetrics.left) / scale);
  const rawY = Math.round((cropRect.y - displayMetrics.top) / scale);
  const rawW = Math.round(cropRect.width / scale);
  const rawH = Math.round(cropRect.height / scale);

  baseCroppedCanvas = cropCanvasRegion(currentRotatedCanvas, {
    x: rawX,
    y: rawY,
    width: rawW,
    height: rawH
  });

  step.value = 'filter';
  activeFilter.value = 'enhanced'; // Default recommended filter
  await renderFilterPreview();
}

async function switchFilter(mode) {
  if (activeFilter.value === mode) return;
  activeFilter.value = mode;
  await renderFilterPreview();
}

async function renderFilterPreview() {
  if (!baseCroppedCanvas) return;
  filterProcessing.value = true;
  try {
    const processedCanvas = processCanvasWithFilter(baseCroppedCanvas, activeFilter.value);
    const result = await compressCanvas(processedCanvas);
    compressionResult.value = result;
    processedPreviewUrl.value = result.dataUrl;
  } catch (err) {
    console.error('Filter processing error:', err);
  } finally {
    filterProcessing.value = false;
  }
}

function formatFileSize(bytes) {
  if (!bytes) return '约 200 KB';
  const kb = bytes / 1024;
  return `${kb.toFixed(1)} KB`;
}

// Save Mistake Record
async function saveMistakeRecord() {
  if (!formDescription.value.trim() || !compressionResult.value) return;

  saving.value = true;
  try {
    const { file, dataUrl } = compressionResult.value;

    const newMistake = await api.createMistake({
      child_id: props.childId,
      subject: formSubject.value,
      description: formDescription.value.trim(),
      photo_file: file,
      photo_data_url: dataUrl
    });

    playCameraShutter();
    emit('saved', newMistake);
  } catch (err) {
    console.error('Failed to save mistake:', err);
    alert('保存错题失败，请重试');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
@keyframes popIn {
  0% {
    opacity: 0;
    transform: scale(0.96) translateY(6px);
  }
  100% {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.animate-pop-in {
  animation: popIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
</style>
