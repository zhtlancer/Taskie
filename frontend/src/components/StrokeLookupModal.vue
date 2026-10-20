<template>
  <UiDialog v-if="isOpen" :busy="isSubmitting" :title="'实时查笔画'" wide @close="close">
    <template #subtitle>输入汉字或词语，查看书写动画，并加入生字生词本</template>
    <div class="flex flex-col items-center min-w-0">
        <!-- 1. Input Section (Large iPad friendly touch input) -->
        <div class="w-full max-w-md mb-4">
          <div class="relative flex items-center">
            <input
              aria-label="汉字或词语"
              ref="charInputRef"
              autofocus
              :disabled="isSubmitting"
              v-model="inputRaw"
              type="text"
              maxlength="20"
              placeholder="输入汉字或词语（如：学、春天）"
              class="w-full h-14 pl-5 pr-14 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900 text-xl font-black text-slate-800 dark:text-slate-100 placeholder:text-slate-300 placeholder:font-normal outline-none transition-all shadow-inner"
              @input="onInputChanged"
              @keydown.enter="onInputConfirm"
            />
            <button
              v-if="inputRaw"
              type="button"
              :disabled="isSubmitting"
              @click="clearInput"
              class="absolute right-1.5 w-11 h-11 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-500 dark:text-slate-400 flex items-center justify-center text-xs font-bold active:scale-90"
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
              :disabled="isSubmitting"
              @click="selectChar(s)"
              class="min-h-[44px] min-w-[44px] px-2.5 py-1 rounded-xl text-xs font-black transition-all active:scale-95 shrink-0"
              :class="entry === s ? 'bg-brand-500 text-white shadow-button' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'"
            >
              {{ s }}
            </button>
          </div>
        </div>

        <!-- A word: pick which character to animate -->
        <div v-if="chars.length > 1" class="flex flex-wrap justify-center gap-2 mb-3">
          <button
            v-for="(ch, index) in chars"
            :key="index"
            type="button"
            @click="pickChar(index)"
            class="w-11 h-11 rounded-xl border-2 font-kai text-2xl transition-all active:scale-95"
            :class="index === selectedIndex ? 'bg-brand-500 border-brand-500 text-white shadow-button' : 'bg-[#FFFDF9] border-red-300/80 text-slate-800'"
          >
            {{ ch }}
          </button>
        </div>

        <!-- 2. Character Metadata Strip (Pinyin with sound, Radical, Strokes) -->
        <div class="flex flex-wrap items-center justify-center gap-3 w-full max-w-md mb-4 bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-100 dark:border-slate-700">
          <!-- Pinyin & Listen -->
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-400">拼音:</span>
            <span class="text-lg font-black text-brand-600 dark:text-brand-300 tracking-wider">{{ pinyinText }}</span>
            <button
              type="button"
              @click="onSpeak"
              class="w-11 h-11 rounded-full bg-brand-500 text-white flex items-center justify-center text-xs shadow-xs active:scale-90 transition-all ml-0.5"
              title="听发音"
            >
              🔊
            </button>
          </div>

          <span class="text-slate-200 font-bold">|</span>

          <!-- Radical -->
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-slate-400">{{ charPrefix }}部首:</span>
            <span class="text-sm font-black text-slate-700 dark:text-slate-200 font-reading">{{ radicalInfo.radical }}</span>
          </div>

          <span class="text-slate-200 font-bold">|</span>

          <!-- Strokes Count -->
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-slate-400">{{ charPrefix }}总笔画:</span>
            <span class="text-sm font-black text-slate-700 dark:text-slate-200">{{ strokesCount }} 画</span>
          </div>

          <span class="text-slate-200 font-bold">|</span>

          <!-- Structure -->
          <div class="flex items-center gap-1">
            <span class="text-xs font-bold text-slate-400">{{ charPrefix }}结构:</span>
            <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{{ radicalInfo.struct }}</span>
          </div>
        </div>

        <!-- 3. Ultra-large Mi-Zi-Ge Hanzi Writer (Size 300px for iPad touch) -->
        <HanziGrid
          :key="`${selectedIndex}-${currentChar}`"
          :character="currentChar"
          :size="300"
          grid-type="mi"
          :auto-play="true"
          @ready="onGridReady"
        />

        <!-- 4. Core Action Button: ⭐ 加入生字生词本 / ✅ 已在生字生词本 -->
        <div class="w-full max-w-md mt-6 pt-3 border-t border-slate-100 dark:border-slate-700 flex flex-col items-center">
          <!-- Categories to mark the entry with when it is added -->
          <div v-if="!isAlreadyInBook && entry" class="w-full mb-3">
            <span class="text-xs font-bold text-slate-400">加入时标记（可选）:</span>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1.5">
              <button
                v-for="category in CATEGORIES"
                :key="category.key"
                type="button"
                :disabled="isSubmitting"
                @click="toggleNewCategory(category.key)"
                class="min-h-[44px] rounded-xl border text-xs font-black transition-all active:scale-95"
                :class="newCategories.includes(category.key) ? category.chip : 'bg-white dark:bg-slate-900 text-slate-400 border-dashed border-slate-300 dark:border-slate-600'"
                :aria-pressed="newCategories.includes(category.key) ? 'true' : 'false'"
              >
                {{ category.icon }} {{ category.label }}
              </button>
            </div>
          </div>
          <!-- Add to Character Book Button -->
          <button
            v-if="!isAlreadyInBook"
            type="button"
            @click="onAddToBook"
            :disabled="isSubmitting || !entry"
            class="w-full h-14 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-500 hover:to-orange-500 text-white font-black text-base shadow-yellow-button active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <span class="text-xl">⭐</span>
            <span>加入生字生词本</span>
            <span class="hidden sm:inline text-xs opacity-90">（入本后可随时复习打卡）</span>
          </button>

          <!-- Already in Book Button -->
          <div
            v-else
            class="w-full h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 font-black text-base flex items-center justify-center gap-2 shadow-xs"
          >
            <span class="text-xl">✅</span>
            <span>已在生字生词本</span>
            <span class="hidden sm:inline text-xs font-bold text-emerald-600 dark:text-emerald-300">（随时可以临摹复习）</span>
          </div>

          <p v-if="toastMessage" :role="toastError ? 'alert' : 'status'" class="mt-2 text-xs font-bold animate-pop-in" :class="toastError ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300'">
            {{ toastMessage }}
          </p>
        </div>
      </div>
  </UiDialog>
