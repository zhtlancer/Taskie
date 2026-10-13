<template>
  <div class="flex flex-col items-center">
    <!-- Grid Canvas Container -->
    <div
      class="relative rounded-2xl bg-white border-2 border-red-300 shadow-md overflow-hidden select-none touch-none"
      :style="{ width: `${size}px`, height: `${size}px` }"
    >
      <!-- Traditional Chinese Calligraphy Grid (米字格 / 田字格 SVG) -->
      <svg
        class="absolute inset-0 w-full h-full pointer-events-none"
        :viewBox="`0 0 ${size} ${size}`"
      >
        <!-- Center vertical line -->
        <line
          :x1="size / 2"
          y1="0"
          :x2="size / 2"
          :y2="size"
          stroke="#F87171"
          stroke-width="1.5"
          stroke-dasharray="6,4"
          opacity="0.6"
        />
        <!-- Center horizontal line -->
        <line
          x1="0"
          :y1="size / 2"
          :x2="size"
          :y2="size / 2"
          stroke="#F87171"
          stroke-width="1.5"
          stroke-dasharray="6,4"
          opacity="0.6"
        />
        <!-- Diagonal lines for 米字格 -->
        <template v-if="gridType === 'mi'">
          <line
            x1="0"
            y1="0"
            :x2="size"
            :y2="size"
            stroke="#FCA5A5"
            stroke-width="1"
            stroke-dasharray="4,4"
            opacity="0.4"
          />
          <line
            x1="0"
            :y1="size"
            :x2="size"
            y2="0"
            stroke="#FCA5A5"
            stroke-width="1"
            stroke-dasharray="4,4"
            opacity="0.4"
          />
        </template>
      </svg>

      <!-- HanziWriter Mount Target -->
      <div
        ref="writerContainer"
        class="absolute inset-0 flex items-center justify-center cursor-pointer"
        :class="{ 'pointer-events-none': currentMode === 'animate' }"
      ></div>

      <!-- Loading / Offline Indicator -->
      <div
        v-if="isLoading"
        class="absolute inset-0 bg-white/80 backdrop-blur-xs flex flex-col items-center justify-center text-slate-400 gap-2 z-10"
      >
        <div class="w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
        <span class="text-xs font-bold text-slate-500">正在生成字形笔顺...</span>
      </div>

      <!-- Quiz Status Badge Overlay -->
      <div
        v-if="currentMode === 'quiz' && !isLoading"
        class="absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full text-xs font-black bg-indigo-50 text-indigo-600 border border-indigo-200 flex items-center gap-1 shadow-xs"
      >
        <span>✍️</span>
        <span>请在格子里临摹</span>
      </div>

      <!-- Quiz Success Animation -->
      <div
        v-if="quizCompleted"
        class="absolute inset-0 bg-emerald-500/15 backdrop-blur-xs flex flex-col items-center justify-center z-20 animate-pop-in"
      >
        <div class="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center text-3xl shadow-lg mb-2">
          🎉
        </div>
        <span class="text-emerald-700 font-black text-sm bg-white/90 px-3 py-1 rounded-full shadow-xs">
          临摹太棒啦！完全正确！
        </span>
      </div>
    </div>

    <!-- Action Toolbar (Under Grid) -->
    <div v-if="showControls" class="flex flex-wrap items-center justify-center gap-2 mt-4">
      <!-- Mode Toggle: Animation vs Quiz -->
      <div class="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
        <button
          type="button"
          @click="setMode('animate')"
          class="px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1"
          :class="currentMode === 'animate' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'"
        >
          <span>🎬</span>
          <span>笔顺演示</span>
        </button>
        <button
          type="button"
          @click="setMode('quiz')"
          class="px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1"
          :class="currentMode === 'quiz' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'"
        >
          <span>✍️</span>
          <span>描红临摹</span>
        </button>
      </div>

      <!-- Animation Controls (Only when in animate mode) -->
      <template v-if="currentMode === 'animate'">
        <!-- Play / Pause Button -->
        <button
          type="button"
          @click="togglePlayPause"
          class="h-9 px-3.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-black text-xs shadow-button active:scale-95 transition-all flex items-center gap-1"
          :title="isPlaying ? '暂停书写动画' : '播放笔顺动画'"
        >
          <span>{{ isPlaying ? '⏸️ 暂停' : '▶️ 播放' }}</span>
        </button>

        <!-- Replay Button -->
        <button
          type="button"
          @click="replay"
          class="h-9 px-3 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center gap-1"
          title="重新从第一笔演示"
        >
          <span>🔄</span>
          <span>重写</span>
        </button>

        <!-- Speed Switcher -->
        <button
          type="button"
          @click="cycleSpeed"
          class="h-9 px-3 rounded-xl border font-bold text-xs shadow-sm active:scale-95 transition-all flex items-center gap-1"
          :class="isSlowSpeed ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'"
          title="切换书写速度"
        >
          <span>{{ isSlowSpeed ? '🐢 慢速 (0.5x)' : '🐇 正常 (1.0x)' }}</span>
        </button>
      </template>

      <!-- Quiz Controls (Only when in quiz mode) -->
      <template v-if="currentMode === 'quiz'">
        <button
          type="button"
          @click="restartQuiz"
          class="h-9 px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-button active:scale-95 transition-all flex items-center gap-1"
        >
          <span>🔄</span>
          <span>再描一次</span>
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import HanziWriter from 'hanzi-writer';
import { charDataLoader } from '../utils/hanzi';
import { playClick, playTaskComplete } from '../utils/sound';

