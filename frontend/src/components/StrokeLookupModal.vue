<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm select-none"
    @click.self="close"
  >
    <div
      class="bg-white rounded-3xl w-full max-w-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh] animate-pop-in"
      role="dialog"
      aria-modal="true"
    >
      <!-- Modal Header -->
      <header class="px-6 py-4 bg-gradient-to-r from-brand-50 to-indigo-50/60 border-b border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-2xl bg-brand-500 text-white flex items-center justify-center text-2xl shadow-button font-black">
            🔍
          </div>
          <div>
            <h2 class="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <span>实时查笔画</span>
              <span class="text-xs font-bold text-brand-600 bg-brand-100/70 px-2 py-0.5 rounded-full">动画演示</span>
            </h2>
            <p class="text-xs font-bold text-slate-400">
              输入任意汉字，实时看矢量书写动画与总笔画，一键加入生字本
            </p>
          </div>
        </div>

        <button
          type="button"
          @click="close"
          class="w-10 h-10 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xl font-bold transition-all active:scale-90 shadow-xs"
          title="关闭"
        >
          ✕
        </button>
      </header>

      <!-- Modal Body -->
      <div class="p-6 overflow-y-auto flex flex-col items-center">
        <!-- 1. Input Section (Large iPad friendly touch input) -->
        <div class="w-full max-w-md mb-4">
          <div class="relative flex items-center">
            <input
              ref="charInputRef"
              v-model="inputRaw"
              type="text"
              maxlength="10"
              placeholder="输入任意汉字（如：学、春、写）"
              class="w-full h-14 pl-5 pr-14 rounded-2xl bg-slate-50 border-2 border-slate-200 focus:border-brand-500 focus:bg-white text-xl font-black text-slate-800 placeholder:text-slate-300 placeholder:font-normal outline-none transition-all shadow-inner"
              @input="onInputChanged"
              @keydown.enter="onInputConfirm"
            />
            <button
              v-if="inputRaw"
              type="button"
              @click="clearInput"
              class="absolute right-4 w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold active:scale-90"
              title="清空"
            >
              ✕
            </button>
          </div>

          <!-- Quick Suggestion Character Pills for iPad -->
          <div class="flex items-center gap-1.5 mt-2 overflow-x-auto pb-1 no-scrollbar">
            <span class="text-xs font-bold text-slate-400 shrink-0">快捷试查:</span>
            <button
              v-for="s in quickChars"
              :key="s"
              type="button"
              @click="selectChar(s)"
              class="px-2.5 py-1 rounded-xl text-xs font-black transition-all active:scale-95 shrink-0"
              :class="currentChar === s ? 'bg-brand-500 text-white shadow-button' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <!-- 2. Character Metadata Strip (Pinyin with sound, Radical, Strokes) -->
        <div class="flex flex-wrap items-center justify-center gap-3 w-full max-w-md mb-4 bg-slate-50 p-3 rounded-2xl border border-slate-100">
          <!-- Pinyin & Listen -->
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-400">拼音:</span>
            <span class="text-lg font-black text-brand-600 tracking-wider">{{ pinyinText }}</span>
            <button
              type="button"
              @click="onSpeak"
              class="w-7 h-7 rounded-full bg-brand-500 text-white flex items-center justify-center text-xs shadow-xs active:scale-90 transition-all ml-0.5"
              title="听发音"
            >
              🔊
            </button>
          </div>

          <span class="text-slate-200 font-bold">|</span>

          <!-- Radical -->
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-slate-400">部首:</span>
            <span class="text-sm font-black text-slate-700 font-reading">{{ radicalInfo.radical }}</span>
          </div>

          <span class="text-slate-200 font-bold">|</span>

          <!-- Strokes Count -->
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-slate-400">总笔画:</span>
            <span class="text-sm font-black text-slate-700">{{ strokesCount }} 画</span>
          </div>

          <span class="text-slate-200 font-bold">|</span>

          <!-- Structure -->
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-slate-400">结构:</span>
            <span class="text-xs font-bold text-slate-600">{{ radicalInfo.struct }}</span>
          </div>
        </div>

        <!-- 3. Ultra-large Mi-Zi-Ge Hanzi Writer (Size 300px for iPad touch) -->
        <HanziGrid
          :key="currentChar"
          :character="currentChar"
          :size="300"
          grid-type="mi"
          :auto-play="true"
          @ready="onGridReady"
        />

        <!-- 4. Core Action Button: ⭐ 加入生字本 / ✅ 已在生字本 -->
        <div class="w-full max-w-md mt-6 pt-3 border-t border-slate-100 flex flex-col items-center">
          <!-- Add to Character Book Button -->
          <button
            v-if="!isAlreadyInBook"
            type="button"
            @click="onAddToBook"
            :disabled="isSubmitting"
            class="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-500 hover:to-orange-500 text-white font-black text-base shadow-yellow-button active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span class="text-xl">⭐</span>
            <span>加入生字本</span>
            <span class="text-xs opacity-90">（入本后可随时复习打卡）</span>
          </button>

          <!-- Already in Book Button -->
          <div
            v-else
            class="w-full h-14 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-emerald-700 font-black text-base flex items-center justify-center gap-2 shadow-xs"
          >
            <span class="text-xl">✅</span>
            <span>已在生字本</span>
            <span class="text-xs font-bold text-emerald-600">（随时可以在生字本中临摹复习）</span>
          </div>

          <p v-if="toastMessage" class="mt-2 text-xs font-bold text-emerald-600 animate-pop-in">
            {{ toastMessage }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import HanziGrid from './HanziGrid.vue';
import { getCharPinyin, getCharRadical, getCharStrokes, speakHanzi } from '../utils/hanzi';
import { useCharacterStore } from '../stores/character';
import { playClick } from '../utils/sound';

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
  childId: {
    type: String,
    required: true,
  },
  initialChar: {
    type: String,
    default: '学',
  },
});

