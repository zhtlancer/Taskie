<template>
  <div class="min-h-screen bg-[#F4F6FB] flex flex-col justify-between p-3 pb-24 sm:p-6 lg:pb-6 select-none relative">
    <div class="max-w-6xl w-full mx-auto">
      <!-- Top Header Bar -->
      <header class="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <!-- Left: Back button & Title -->
        <div class="flex items-center gap-3">
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:flex w-12 h-12 rounded-2xl bg-white border border-slate-200 items-center justify-center text-xl text-slate-600 hover:border-brand-300 shadow-sm active:scale-95 transition-all"
            title="返回今日看板"
          >
            ←
          </router-link>
          <div>
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
              <span>📖</span>
              <span>生字生词本</span>
              <span class="hidden sm:inline text-xs font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-md border border-brand-200">
                笔顺动画 · 描红临摹
              </span>
            </h1>
            <p class="text-xs font-bold text-slate-400">
              收录生字和词语，点开看笔顺演示与临摹，拼音默认遮罩自主考查
            </p>
          </div>
        </div>

        <!-- Center: Stats Pills -->
        <div class="order-last w-full lg:order-none lg:w-auto flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap bg-white px-4 py-2 rounded-2xl border border-slate-200 shadow-sm">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-slate-400">总收录:</span>
            <span class="text-sm font-black text-slate-800">{{ characterStore.totalCount }} 个</span>
          </div>
          <span class="text-slate-200 font-bold">|</span>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-emerald-500">已掌握:</span>
            <span class="text-sm font-black text-emerald-600">{{ characterStore.masteredCount }}</span>
          </div>
          <span class="text-slate-200 font-bold">|</span>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold text-amber-500">学习中:</span>
            <span class="text-sm font-black text-amber-600">{{ characterStore.learningCount }}</span>
          </div>
          <span class="text-slate-200 font-bold">|</span>
          <div class="flex items-center gap-1.5">
            <span class="text-xs font-bold text-brand-500">掌握率:</span>
            <span class="text-xs font-black text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
              {{ characterStore.masteryRate }}%
            </span>
          </div>
        </div>

        <!-- Right: Actions -->
        <div class="flex items-center gap-2.5">
          <router-link :to="`/child/${childId}/word-study`" class="px-3 py-2.5 rounded-xl bg-indigo-500 text-white text-xs font-bold">📚 字词学习</router-link>
          <SoundToggle />
          <router-link
            to="/parent/login"
            @click="playClick"
            class="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs transition-all active:scale-95 shadow-xs"
          >
            <span>⚙️</span>
            <span>家长</span>
          </router-link>
        </div>
      </header>

      <!-- Subheader: Filters & Quick Search Entry -->
      <div class="bg-white rounded-2xl p-3 px-4 border border-slate-200/90 shadow-sm mb-6 flex flex-wrap items-center justify-between gap-3">
        <!-- Left: Status Filter Capsules -->
        <div class="flex items-center gap-2">
          <button
            v-for="f in filterOptions"
            :key="f.key"
            type="button"
            @click="selectFilter(f.key)"
            class="px-3.5 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 active:scale-95"
            :class="[
              currentFilter === f.key
                ? 'bg-brand-500 text-white shadow-button'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
            ]"
          >
            <span>{{ f.icon }}</span>
            <span>{{ f.label }}</span>
            <span
              class="text-[10px] px-1.5 py-0.2 rounded-full"
              :class="currentFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-500'"
            >
              {{ f.count }}
            </span>
          </button>
        </div>

        <!-- Right: Global Pinyin Toggle & Big Lookup Stroke Button -->
        <div class="flex items-center gap-2.5">
          <!-- Reveal All Pinyin Toggle -->
          <button
            type="button"
            @click="toggleGlobalPinyin"
            class="h-11 px-3.5 rounded-xl border text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
            :class="[
              globalShowPinyin
                ? 'bg-brand-50 text-brand-600 border-brand-200 shadow-xs'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            ]"
            title="一键揭示或遮罩全部拼音"
          >
            <span>{{ globalShowPinyin ? '👁️' : '🙈' }}</span>
            <span>{{ globalShowPinyin ? '全部拼音已显露' : '拼音默认遮罩中' }}</span>
          </button>

          <!-- Big Prominent Search Stroke Button (查笔画) -->
          <button
            type="button"
            @click="openStrokeLookup"
            class="h-11 px-4 rounded-xl bg-gradient-to-r from-brand-500 via-indigo-600 to-brand-600 hover:from-brand-600 hover:to-indigo-700 text-white font-black text-xs shadow-button active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span class="text-base">🔍</span>
            <span>查笔画 · 一键入本</span>
          </button>
        </div>
      </div>

      <!-- Category filter: tap one to show only its entries, tap again to show all -->
      <div class="flex flex-wrap items-center gap-2 -mt-3 mb-6">
        <span class="text-xs font-bold text-slate-400">按分类:</span>
        <button
          v-for="category in CATEGORIES"
          :key="category.key"
          type="button"
          @click="selectCategory(category.key)"
          class="px-3 py-1.5 rounded-xl border text-xs font-black transition-all active:scale-95 flex items-center gap-1"
          :class="currentCategory === category.key ? category.chip + ' ring-2 ring-offset-1 ring-brand-300' : 'bg-white text-slate-500 border-slate-200'"
          :aria-pressed="currentCategory === category.key ? 'true' : 'false'"
        >
          <span>{{ category.icon }}</span>
          <span>{{ category.label }}</span>
          <span class="text-[10px] opacity-70">{{ characterStore.categoryCount(category.key) }}</span>
        </button>
      </div>

      <!-- Character Cards Flow / Grid (Responsive for iPad Air 5 1180px) -->
      <div
        v-if="filteredCharacters.length > 0"
        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
      >
        <CharacterCard
          v-for="charItem in filteredCharacters"
          :key="charItem.id"
          :character="charItem"
          :force-show-pinyin="globalShowPinyin"
          @select="openDetailModal(charItem)"
          @toggle-master="handleToggleMaster(charItem.id)"
        />
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="bg-white rounded-3xl p-12 text-center border border-slate-200/90 shadow-sm flex flex-col items-center justify-center my-6"
      >
        <div class="text-6xl mb-4 animate-bounce">📖</div>
        <h3 class="text-xl font-black text-slate-800 mb-2">
          {{ currentFilter === 'all' && !currentCategory ? '生字生词本还是空的' : '当前筛选下没有字词' }}
        </h3>
        <p class="text-xs font-bold text-slate-400 max-w-sm mb-6 leading-relaxed">
          在语文课文或作业中遇到不认识、笔画记不清的字或词？点击「查笔画」输入汉字或词语，看动态书写动画并一键收录！
        </p>

        <button
          type="button"
          @click="openStrokeLookup"
          class="h-12 px-6 rounded-2xl bg-gradient-to-r from-brand-500 to-indigo-600 text-white font-black text-sm shadow-button hover:from-brand-600 hover:to-indigo-700 active:scale-95 transition-all flex items-center gap-2"
        >
          <span>🔍</span>
          <span>立即查笔画添加字词</span>
        </button>
      </div>
    </div>

    <!-- Modals -->
    <!-- 1. Character Detail & Stroke Tracing Modal -->
    <CharacterDetailModal
      v-if="selectedCharacter"
      :character="selectedCharacter"
      @close="selectedCharacter = null"
      @toggle-master="handleToggleMaster"
      @delete="handleDeleteCharacter"
      @updated="selectedCharacter = { ...$event }"
    />

    <!-- 2. Real-time Stroke Lookup & Add Modal -->
    <StrokeLookupModal
      v-model="isLookupModalOpen"
      :child-id="childId"
      initial-char="学"
      @added="onCharacterAddedFromLookup"
    />
    <ChildTabBar :child-id="childId" />
  </div>
