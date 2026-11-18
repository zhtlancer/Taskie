<template>
  <div data-characters-page class="min-h-screen bg-[#F4F6FB] dark:bg-slate-950 flex flex-col justify-between p-3 pb-24 sm:p-6 lg:pb-6 select-none relative">
    <div class="max-w-6xl w-full mx-auto min-w-0">
      <!-- Top Header Bar -->
      <header class="flex flex-wrap items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
        <!-- Left: Back button & Title -->
        <div class="flex items-center gap-3 min-w-0">
          <router-link
            :to="`/child/${childId}/today`"
            @click="playClick"
            class="hidden lg:flex w-12 h-12 shrink-0 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 items-center justify-center text-xl text-slate-600 dark:text-slate-300 hover:border-brand-300 dark:hover:border-brand-700 shadow-sm active:scale-95 transition-all"
            title="返回今日看板"
            aria-label="返回今日看板"
          >
            ←
          </router-link>
          <div class="min-w-0">
            <h1 class="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex flex-wrap items-center gap-2">
              <span>📖</span>
              <span>生字生词本</span>
              <span class="hidden sm:inline text-xs font-bold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/40 px-2 py-0.5 rounded-md border border-brand-200 dark:border-brand-800">
                笔顺动画 · 描红临摹
              </span>
            </h1>
            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">
              收录生字和词语，点开看笔顺演示与临摹，拼音默认遮罩自主考查
            </p>
          </div>
        </div>

        <p data-characters-summary class="order-last w-full text-xs font-bold text-slate-500 dark:text-slate-400">
          共 {{ isLoaded ? characterStore.totalCount : '—' }} 项 · 已掌握 {{ isLoaded ? characterStore.masteredCount : '—' }} · 学习中 {{ isLoaded ? characterStore.learningCount : '—' }} · 掌握率 {{ isLoaded ? `${characterStore.masteryRate}%` : '—' }}
        </p>

        <!-- Right: Actions -->
        <div class="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <router-link :to="`/child/${childId}/word-study`" class="min-h-11 inline-flex items-center px-3.5 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold shadow-xs active:scale-95 transition-all">📚 字词学习</router-link>
          <SoundToggle />
          <router-link
            to="/parent/login"
            @click="playClick"
            class="min-h-11 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs transition-all active:scale-95 shadow-xs"
          >
            <span>⚙️</span>
            <span>家长</span>
          </router-link>
        </div>
      </header>

      <!-- Subheader: Filters & Quick Search Entry -->
      <div class="bg-white dark:bg-slate-900 rounded-2xl p-3 px-4 border border-slate-200/90 dark:border-slate-700/90 shadow-sm mb-4 sm:mb-6 flex flex-wrap items-center justify-between gap-3">
        <!-- Left: Status Filter Capsules -->
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="f in filterOptions"
            :key="f.key"
            type="button"
            @click="selectFilter(f.key)"
            :aria-pressed="currentFilter === f.key ? 'true' : 'false'"
            class="min-h-[44px] px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all flex items-center gap-1.5 active:scale-95"
            :class="[
              currentFilter === f.key
                ? 'bg-brand-500 text-white shadow-button'
                : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            ]"
          >
            <span>{{ f.icon }}</span>
            <span>{{ f.label }}</span>
            <span
              class="text-xs px-1.5 py-0.5 rounded-full"
              :class="currentFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'"
            >
              {{ isLoaded ? f.count : '—' }}
            </span>
          </button>
        </div>

        <!-- Right: Global Pinyin Toggle & Big Lookup Stroke Button -->
        <div class="flex flex-wrap items-center gap-2.5">
          <!-- Reveal All Pinyin Toggle -->
          <button
            type="button"
            @click="toggleGlobalPinyin"
            :aria-pressed="globalShowPinyin ? 'true' : 'false'"
            class="min-h-11 px-3.5 py-2 rounded-xl border text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5"
            :class="[
              globalShowPinyin
                ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
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
            class="min-h-11 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-500 via-indigo-600 to-brand-600 hover:from-brand-600 hover:to-indigo-700 text-white font-black text-xs shadow-button active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <span class="text-base">🔍</span>
            <span>查笔画 · 一键入本</span>
          </button>
        </div>
      </div>

      <!-- Category filter: tap one to show only its entries, tap again to show all -->
      <details class="mb-4">
        <summary class="cursor-pointer min-h-[44px] py-3 text-sm text-slate-600 dark:text-slate-300 font-bold">
          分类筛选{{ currentCategory ? ' · 已启用' : '' }}
        </summary>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">按分类:</span>
          <button
            v-for="category in CATEGORIES"
            :key="category.key"
            type="button"
            @click="selectCategory(category.key)"
            class="min-h-11 px-3 py-2 rounded-xl border text-xs font-black transition-all active:scale-95 flex items-center gap-1.5"
            :class="currentCategory === category.key ? category.chip + ' ring-2 ring-offset-1 ring-brand-300 dark:ring-brand-700' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
            :aria-pressed="currentCategory === category.key ? 'true' : 'false'"
          >
            <span>{{ category.icon }}</span>
            <span>{{ category.label }}</span>
            <span class="text-xs opacity-75">{{ isLoaded ? characterStore.categoryCount(category.key) : '—' }}</span>
          </button>
        </div>
      </details>

      <!-- Action Error Banner (Card-level toggle-master failure recovery) -->
      <div
        v-if="actionError"
        role="alert"
        data-characters-action-error
        class="mb-4 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-rose-700 dark:text-rose-200"
      >
        <span class="min-w-0 font-bold break-words">{{ actionError }}</span>
        <div class="flex items-center gap-2 shrink-0">
          <button
            v-if="failedToggleId"
            type="button"
            :disabled="characterStore.isBusy(failedToggleId)"
            @click="retryFailedToggle"
            class="min-h-11 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50"
          >
            {{ characterStore.isBusy(failedToggleId) ? '正在保存…' : '重试保存' }}
          </button>
          <button
            type="button"
            @click="clearActionError"
            class="min-h-11 px-3.5 py-2 rounded-xl border border-rose-300 dark:border-rose-700 bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-200 text-xs font-bold"
          >
            关闭
          </button>
        </div>
      </div>

      <!-- Refreshing status while retaining known characters -->
      <p v-if="characterStore.loading && isLoaded" role="status" class="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3">
        正在更新生字生词本，当前显示上次读取的数据。
      </p>

      <!-- Load Failure Banner (keeps known characters below when refreshing fails) -->
      <PageState
        v-if="characterStore.error"
        kind="error"
        title="生字生词本未能读取"
        :description="characterStore.error"
        :busy="characterStore.loading"
        @retry="loadCharacters()"
      />

      <!-- Initial Loading State -->
      <PageState
        v-else-if="characterStore.loading && !isLoaded"
        kind="loading"
        title="正在读取生字生词本…"
      />

      <!-- Loaded Content -->
      <template v-if="isLoaded">
        <button
          v-if="characterStore.characters.length > 0"
          type="button"
          class="lg:hidden min-h-[44px] px-3 inline-flex items-center rounded-xl text-sm font-bold text-brand-600 dark:text-brand-300 mb-3 hover:bg-brand-50 dark:hover:bg-brand-900/20"
          @click="compact = !compact"
        >
          {{ compact ? '切换为字卡' : '切换为列表' }}
        </button>

        <div v-if="filteredCharacters.length && compact" class="space-y-2 lg:hidden mb-4">
          <button
            v-for="item in filteredCharacters"
            :key="item.id"
            type="button"
            class="w-full min-h-[68px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 text-left"
            @click="openDetailModal(item)"
          >
            <span class="min-w-0 flex-1">
              <span class="block text-2xl font-reading text-slate-800 dark:text-slate-100 break-words [overflow-wrap:anywhere]">{{ item.char }}</span>
              <span v-if="globalShowPinyin" class="block text-xs text-brand-600 dark:text-brand-300 break-words [overflow-wrap:anywhere]">
                {{ item.pinyin || getCharPinyin(item.char) || '—' }}
              </span>
            </span>
            <span class="shrink-0 text-xs font-bold" :class="item.is_mastered ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'">
              {{ characterStore.isBusy(item.id) ? '保存中…' : item.is_mastered ? '已掌握' : '学习中' }} ›
            </span>
          </button>
        </div>

        <!-- Character Cards Flow / Grid (Responsive for phone through iPad Air 5 1180px) -->
        <div
          v-if="filteredCharacters.length > 0"
          :class="compact ? 'hidden lg:grid' : 'grid'"
          class="grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3"
        >
          <CharacterCard
            v-for="charItem in filteredCharacters"
            :key="charItem.id"
            :character="charItem"
            :force-show-pinyin="globalShowPinyin"
            :busy="characterStore.isBusy(charItem.id)"
            @select="openDetailModal(charItem)"
            @toggle-master="handleToggleMaster(charItem.id, 'card')"
          />
        </div>

        <!-- Real Empty State (Book empty vs Filtered empty) -->
        <div
          v-else
          data-characters-empty
          class="bg-white dark:bg-slate-900 rounded-3xl p-8 sm:p-12 text-center border border-slate-200/90 dark:border-slate-700/90 shadow-sm flex flex-col items-center justify-center my-6"
        >
          <div class="text-5xl sm:text-6xl mb-4">📖</div>
          <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 mb-2">
            {{ isBookEmpty ? '生字生词本还是空的' : '当前筛选下没有字词' }}
          </h3>
          <p class="text-xs font-bold text-slate-500 dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
            {{ isBookEmpty
              ? '在语文课文或作业中遇到不认识、笔画记不清的字或词？点击「查笔画」输入汉字或词语，看动态书写动画并一键收录！'
              : '当前状态或分类条件下没有匹配的字词，可以清除筛选查看全部内容，或直接查笔画收录新字词。' }}
          </p>

          <div class="flex flex-wrap items-center justify-center gap-3">
            <button
              v-if="!isBookEmpty"
              type="button"
              @click="resetFilters"
              class="min-h-12 px-5 rounded-2xl ui-button-secondary font-black text-sm"
            >
              查看全部字词
            </button>
            <button
              type="button"
              @click="openStrokeLookup"
              class="min-h-12 px-6 py-2.5 rounded-2xl bg-gradient-to-r from-brand-500 to-indigo-600 text-white font-black text-sm shadow-button hover:from-brand-600 hover:to-indigo-700 active:scale-95 transition-all flex items-center gap-2"
            >
              <span>🔍</span>
              <span>立即查笔画添加字词</span>
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Modals -->
    <!-- 1. Character Detail & Stroke Tracing Modal -->
    <CharacterDetailModal
      v-if="selectedCharacter"
      :character="selectedCharacter"
      :busy="detailBusy"
      :error="detailError"
      @close="closeDetailModal"
      @toggle-master="handleToggleMaster($event, 'detail')"
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRoute } from 'vue-router';
import { getCharPinyin } from '../utils/hanzi';
import { getToken } from '../utils/session.js';
import { useCharacterStore } from '../stores/character';
import ChildTabBar from '../components/ChildTabBar.vue';
import CharacterCard from '../components/CharacterCard.vue';
import CharacterDetailModal from '../components/CharacterDetailModal.vue';
import PageState from '../components/ParentPageState.vue';
import StrokeLookupModal from '../components/StrokeLookupModal.vue';
import SoundToggle from '../components/SoundToggle.vue';
import { playClick } from '../utils/sound';
import { loadLearningFont } from '../utils/learningFont';
import { CATEGORIES } from '../utils/wordBook';

