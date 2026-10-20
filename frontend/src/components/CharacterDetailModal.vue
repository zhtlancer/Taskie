<template>
  <UiDialog :busy="busy" :title="chars.length > 1 ? '生词笔顺与临摹' : '生字笔顺与临摹'" wide @close="close">
    <template #subtitle>选择汉字查看笔顺，可在田字格上临摹跟笔</template>
    <div class="flex flex-col items-center min-w-0">
        <p v-if="error" role="alert" class="mb-3 text-sm text-rose-600 dark:text-rose-300">{{ error }}</p>
        <!-- Top Info Strip: Pinyin & Sound -->
        <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-4 whitespace-nowrap">
          <!-- Pinyin with Mask Toggle (Default Hidden) -->
          <div class="flex items-center gap-2">
            <div
              v-if="showPinyin"
              class="px-4 py-1.5 rounded-2xl bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-800 text-brand-700 dark:text-brand-300 font-black text-xl tracking-wider animate-pop-in"
            >
              {{ pinyinText }}
            </div>
            <div
              v-else
              class="px-4 py-1.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 font-bold text-sm"
            >
              🙈 拼音已隐藏
            </div>

            <!-- Toggle Pinyin Button -->
            <button
              type="button"
              @click="togglePinyin"
              class="min-h-[44px] px-3 rounded-xl border font-bold text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1"
              :class="showPinyin ? 'bg-brand-500 text-white border-brand-500 shadow-button' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'"
            >
              <span>{{ showPinyin ? '👁️ 隐藏拼音' : '👁️ 显示拼音' }}</span>
            </button>
          </div>

          <!-- Speak Audio Button -->
          <button
            type="button"
            @click="onSpeak"
            class="min-h-[44px] px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5"
            title="朗读汉字发音"
          >
            <span class="text-base">🔊</span>
            <span>读音</span>
          </button>
        </div>

        <!-- A word: pick which character to animate -->
        <div v-if="chars.length > 1" class="flex flex-wrap justify-center gap-2 mb-4">
          <button
            v-for="(ch, index) in chars"
            :key="index"
            type="button"
            @click="selectChar(index)"
            class="w-12 h-12 rounded-xl border-2 font-kai text-2xl transition-all active:scale-95"
            :class="index === selectedIndex ? 'bg-brand-500 border-brand-500 text-white shadow-button' : 'bg-[#FFFDF9] border-red-300/80 text-slate-800'"
          >
            {{ ch }}
          </button>
        </div>

        <!-- Big Hanzi Grid with HanziWriter (Size 280 for iPad touch) -->
        <HanziGrid
          :key="`${selectedIndex}-${currentChar}`"
          :character="currentChar"
          :size="280"
          grid-type="mi"
          :auto-play="true"
          @ready="onGridReady"
        />

        <!-- Character Details Cards -->
        <div class="grid grid-cols-3 gap-3 w-full max-w-md mt-5">
          <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
            <span class="text-xs font-bold text-slate-400 block mb-0.5">{{ chars.length > 1 ? `「${currentChar}」` : '' }}部首</span>
            <span class="text-base font-black text-slate-700 dark:text-slate-200 font-reading">{{ radicalInfo.radical }}</span>
          </div>

          <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
            <span class="text-xs font-bold text-slate-400 block mb-0.5">{{ chars.length > 1 ? `「${currentChar}」` : '' }}总笔画</span>
            <span class="text-base font-black text-slate-700 dark:text-slate-200">{{ strokesCount }} 画</span>
          </div>

          <div class="bg-slate-50 dark:bg-slate-800 rounded-2xl p-3 border border-slate-100 dark:border-slate-700 text-center">
            <span class="text-xs font-bold text-slate-400 block mb-0.5">{{ chars.length > 1 ? `「${currentChar}」` : '' }}汉字结构</span>
            <span class="text-base font-black text-slate-700 dark:text-slate-200 text-xs">{{ radicalInfo.struct || '独体结构' }}</span>
          </div>
        </div>

        <!-- Categories: anyone may add one; only parents take one away -->
        <div class="w-full max-w-md mt-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-black text-slate-500 dark:text-slate-400">分类</span>
            <span class="text-xs font-bold text-slate-400">{{ role === 'parent' ? '点一下添加或去掉' : '可以添加，去掉需要家长' }}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="category in CATEGORIES"
              :key="category.key"
              type="button"
              :disabled="busy"
              @click="onToggleCategory(category.key)"
              class="min-h-[44px] rounded-xl border text-xs font-black transition-all active:scale-95 flex items-center justify-center gap-1"
              :class="character.categories?.includes(category.key) ? category.chip : 'bg-white dark:bg-slate-900 text-slate-400 border-dashed border-slate-300 dark:border-slate-600'"
              :aria-pressed="character.categories?.includes(category.key) ? 'true' : 'false'"
            >
              <span>{{ category.icon }}</span>
              <span>{{ category.label }}</span>
            </button>
          </div>
          <p v-if="categoryMessage" role="alert" class="mt-2 text-xs font-bold text-rose-500 dark:text-rose-400">{{ categoryMessage }}</p>
        </div>

        <!-- Mastery Action Button -->
        <div class="flex items-center justify-between w-full max-w-md mt-6 pt-4 border-t border-slate-100 dark:border-slate-700">
          <button
            type="button"
            :disabled="busy"
            @click="onToggleMaster"
            class="flex-1 h-12 rounded-2xl font-black text-sm transition-all shadow-sm active:scale-98 flex items-center justify-center gap-2 mr-3"
            :class="[
              character.is_mastered
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-950/40'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-button'
            ]"
          >
            <span>{{ character.is_mastered ? '✅ 已掌握（点击改为学习中）' : '⭐ 标记为已掌握' }}</span>
          </button>

          <!-- Delete from the book; a categorized entry needs a parent, as removing it drops its categories -->
          <button
            type="button"
            @click="onDelete"
            :disabled="busy || !canDelete"
            class="h-12 px-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-950/40 font-bold text-xs transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            :title="canDelete ? '从生字生词本移出' : '有分类标记，需要家长移出'"
          >
            移出
          </button>
        </div>
      </div>
  </UiDialog>