</template>

<script setup>
import ChildTabBar from '../components/ChildTabBar.vue';
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useCharacterStore } from '../stores/character';
import CharacterCard from '../components/CharacterCard.vue';
import CharacterDetailModal from '../components/CharacterDetailModal.vue';
import StrokeLookupModal from '../components/StrokeLookupModal.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick } from '../utils/sound';
import { CATEGORIES } from '../utils/wordBook';

const route = useRoute();
const childId = computed(() => route.params.id || 'child-demo-1');
const characterStore = useCharacterStore();

const currentFilter = ref('all');
const currentCategory = ref(null);
const globalShowPinyin = ref(false);
const selectedCharacter = ref(null);
const isLookupModalOpen = ref(false);

const filterOptions = computed(() => [
  { key: 'all', label: '全部', icon: '📚', count: characterStore.totalCount },
  { key: 'learning', label: '学习中', icon: '🌱', count: characterStore.learningCount },
  { key: 'mastered', label: '已掌握', icon: '✅', count: characterStore.masteredCount },
]);

const filteredCharacters = computed(() => {
  let list = characterStore.characters;
  if (currentFilter.value === 'mastered') list = list.filter((c) => Boolean(c.is_mastered));
  if (currentFilter.value === 'learning') list = list.filter((c) => !c.is_mastered);
  if (currentCategory.value) list = list.filter((c) => c.categories?.includes(currentCategory.value));
  return list;
});

function selectCategory(key) {
  playClick();
  currentCategory.value = currentCategory.value === key ? null : key;
}

onMounted(async () => {
  await characterStore.fetchCharacters(childId.value);
});

function selectFilter(filterKey) {
  playClick();
  currentFilter.value = filterKey;
  characterStore.setFilter(filterKey);
}

function toggleGlobalPinyin() {
  playClick();
  globalShowPinyin.value = !globalShowPinyin.value;
}

function openStrokeLookup() {
  playClick();
  isLookupModalOpen.value = true;
}

function openDetailModal(charItem) {
  playClick();
  selectedCharacter.value = charItem;
}

async function handleToggleMaster(id) {
  await characterStore.toggleMaster(id);
  // Update selectedCharacter if currently open in detail modal
  if (selectedCharacter.value && selectedCharacter.value.id === id) {
    const updated = characterStore.characters.find((c) => c.id === id);
    if (updated) {
      selectedCharacter.value = { ...updated };
    }
  }
}

async function handleDeleteCharacter(id) {
  await characterStore.removeCharacter(id);
  selectedCharacter.value = null;
}

function onCharacterAddedFromLookup(created) {
  // If in detail view, could focus or highlight
}
</script>