const route = useRoute();
const childId = computed(() => route.params.id || '');
const characterStore = useCharacterStore();

const currentFilter = ref('all');
const currentCategory = ref(null);
const globalShowPinyin = ref(false);
const compact = ref(true);
const selectedCharacter = ref(null);
const isLookupModalOpen = ref(false);
const detailBusy = ref(false);
const detailError = ref('');
const actionError = ref('');
const failedToggleId = ref(null);
let alive = true, actionSerial = 0;

function invalidateActions() {
  actionSerial++;
  detailBusy.value = false;
}

const isLoaded = computed(() => characterStore.isLoadedFor(childId.value));
const isBookEmpty = computed(() => characterStore.characters.length === 0);

const filterOptions = computed(() => [
  { key: 'all', label: '全部', icon: '📚', count: characterStore.totalCount },
  { key: 'learning', label: '学习中', icon: '🌱', count: characterStore.learningCount },
  { key: 'mastered', label: '已掌握', icon: '✅', count: characterStore.masteredCount },
]);

const filteredCharacters = computed(() => {
  if (!isLoaded.value) return [];
  let list = characterStore.characters;
  if (currentFilter.value === 'mastered') list = list.filter((c) => Boolean(c.is_mastered));
  if (currentFilter.value === 'learning') list = list.filter((c) => !c.is_mastered);
  if (currentCategory.value) list = list.filter((c) => c.categories?.includes(currentCategory.value));
  return list;
});