</template>

<script setup>
import UiDialog from './UiDialog.vue';
import { confirmAction } from '../utils/confirmation';
import { ref, computed } from 'vue';
import HanziGrid from './HanziGrid.vue';
import { getCharPinyin, getCharRadical, getCharStrokes, speakHanzi } from '../utils/hanzi';
import { playClick } from '../utils/sound';
import { currentRole } from '../utils/session.js';
import { CATEGORIES, categoryInfo, entryChars, toggleCategory } from '../utils/wordBook';
import { useCharacterStore } from '../stores/character';
import { loadLearningFont } from '../utils/learningFont';

const props = defineProps({
  busy: Boolean,
  error: { type: String, default: '' },
  character: {
    type: Object,
    required: true,
  },
});
loadLearningFont();

const emit = defineEmits(['close', 'toggle-master', 'delete', 'updated']);

const characterStore = useCharacterStore();
const role = currentRole();
const showPinyin = ref(false); // Default hidden
const dynamicStrokes = ref(null);
const selectedIndex = ref(0);
const savingCategories = ref(false);
const categoryMessage = ref('');
const busy = computed(() => props.busy || savingCategories.value);

const chars = computed(() => entryChars(props.character.char));
const currentChar = computed(() => chars.value[selectedIndex.value] || chars.value[0]);
const canDelete = computed(() => role === 'parent' || !props.character.categories?.length);

function selectChar(index) {
  playClick();
  selectedIndex.value = index;
  dynamicStrokes.value = null;
}

async function onToggleCategory(key) {
  if (busy.value) return;
  playClick();
  categoryMessage.value = '';
  const { categories, blocked } = toggleCategory(props.character.categories || [], key, role);
  if (blocked) {
    categoryMessage.value = `去掉「${categoryInfo(key).label}」需要家长操作`;
    return;
  }
  savingCategories.value = true;
  try {
    emit('updated', await characterStore.setCategories(props.character.id, categories));
  } catch (err) {
    categoryMessage.value = typeof err === 'string' ? err : err.message || '保存分类失败';
  } finally {
    savingCategories.value = false;
  }
}

const pinyinText = computed(() => {
  return props.character.pinyin || getCharPinyin(props.character.char) || '—';
});

// Radical, strokes and structure describe the character shown, which for a word is the one picked.
const radicalInfo = computed(() => {
  const info = getCharRadical(currentChar.value);
  return {
    radical: (chars.value.length === 1 && props.character.radical) || info.radical,
    struct: info.struct,
  };
});

const strokesCount = computed(() => {
  if (dynamicStrokes.value) return dynamicStrokes.value;
  return (chars.value.length === 1 && props.character.strokes) || getCharStrokes(currentChar.value) || '—';
});

function togglePinyin() {
  playClick();
  showPinyin.value = !showPinyin.value;
}

function onSpeak() {
  playClick();
  speakHanzi(props.character.char);
}

function onGridReady(data) {
  if (data && data.strokes) {
    dynamicStrokes.value = data.strokes;
  }
}

function onToggleMaster() {
  if (busy.value) return;
  playClick();
  emit('toggle-master', props.character.id);
}

async function onDelete() {
  playClick();
  if (busy.value || !canDelete.value) return;
  if (await confirmAction(`确定要将「${props.character.char}」从生字生词本移出吗？`)) {
    emit('delete', props.character.id);
  }
}

function close() {
  if (busy.value) return;
  playClick();
  emit('close');
}
</script>
