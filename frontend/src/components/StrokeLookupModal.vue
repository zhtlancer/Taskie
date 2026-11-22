<template>
  <UiDialog v-if="isOpen" :busy="isSubmitting" :title="unified ? '查字 / 查词' : '实时查笔画'" wide @close="close">
    <template #subtitle>{{ unified ? '输入后点查询，自动识别汉字或英文；可看笔顺、查释义、听发音并收录。' : '输入汉字或词语，查看书写动画，并加入生字生词本' }}</template>
    <div class="flex flex-col items-center min-w-0">
        <!-- 1. Input Section (Large iPad friendly touch input) -->
        <div class="w-full max-w-md mb-4">
          <div class="relative flex items-center">
            <input
              :aria-label="unified ? '汉字或英文' : '汉字或词语'"
              ref="charInputRef"
              autofocus
              :disabled="isSubmitting"
              v-model="inputRaw"
              type="text"
              :maxlength="unified ? 100 : 20"
              :placeholder="unified ? '输入汉字或英文，如 春天 / apple' : '输入汉字或词语（如：学、春天）'"
              autocapitalize="off"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              class="w-full h-14 pl-5 pr-14 rounded-2xl bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900 text-xl font-black text-slate-800 dark:text-slate-100 placeholder:text-slate-300 placeholder:font-normal outline-none transition-all shadow-inner"
              @input="onInputChanged"
              @compositionstart="composing = true"
              @compositionend="finishComposition"
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
          <div v-if="unified" class="flex flex-wrap items-center justify-between gap-2 mt-2">
            <p class="text-xs text-slate-500 dark:text-slate-400">{{ detectedLanguage === 'en' ? '已识别英文，点击查询查看释义和发音。' : detectedLanguage === 'zh' ? '已识别汉字，可查看笔顺并收录。' : '支持汉字、英文单词和短语。' }}</p>
            <button type="button" :disabled="isSubmitting || composing || !inputRaw.trim()" class="ui-button-primary min-h-11" @click="onInputConfirm">查询</button>
          </div>
          <p v-if="queryError" role="alert" class="mt-2 text-sm text-amber-700 dark:text-amber-300">{{ queryError }}</p>

          <!-- Quick Suggestion Character Pills for phone and tablet -->
          <div class="flex flex-wrap items-center gap-1.5 mt-2">
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
        <div v-if="!unified || entry" class="flex flex-wrap items-center justify-center gap-2 sm:gap-3 w-full max-w-md mb-4 bg-slate-50 dark:bg-slate-800 p-3 rounded-2xl border border-slate-100 dark:border-slate-700 min-w-0">
          <!-- Pinyin & Listen -->
          <div class="flex flex-wrap items-center justify-center gap-2 max-w-full min-w-0">
            <span class="text-xs font-bold text-slate-400 shrink-0">拼音:</span>
            <span class="text-lg font-black text-brand-600 dark:text-brand-300 tracking-wider break-words [overflow-wrap:anywhere] text-center">{{ pinyinText }}</span>
            <button
              type="button"
              @click="onSpeak"
              class="w-11 h-11 shrink-0 rounded-full bg-brand-500 text-white flex items-center justify-center text-xs shadow-xs active:scale-90 transition-all ml-0.5"
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

        <!-- 3. Ultra-large Mi-Zi-Ge Hanzi Writer -->
        <HanziGrid
          v-if="currentChar"
          :key="`${selectedIndex}-${currentChar}-${gridSize}`"
          :character="currentChar"
          :size="gridSize"
          grid-type="mi"
          :auto-play="true"
          @ready="onGridReady"
        />
        <div v-else class="w-[256px] sm:w-[300px] max-w-full aspect-square rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center text-sm font-bold text-slate-400">
          {{ unified && detectedLanguage === 'en' ? '点击查询，查看单词释义与发音' : '请输入汉字或词语' }}
        </div>

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
          <WordBookSelect v-if="!isAlreadyInBook && entry" v-model="selectedBook" class="w-full mb-3" :child-id="childId" language="zh" :disabled="isSubmitting" />
          <button
            v-if="!isAlreadyInBook"
            type="button"
            @click="onAddToBook"
            :disabled="isSubmitting || !entry"
            class="w-full min-h-14 py-2 px-4 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 hover:from-amber-500 hover:to-orange-500 text-white font-black text-base shadow-yellow-button active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span class="text-xl">{{ isSubmitting ? '⏳' : '⭐' }}</span>
            <span>{{ isSubmitting ? '正在加入…' : '加入生字生词本' }}</span>
            <span v-if="!isSubmitting" class="hidden sm:inline text-xs opacity-90">（入本后可随时复习打卡）</span>
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
import WordBookSelect from './WordBookSelect.vue';
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import HanziGrid from './HanziGrid.vue';
import { getCharPinyin, getCharRadical, getCharStrokes, speakHanzi } from '../utils/hanzi';
import { useCharacterStore } from '../stores/character';
import { playClick } from '../utils/sound';
import { CATEGORIES, cleanEntry, entryChars } from '../utils/wordBook';
import { loadLearningFont } from '../utils/learningFont';
import { getToken } from '../utils/session.js';
import { lookupQuery } from '../utils/lookupQuery.js';