function loadCharacters() {
  if (!alive || !childId.value || !getToken()) return;
  return characterStore.fetchCharacters(childId.value);
}

function resetScope(closeModals = true) {
  invalidateActions();
  if (closeModals) {
    selectedCharacter.value = null;
    isLookupModalOpen.value = false;
  }
  detailError.value = '';
  actionError.value = '';
  failedToggleId.value = null;
  characterStore.clear(childId.value || null);
  loadCharacters();
}

function onResume() {
  if (!document.hidden && alive) loadCharacters();
}

watch(childId, (next, prev) => {
  if (next !== prev) resetScope(true);
}, { flush: 'sync' });

watch(() => characterStore.characters, (list) => {
  if (!selectedCharacter.value) return;
  const fresh = list.find((c) => c.id === selectedCharacter.value.id);
  if (fresh) selectedCharacter.value = { ...fresh };
});

onMounted(() => {
  loadLearningFont();
  characterStore.setChild(childId.value || null);
  loadCharacters();
  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('pageshow', onResume);
  window.addEventListener('taskie:data-restored', resetScope);
  window.addEventListener('taskie:session-changed', resetScope);
});

onBeforeUnmount(() => {
  alive = false;
  invalidateActions();
  characterStore.abortFetch();
  document.removeEventListener('visibilitychange', onResume);
  window.removeEventListener('pageshow', onResume);
  window.removeEventListener('taskie:data-restored', resetScope);
  window.removeEventListener('taskie:session-changed', resetScope);
});

