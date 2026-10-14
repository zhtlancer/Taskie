<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm select-none"
    @click.self="close"
  >
    <div
      class="bg-white rounded-3xl w-full max-w-xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[92vh] animate-pop-in"
      role="dialog"
      aria-modal="true"
    >
      <!-- Modal Header -->
      <header class="px-6 py-4 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-brand-100 text-brand-600 flex items-center justify-center text-xl shadow-xs font-black">
            📖
          </div>
          <div>
            <h3 class="text-lg font-black text-slate-800 leading-tight">{{ chars.length > 1 ? '生词笔顺与临摹' : '生字笔顺与临摹' }}</h3>
            <p class="text-xs font-bold text-slate-400">{{ chars.length > 1 ? '点下面的字看它的笔顺，临摹可在田字格上手写跟笔' : '点击临摹可在田字格上手写跟笔' }}</p>
          </div>
        </div>

        <button
          type="button"
          @click="close"
          class="w-10 h-10 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xl font-bold transition-all active:scale-90"
          title="关闭弹窗"
        >
          ✕
        </button>
      </header>

      <!-- Modal Body -->
      <div class="p-6 overflow-y-auto flex flex-col items-center">
        <!-- Top Info Strip: Pinyin & Sound -->
        <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mb-4 whitespace-nowrap">
          <!-- Pinyin with Mask Toggle (Default Hidden) -->
          <div class="flex items-center gap-2">
            <div
              v-if="showPinyin"
              class="px-4 py-1.5 rounded-2xl bg-brand-50 border border-brand-200 text-brand-700 font-black text-xl tracking-wider animate-pop-in"
            >
              {{ pinyinText }}
            </div>
            <div
              v-else
              class="px-4 py-1.5 rounded-2xl bg-slate-100 border border-dashed border-slate-300 text-slate-400 font-bold text-sm"
            >
              🙈 拼音已隐藏
            </div>

            <!-- Toggle Pinyin Button -->
            <button
              type="button"
              @click="togglePinyin"
              class="h-9 px-3 rounded-xl border font-bold text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1"
              :class="showPinyin ? 'bg-brand-500 text-white border-brand-500 shadow-button' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'"
            >
              <span>{{ showPinyin ? '👁️ 隐藏拼音' : '👁️ 显示拼音' }}</span>
            </button>
          </div>

          <!-- Speak Audio Button -->
          <button
            type="button"
            @click="onSpeak"
            class="h-9 px-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-xs active:scale-95 transition-all flex items-center gap-1.5"
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
          <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-center">
            <span class="text-[11px] font-bold text-slate-400 block mb-0.5">{{ chars.length > 1 ? `「${currentChar}」` : '' }}部首</span>
            <span class="text-base font-black text-slate-700 font-reading">{{ radicalInfo.radical }}</span>
          </div>

          <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-center">
            <span class="text-[11px] font-bold text-slate-400 block mb-0.5">{{ chars.length > 1 ? `「${currentChar}」` : '' }}总笔画</span>
            <span class="text-base font-black text-slate-700">{{ strokesCount }} 画</span>
          </div>

          <div class="bg-slate-50 rounded-2xl p-3 border border-slate-100 text-center">
            <span class="text-[11px] font-bold text-slate-400 block mb-0.5">{{ chars.length > 1 ? `「${currentChar}」` : '' }}汉字结构</span>
            <span class="text-base font-black text-slate-700 text-xs">{{ radicalInfo.struct || '独体结构' }}</span>
          </div>
        </div>

        <!-- Categories: anyone may add one; only parents take one away -->
        <div class="w-full max-w-md mt-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-black text-slate-500">分类</span>
            <span class="text-[11px] font-bold text-slate-400">{{ role === 'parent' ? '点一下添加或去掉' : '可以添加，去掉需要家长' }}</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="category in CATEGORIES"
              :key="category.key"
              type="button"
              :disabled="savingCategories"
              @click="onToggleCategory(category.key)"
              class="h-10 rounded-xl border text-xs font-black transition-all active:scale-95 flex items-center justify-center gap-1"
              :class="character.categories?.includes(category.key) ? category.chip : 'bg-white text-slate-400 border-dashed border-slate-300'"
              :aria-pressed="character.categories?.includes(category.key) ? 'true' : 'false'"
            >
              <span>{{ category.icon }}</span>
              <span>{{ category.label }}</span>
            </button>
          </div>
          <p v-if="categoryMessage" class="mt-2 text-xs font-bold text-rose-500">{{ categoryMessage }}</p>
        </div>

        <!-- Mastery Action Button -->
        <div class="flex items-center justify-between w-full max-w-md mt-6 pt-4 border-t border-slate-100">
          <button
            type="button"
            @click="onToggleMaster"
            class="flex-1 h-12 rounded-2xl font-black text-sm transition-all shadow-sm active:scale-98 flex items-center justify-center gap-2 mr-3"
            :class="[
              character.is_mastered
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100'
                : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-button'
            ]"
          >
            <span>{{ character.is_mastered ? '✅ 已掌握（点击改为学习中）' : '⭐ 标记为已掌握' }}</span>
          </button>

          <!-- Delete from the book; a categorized entry needs a parent, as removing it drops its categories -->
          <button
            type="button"
            @click="onDelete"
            :disabled="!canDelete"
            class="h-12 px-4 rounded-2xl bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 font-bold text-xs transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            :title="canDelete ? '从生字生词本移出' : '有分类标记，需要家长移出'"
          >
            移出
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import HanziGrid from './HanziGrid.vue';
import { getCharPinyin, getCharRadical, getCharStrokes, speakHanzi } from '../utils/hanzi';
import { playClick } from '../utils/sound';
import { currentRole } from '../utils/session.js';
import { CATEGORIES, categoryInfo, entryChars, toggleCategory } from '../utils/wordBook';
import { useCharacterStore } from '../stores/character';

const props = defineProps({
  character: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close', 'toggle-master', 'delete', 'updated']);

const characterStore = useCharacterStore();
const role = currentRole();
const showPinyin = ref(false); // Default hidden
const dynamicStrokes = ref(null);
const selectedIndex = ref(0);
const savingCategories = ref(false);
const categoryMessage = ref('');

const chars = computed(() => entryChars(props.character.char));
const currentChar = computed(() => chars.value[selectedIndex.value] || chars.value[0]);
const canDelete = computed(() => role === 'parent' || !props.character.categories?.length);

function selectChar(index) {
  playClick();
  selectedIndex.value = index;
  dynamicStrokes.value = null;
}

async function onToggleCategory(key) {
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
  playClick();
  emit('toggle-master', props.character.id);
}

function onDelete() {
  playClick();
  if (!canDelete.value) return;
  if (window.confirm(`确定要将「${props.character.char}」从生字生词本移出吗？`)) {
    emit('delete', props.character.id);
  }
}

function close() {
  playClick();
  emit('close');
}
</script>