const emit = defineEmits(['update:modelValue', 'added']);

const characterStore = useCharacterStore();

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const charInputRef = ref(null);
const inputRaw = ref(props.initialChar || '学');
const currentChar = ref((props.initialChar || '学').trim()[0] || '学');
const dynamicStrokes = ref(null);
const isSubmitting = ref(false);
const toastMessage = ref('');

const quickChars = ['学', '春', '写', '生', '书', '画', '笔', '语', '数', '爱', '天', '好'];

const pinyinText = computed(() => {
  return getCharPinyin(currentChar.value) || '—';
});

const radicalInfo = computed(() => {
  return getCharRadical(currentChar.value);
});

const strokesCount = computed(() => {
  if (dynamicStrokes.value) return dynamicStrokes.value;
  return getCharStrokes(currentChar.value) || '—';
});

const isAlreadyInBook = computed(() => {
  return characterStore.isCharInBook(currentChar.value);
});

function onInputChanged() {
  const clean = (inputRaw.value || '').trim();
  if (clean) {
    currentChar.value = clean[clean.length - 1]; // Take the latest inputted character
    dynamicStrokes.value = null;
  }
}

function onInputConfirm() {
  onInputChanged();
}

function selectChar(char) {
  playClick();
  inputRaw.value = char;
  currentChar.value = char;
  dynamicStrokes.value = null;
}

function clearInput() {
  playClick();
  inputRaw.value = '';
  if (charInputRef.value) charInputRef.value.focus();
}

function onSpeak() {
  playClick();
  speakHanzi(currentChar.value);
}

function onGridReady(data) {
  if (data && data.strokes) {
    dynamicStrokes.value = data.strokes;
  }
}

async function onAddToBook() {
  playClick();
  if (!currentChar.value || isSubmitting.value) return;

  isSubmitting.value = true;
  toastMessage.value = '';

  try {
    const res = await characterStore.addCharacter({
      child_id: props.childId,
      char: currentChar.value,
      pinyin: pinyinText.value,
      strokes: strokesCount.value === '—' ? 0 : Number(strokesCount.value),
      radical: radicalInfo.value.radical,
    });

    toastMessage.value = `🌟 成功将「${currentChar.value}」加入生字本！`;
    emit('added', res.character);
    setTimeout(() => {
      toastMessage.value = '';
    }, 2500);
  } catch (err) {
    console.error('Add to book error:', err);
    toastMessage.value = err.message || '加入失败';
  } finally {
    isSubmitting.value = false;
  }
}

function close() {
  playClick();
  isOpen.value = false;
}

watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      nextTick(() => {
        if (charInputRef.value) {
          charInputRef.value.focus();
        }
      });
    }
  }
);
</script>