function selectCategory(key) {
  playClick();
  currentCategory.value = currentCategory.value === key ? null : key;
}

function selectFilter(filterKey) {
  playClick();
  currentFilter.value = filterKey;
  characterStore.setFilter(filterKey);
}

function resetFilters() {
  playClick();
  currentFilter.value = 'all';
  currentCategory.value = null;
  characterStore.setFilter('all');
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
  detailError.value = '';
  actionError.value = '';
  failedToggleId.value = null;
  playClick();
  selectedCharacter.value = { ...charItem };
}

function closeDetailModal() {
  selectedCharacter.value = null;
  detailError.value = '';
}

function clearActionError() {
  actionError.value = '';
  failedToggleId.value = null;
}

async function handleToggleMaster(id, source = 'card') {
  if (!id || detailBusy.value || characterStore.isBusy(id)) return;
  const request = ++actionSerial, targetChild = childId.value, token = getToken(), generation = characterStore.scopeGeneration;
  const matches = () => alive && request === actionSerial && childId.value === targetChild &&
    token === getToken() && generation === characterStore.scopeGeneration;
  if (source === 'detail' || selectedCharacter.value?.id === id) detailError.value = '';
  actionError.value = '';
  failedToggleId.value = null;
  detailBusy.value = true;
  try {
    const updated = await characterStore.toggleMaster(id);
    if (matches() && updated && selectedCharacter.value?.id === id) {
      selectedCharacter.value = { ...updated };
    }
  } catch (err) {
    if (!matches()) return;
    const msg = typeof err === 'string' ? err : err?.message || '保存失败，请重试';
    if (selectedCharacter.value?.id === id) {
      detailError.value = msg;
    } else {
      actionError.value = msg;
      failedToggleId.value = id;
    }
  } finally {
    if (matches()) detailBusy.value = false;
  }
}

async function retryFailedToggle() {
  if (!failedToggleId.value) return;
  await handleToggleMaster(failedToggleId.value, 'card');
}

async function handleDeleteCharacter(id) {
  if (!id || detailBusy.value || characterStore.isBusy(id)) return;
  const request = ++actionSerial, targetChild = childId.value, token = getToken(), generation = characterStore.scopeGeneration;
  const matches = () => alive && request === actionSerial && childId.value === targetChild &&
    token === getToken() && generation === characterStore.scopeGeneration;
  detailBusy.value = true;
  detailError.value = '';
  try {
    await characterStore.removeCharacter(id);
    if (matches() && selectedCharacter.value?.id === id) {
      closeDetailModal();
    }
  } catch (err) {
    if (matches()) {
      detailError.value = typeof err === 'string' ? err : err?.message || '移出失败，请重试';
    }
  } finally {
    if (matches()) detailBusy.value = false;
  }
}

function onCharacterAddedFromLookup() {}
</script>