const props = defineProps({
  unified: Boolean,
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

const emit = defineEmits(['update:modelValue', 'added', 'switch-query']);

const characterStore = useCharacterStore();
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 390);
const gridSize = computed(() => (viewportWidth.value < 380 ? 256 : 300));
const syncWidth = () => { viewportWidth.value = window.innerWidth; };

const isOpen = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const charInputRef = ref(null);
const inputRaw = ref(props.initialChar);
const selectedBook = ref('');
// The entry is what gets added: the Chinese characters typed, a character or a word.
const entry = ref(cleanEntry(props.initialChar));
const composing = ref(false), queryError = ref('');
const detectedLanguage = computed(() => composing.value ? '' : lookupQuery(inputRaw.value).language);
const selectedIndex = ref(0);
const dynamicStrokes = ref(null);
const isSubmitting = ref(false);
const toastMessage = ref('');
const toastError = ref(false);
const newCategories = ref([]);

let toastTimer = null;
let alive = true, submitSerial = 0;
function clearToast() {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  toastMessage.value = '';
  toastError.value = false;
}

function invalidateSubmission() {
  submitSerial++;
  isSubmitting.value = false;
  clearToast();
}

function handleScopeChange() {
  invalidateSubmission();
  newCategories.value = [];
  characterStore.clear(props.childId || null);
  if (isOpen.value && props.childId) characterStore.ensureChildLoaded(props.childId);
}

onMounted(() => {
  window.addEventListener('resize', syncWidth);
  window.addEventListener('taskie:data-restored', handleScopeChange);
  window.addEventListener('taskie:session-changed', handleScopeChange);
});
onBeforeUnmount(() => {
  alive = false;
  invalidateSubmission();
  window.removeEventListener('resize', syncWidth);
  window.removeEventListener('taskie:data-restored', handleScopeChange);
  window.removeEventListener('taskie:session-changed', handleScopeChange);
});

watch([isOpen, () => props.childId], ([open, id], [, prevId]) => {
  selectedBook.value = '';
  if (id !== prevId) {
    invalidateSubmission();
    newCategories.value = [];
    characterStore.setChild(id);
  }
  if (!open) invalidateSubmission();
  if (open) {
    loadLearningFont();
    clearToast();
    if (id) characterStore.ensureChildLoaded(id);
    nextTick(() => {
      if (charInputRef.value) charInputRef.value.focus();
    });
  }
}, { immediate: true, flush: 'sync' });

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
  return characterStore.isCharInBook(entry.value, props.childId);
});

// Typing shows the latest character's strokes, as before; the whole entry is what gets added.
function onInputChanged() {
  if (composing.value) return;
  const result = props.unified ? lookupQuery(inputRaw.value) : null;
  const clean = result ? (result.language === 'zh' ? result.text : '') : cleanEntry(inputRaw.value);
  entry.value = clean;
  selectedIndex.value = Math.max(0, entryChars(clean).length - 1);
  dynamicStrokes.value = null;
  clearToast();
  queryError.value = '';
}

function finishComposition() { composing.value = false; onInputChanged(); }

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

function onInputConfirm(event) {
  if (isSubmitting.value || composing.value || event?.isComposing || event?.keyCode === 229) return;
  event?.preventDefault?.();
  if (props.unified) {
    const result = lookupQuery(inputRaw.value);
    if (result.error) { queryError.value = result.error; return; }
    if (result.language === 'en') { emit('switch-query', result); return; }
  }
  onInputChanged();
}

function selectChar(text) {
  if (isSubmitting.value) return;
  playClick();
  inputRaw.value = text;
  queryError.value = '';
  entry.value = text;
  selectedIndex.value = 0;
  dynamicStrokes.value = null;
}

function clearInput() {
  if (isSubmitting.value) return;
  playClick();
  inputRaw.value = '';
  onInputChanged();
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

  clearToast();
  isSubmitting.value = true;
  const single = chars.value.length === 1;
  const targetEntry = entry.value;
  const request = ++submitSerial, targetChild = props.childId, token = getToken(), generation = characterStore.scopeGeneration;
  const matches = () => alive && request === submitSerial && isOpen.value && props.childId === targetChild &&
    token === getToken() && generation === characterStore.scopeGeneration;

  try {
    const res = await characterStore.addCharacter({
      child_id: targetChild,
      char: targetEntry,
      pinyin: pinyinText.value,
      strokes: single && strokesCount.value !== '—' ? Number(strokesCount.value) : null,
      radical: single ? radicalInfo.value.radical : null,
      categories: newCategories.value,
      ...(selectedBook.value ? { book_id: selectedBook.value } : {}),
    });

    if (!matches()) return;
    toastMessage.value = res.alreadyExists
      ? `✅ 「${targetEntry}」已在生字生词本`
      : `🌟 成功将「${targetEntry}」加入生字生词本！`;
    newCategories.value = [];
    toastTimer = setTimeout(() => {
      toastMessage.value = '';
      toastTimer = null;
    }, 2500);
    if (res.character) emit('added', res.character);
  } catch (err) {
    if (!matches()) return;
    console.error('Add to book error:', err);
    toastError.value = true;
    toastMessage.value = typeof err === 'string' ? err : err.message || '加入失败，请重试';
  } finally {
    if (matches()) isSubmitting.value = false;
  }
}

function close() {
  if (isSubmitting.value) return;
  playClick();
  isOpen.value = false;
}
</script>