const props = defineProps({
  character: {
    type: String,
    required: true,
  },
  size: {
    type: Number,
    default: 260,
  },
  gridType: {
    type: String,
    default: 'mi', // 'mi' | 'tian'
  },
  mode: {
    type: String,
    default: 'animate', // 'animate' | 'quiz' | 'static'
  },
  showControls: {
    type: Boolean,
    default: true,
  },
  autoPlay: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['ready', 'complete', 'quiz-complete', 'stroke-count']);

const writerContainer = ref(null);
const isLoading = ref(true);
const isPlaying = ref(false);
const isPaused = ref(false);
const isSlowSpeed = ref(false);
const currentMode = ref(props.mode);
const quizCompleted = ref(false);

let writerInstance = null;

function getSpeedValue() {
  return isSlowSpeed.value ? 0.5 : 1.0;
}

async function initWriter() {
  if (!writerContainer.value) return;
  const char = (props.character || '').trim()[0];
  if (!char) return;

  isLoading.value = true;
  quizCompleted.value = false;

  // Clean container
  writerContainer.value.innerHTML = '';
  if (writerInstance) {
    try {
      writerInstance.cancelQuiz();
    } catch (e) {}
    writerInstance = null;
  }

  await nextTick();

  try {
    writerInstance = HanziWriter.create(writerContainer.value, char, {
      width: props.size,
      height: props.size,
      padding: Math.round(props.size * 0.08),
      strokeAnimationSpeed: getSpeedValue(),
      delayBetweenStrokes: isSlowSpeed.value ? 350 : 180,
      strokeColor: '#1E293B', // deep slate ink
      outlineColor: '#CBD5E1', // gentle outline
      drawingColor: '#6C63FF', // child stroke color during quiz
      drawingWidth: Math.round(props.size * 0.07),
      showOutline: true,
      showCharacter: props.mode === 'static',
      highlightOnComplete: true,
      highlightColor: '#10B981',
      charDataLoader: (c, onComplete, onError) => {
        charDataLoader(c, (data) => {
          isLoading.value = false;
          if (data && data.strokes) {
            emit('stroke-count', data.strokes.length);
          }
          onComplete(data);
        }, (err) => {
          isLoading.value = false;
          if (onError) onError(err);
        });
      },
      onLoadCharDataSuccess: (data) => {
        isLoading.value = false;
        emit('ready', { strokes: data.strokes?.length || 0 });
        if (currentMode.value === 'animate' && props.autoPlay) {
          playAnimation();
        } else if (currentMode.value === 'quiz') {
          startQuiz();
        }
      },
      onLoadCharDataError: () => {
        isLoading.value = false;
      },
    });
  } catch (err) {
    console.error('[HanziGrid] Init error:', err);
    isLoading.value = false;
  }
}

function playAnimation() {
  if (!writerInstance) return;
  isPlaying.value = true;
  isPaused.value = false;
  writerInstance.animateCharacter({
    onComplete: () => {
      isPlaying.value = false;
      isPaused.value = false;
      emit('complete');
    },
  });
}

function togglePlayPause() {
  if (!writerInstance) return;
  playClick();
  if (isPlaying.value) {
    writerInstance.pauseAnimation();
    isPlaying.value = false;
    isPaused.value = true;
  } else {
    if (isPaused.value) {
      writerInstance.resumeAnimation();
      isPlaying.value = true;
      isPaused.value = false;
    } else {
      playAnimation();
    }
  }
}

function replay() {
  if (!writerInstance) return;
  playClick();
  playAnimation();
}

function cycleSpeed() {
  playClick();
  isSlowSpeed.value = !isSlowSpeed.value;
  if (writerInstance) {
    writerInstance.updateColor('strokeColor', '#1E293B');
    initWriter();
  }
}

function startQuiz() {
  if (!writerInstance) return;
  quizCompleted.value = false;
  writerInstance.quiz({
    onComplete: () => {
      quizCompleted.value = true;
      playTaskComplete();
      emit('quiz-complete');
    },
  });
}

function restartQuiz() {
  playClick();
  startQuiz();
}

function setMode(newMode) {
  playClick();
  currentMode.value = newMode;
  if (newMode === 'quiz') {
    startQuiz();
  } else {
    quizCompleted.value = false;
    if (writerInstance) {
      try {
        writerInstance.cancelQuiz();
      } catch (e) {}
    }
    playAnimation();
  }
}

watch(
  () => props.character,
  () => {
    initWriter();
  }
);

watch(
  () => props.mode,
  (val) => {
    currentMode.value = val;
    if (val === 'quiz') {
      startQuiz();
    } else if (val === 'animate') {
      playAnimation();
    }
  }
);

onMounted(() => {
  initWriter();
});

onBeforeUnmount(() => {
  if (writerInstance) {
    try {
      writerInstance.cancelQuiz();
    } catch (e) {}
    writerInstance = null;
  }
});

defineExpose({
  playAnimation,
  startQuiz,
  replay,
});
</script>