</template>

<script setup>
import UiDialog from './UiDialog.vue';
import { ref, computed, watch, nextTick } from 'vue';
import HanziGrid from './HanziGrid.vue';
import { getCharPinyin, getCharRadical, getCharStrokes, speakHanzi } from '../utils/hanzi';
import { useCharacterStore } from '../stores/character';
import { playClick } from '../utils/sound';
import { CATEGORIES, cleanEntry, entryChars } from '../utils/wordBook';
import { loadLearningFont } from '../utils/learningFont';

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
watch(isOpen, open => { if (open) loadLearningFont(); }, { immediate: true });

const charInputRef = ref(null);
const inputRaw = ref(props.initialChar || '学');
// The entry is what gets added: the Chinese characters typed, a character or a word.
const entry = ref(cleanEntry(props.initialChar) || '学');
const selectedIndex = ref(0);
const dynamicStrokes = ref(null);
const isSubmitting = ref(false);
const toastMessage = ref('');
const toastError = ref(false);
const newCategories = ref([]);

const quickChars = ['学', '春', '写', '生', '书', '画', '笔', '语', '春天', '学习', '一心一意'];

const chars = computed(() => entryChars(entry.value));
const currentChar = computed(() => chars.value[selectedIndex.value] || chars.value[0] || '');
const charPrefix = computed(() => (chars.value.length > 1 ? `「${currentChar.value}」` : ''));

const pinyinText = computed(() => {
  return getCharPinyin(entry.value) || '—';
});

const radicalInfo = computed(() => {
  return getCharRadical(currentChar.value);
});

const strokesCount = computed(() => {
  if (dynamicStrokes.value) return dynamicStrokes.value;
  return getCharStrokes(currentChar.value) || '—';
});

const isAlreadyInBook = computed(() => {
  return characterStore.isCharInBook(entry.value);
});

// Typing shows the latest character's strokes, as before; the whole entry is what gets added.
function onInputChanged() {
  const clean = cleanEntry(inputRaw.value);
  if (clean) {
    entry.value = clean;
    selectedIndex.value = entryChars(clean).length - 1;
    dynamicStrokes.value = null;
  }
}

function pickChar(index) {
  playClick();
  selectedIndex.value = index;
  dynamicStrokes.value = null;
}

function toggleNewCategory(key) {
  if (isSubmitting.value) return;
  playClick();
  newCategories.value = newCategories.value.includes(key)
    ? newCategories.value.filter(item => item !== key)
    : CATEGORIES.map(c => c.key).filter(k => k === key || newCategories.value.includes(k));
}

function onInputConfirm() {
  onInputChanged();
}

function selectChar(text) {
  if (isSubmitting.value) return;
  playClick();
  inputRaw.value = text;
  entry.value = text;
  selectedIndex.value = 0;
  dynamicStrokes.value = null;
}

function clearInput() {
  if (isSubmitting.value) return;
  playClick();
  inputRaw.value = '';
  if (charInputRef.value) charInputRef.value.focus();
}

function onSpeak() {
  playClick();
  speakHanzi(entry.value);
}

function onGridReady(data) {
  if (data && data.strokes) {
    dynamicStrokes.value = data.strokes;
  }
}

async function onAddToBook() {
  playClick();
  if (!entry.value || isSubmitting.value) return;

  isSubmitting.value = true;
  toastMessage.value = ''; toastError.value = false;
  const single = chars.value.length === 1;

  try {
    const res = await characterStore.addCharacter({
      child_id: props.childId,
      char: entry.value,
      pinyin: pinyinText.value,
      strokes: single && strokesCount.value !== '—' ? Number(strokesCount.value) : null,
      radical: single ? radicalInfo.value.radical : null,
      categories: newCategories.value,
    });

    toastMessage.value = `🌟 成功将「${entry.value}」加入生字生词本！`;
    newCategories.value = [];
    emit('added', res.character);
    setTimeout(() => {
      toastMessage.value = '';
    }, 2500);
  } catch (err) {
    console.error('Add to book error:', err);
    toastError.value = true;
    toastMessage.value = typeof err === 'string' ? err : err.message || '加入失败';
  } finally {
    isSubmitting.value = false;
  }
}

function close() {
  if (isSubmitting.value) return;
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
