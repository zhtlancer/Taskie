<template>
  <div data-english-wordbook>
    <p data-english-summary class="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3">
      共 {{ isLoaded ? store.totalCount : '—' }} 词 · 手工标记已掌握 {{ isLoaded ? store.masteredCount : '—' }} · 未标记 {{ isLoaded ? store.learningCount : '—' }} · 标记掌握率 {{ isLoaded ? `${store.masteryRate}%` : '—' }}
    </p>

    <!-- Subheader: Status Filters, Self-check Meaning Toggle, Lookup & Batch Import -->
    <WordBooksPanel v-model="selectedBook" :child-id="childId" language="en" :entries="store.words" @changed="loadWords" />
    <div class="bg-white dark:bg-slate-900 rounded-2xl p-3 px-4 border border-slate-200/90 dark:border-slate-700/90 shadow-sm mb-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-for="f in filterOptions"
            :key="f.key"
            type="button"
            :aria-pressed="currentFilter === f.key"
            class="min-h-[44px] px-3 py-2 rounded-xl text-xs font-black whitespace-nowrap transition-all flex items-center gap-1.5"
            :class="currentFilter === f.key
              ? 'bg-brand-500 text-white shadow-button'
              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'"
            @click="selectFilter(f.key)"
          >
            <span>{{ f.icon }}</span>
            <span>{{ f.label }}</span>
            <span class="text-xs px-1.5 py-0.5 rounded-full" :class="currentFilter === f.key ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'">
              {{ isLoaded ? f.count : '—' }}
            </span>
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :aria-pressed="globalShowMeaning"
            class="min-h-11 px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5"
            :class="globalShowMeaning
              ? 'bg-brand-50 dark:bg-brand-900/40 text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
            @click="globalShowMeaning = !globalShowMeaning"
          >
            <span>{{ globalShowMeaning ? '👁️' : '🙈' }}</span>
            <span>{{ globalShowMeaning ? '释义已显示' : '释义遮罩自查' }}</span>
          </button>

          <button
            type="button"
            class="min-h-11 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-black hover:border-brand-300"
            @click="isBatchOpen = true"
          >
            📥 批量导入
          </button>

          <button
            type="button"
            class="min-h-11 px-4 py-2 rounded-xl bg-gradient-to-r from-brand-500 via-indigo-600 to-brand-600 text-white font-black text-xs shadow-button flex items-center gap-1.5"
            @click="openLookup()"
          >
            <span>🔍</span>
            <span>查词 · 收录单词</span>
          </button>
        </div>
      </div>

      <!-- Search + Textbook / Unit Filters -->
      <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <input
          v-model="searchQuery"
          type="search"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          placeholder="搜索单词、释义或单元…"
          class="flex-1 min-w-[160px] min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-bold text-slate-800 dark:text-slate-100"
        />
      </div>

      <div class="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div class="flex flex-wrap items-center gap-2">
          <label class="text-xs font-bold text-slate-600 dark:text-slate-300">练习技能
            <select v-model="progressSkill" aria-label="练习技能" class="ml-1 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs text-slate-700 dark:text-slate-200">
              <option value="any">任一技能</option><option value="recognize">认读</option><option value="write">默写</option>
            </select>
          </label>
          <label class="text-xs font-bold text-slate-600 dark:text-slate-300">学习进度
            <select v-model="progressStatus" aria-label="学习进度" class="ml-1 min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs text-slate-700 dark:text-slate-200">
              <option value="all">全部进度</option><option value="due">今日待复习</option><option value="unlearned">尚未学习</option><option value="learning">复习中</option>
            </select>
          </label>
        </div>
        <p data-english-progress-summary class="text-xs text-slate-500 dark:text-slate-400">
          当前范围 · 今日待复习 {{ isLoaded ? progressCount('due') : '—' }} 词 · 尚未学习 {{ isLoaded ? progressCount('unlearned') : '—' }} 词
          <span v-if="progressDate"> · 进度截至 {{ progressDate }}</span>
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-400">认读、默写分别记录，与手工掌握标记独立。待复习包含逾期内容，今日实际学习仍按计划安排。</p>
      </div>
    </div>

    <!-- Category filter -->
    <details class="mb-4">
      <summary class="cursor-pointer min-h-[44px] py-3 text-sm text-slate-600 dark:text-slate-300 font-bold">
        分类筛选{{ currentCategory ? ' · 已启用' : '' }}
      </summary>
      <div class="flex flex-wrap items-center gap-2 pt-1">
        <button
          v-for="cat in ENGLISH_CATEGORIES"
          :key="cat.key"
          type="button"
          :aria-pressed="currentCategory === cat.key"
          class="min-h-11 px-3 py-2 rounded-xl border text-xs font-black flex items-center gap-1.5"
          :class="currentCategory === cat.key ? cat.chip + ' ring-2 ring-offset-1 ring-brand-300 dark:ring-brand-700' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
          @click="currentCategory = currentCategory === cat.key ? null : cat.key"
        >
          <span>{{ cat.icon }}</span>
          <span>{{ cat.label }}</span>
          <span class="text-xs opacity-75">{{ isLoaded ? store.categoryCount(cat.key) : '—' }}</span>
        </button>
      </div>
    </details>

    <!-- Notice for words lacking definitions -->
    <p v-if="isLoaded && store.missingDefinitionCount > 0" class="mb-4 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-xs font-bold text-amber-800 dark:text-amber-200">
      提示：当前有 {{ store.missingDefinitionCount }} 个单词缺少中英文释义，补充释义后才会纳入自动背词计划。
    </p>

    <!-- Action/audio errors -->
    <div
      v-if="actionError"
      role="alert"
      class="mb-4 rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-sm text-rose-700 dark:text-rose-200"
    >
      <span class="font-bold">{{ actionError }}</span>
      <button type="button" class="min-h-11 min-w-11 px-3 rounded-xl border border-rose-300 dark:border-rose-700 text-xs font-bold" @click="actionError = ''">关闭</button>
    </div>

    <PageState v-if="store.error && !isLoaded" kind="error" title="英语单词本未能读取" :description="store.error" :busy="store.loading" @retry="loadWords" />
    <PageState v-else-if="store.loading && !isLoaded" kind="loading" title="正在读取英语单词本…" />

    <template v-if="isLoaded">
      <div v-if="store.loading || store.error" data-english-refresh :role="store.error ? 'alert' : 'status'"
        class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs font-bold"
        :class="store.error ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'">
        <span>{{ store.loading ? '正在更新英语单词本，当前显示上次读取的数据。' : `更新未成功，当前显示上次读取的数据。${store.error}` }}</span>
        <button v-if="store.error" type="button" :disabled="store.loading" class="ui-button-secondary min-h-11" @click="loadWords">重新读取</button>
      </div>
      <div v-if="filteredWords.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        <EnglishWordCard
          v-for="item in filteredWords"
          :key="item.id"
          :word="item"
          :force-show-meaning="globalShowMeaning"
          :busy="store.isBusy(item.id)"
          @select="openDetail(item)"
          @toggle-master="handleToggleMaster"
          @audio-error="actionError = $event"
        />
      </div>

      <div
        v-else
        data-english-empty
        class="bg-white dark:bg-slate-900 rounded-3xl p-8 sm:p-12 text-center border border-slate-200/90 dark:border-slate-700/90 shadow-sm flex flex-col items-center justify-center my-6"
      >
        <div class="text-5xl mb-4">🔤</div>
        <h3 class="text-xl font-black text-slate-800 dark:text-slate-100 mb-2">
          {{ store.words.length === 0 ? '英语单词本还是空的' : '当前筛选下没有单词' }}
        </h3>
        <p class="text-xs font-bold text-slate-500 dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
          {{ store.words.length === 0
            ? '点开「查词 · 收录单词」可查询牛津/韦氏/英汉词典音标、释义与原声发音，也能批量导入或手动收录。'
            : '可以清除筛选条件，或直接查词收录新单词。' }}
        </p>
        <div class="flex flex-wrap justify-center gap-3">
          <button v-if="store.words.length > 0" type="button" class="ui-button-secondary" @click="resetFilters">查看全部单词</button>
          <button type="button" class="ui-button-primary" @click="openLookup()">🔍 立即查词收录</button>
        </div>
      </div>
    </template>

    <EnglishLookupModal v-model="isLookupOpen" :child-id="childId" :initial-word="lookupInitialWord" />
    <EnglishBatchImportModal v-model="isBatchOpen" :child-id="childId" />
    <EnglishWordDetailModal
      v-if="selectedWord"
      :word="selectedWord"
      :busy="detailBusy"
      :error="detailError"
      @close="selectedWord = null"
      @toggle-master="handleToggleMaster"
      @delete="handleDelete"
      @updated="handleUpdated"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import PageState from './ParentPageState.vue';
import EnglishWordCard from './EnglishWordCard.vue';
import EnglishLookupModal from './EnglishLookupModal.vue';
import EnglishBatchImportModal from './EnglishBatchImportModal.vue';
import EnglishWordDetailModal from './EnglishWordDetailModal.vue';
import { useEnglishWordStore } from '../stores/englishWord';
import { getToken } from '../utils/session';
import { ENGLISH_CATEGORIES } from '../utils/englishWord';
import { useAsyncScope } from '../composables/useAsyncScope';
import { matchesEnglishProgress } from '../utils/englishProgress';
import { useCalendarStore } from '../stores/calendar';
import WordBooksPanel from './WordBooksPanel.vue';
import { filterBookEntries } from '../utils/wordBookSource';

const props = defineProps({
  childId: { type: String, required: true }
});

const store = useEnglishWordStore();
const calendar = useCalendarStore();
const currentFilter = ref('all');
const progressSkill = ref('any');
const progressStatus = ref('all');
const currentCategory = ref(null);
const selectedBook = ref('all');
const searchQuery = ref('');
const globalShowMeaning = ref(true);

const isLookupOpen = ref(false);
const lookupInitialWord = ref('');
const isBatchOpen = ref(false);
const selectedWord = ref(null);
const detailBusy = ref(false);
const detailError = ref('');
const actionError = ref('');

let alive = true;
const { capture } = useAsyncScope(() => [props.childId, selectedWord.value?.id, store.scopeGeneration], () => {
  detailBusy.value = false;
  detailError.value = '';
  actionError.value = '';
});
const isLoaded = computed(() => store.isLoadedFor(props.childId));

const filterOptions = computed(() => [
  { key: 'all', label: '全部', icon: '📚', count: store.totalCount },
  { key: 'learning', label: '未标记掌握', icon: '🌱', count: store.learningCount },
  { key: 'mastered', label: '手工已掌握', icon: '✅', count: store.masteredCount }
]);

const scopedWords = computed(() => {
  if (!isLoaded.value) return [];
  let list = filterBookEntries(store.words, selectedBook.value);
  if (currentFilter.value === 'mastered') list = list.filter(w => Boolean(w.is_mastered));
  if (currentFilter.value === 'learning') list = list.filter(w => !w.is_mastered);
  if (currentCategory.value) list = list.filter(w => w.categories?.includes(currentCategory.value));
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(w =>
      w.word.toLowerCase().includes(q)
      || (w.definition_zh && w.definition_zh.toLowerCase().includes(q))
      || (w.definition_en && w.definition_en.toLowerCase().includes(q))
      || w.senses?.some(sense => [sense.definition_zh, sense.definition_en, sense.example].some(value => value && value.toLowerCase().includes(q)))
      || w.books?.some(book => [book.name, book.source, book.unit].some(value => value?.toLowerCase().includes(q)))
    );
  }
  return list;
});
const filteredWords = computed(() => scopedWords.value.filter(word => matchesEnglishProgress(word, progressSkill.value, progressStatus.value)));
const progressCount = status => scopedWords.value.filter(word => matchesEnglishProgress(word, progressSkill.value, status)).length;
const progressDate = computed(() => isLoaded.value ? store.words.map(word => word.study_date).filter(Boolean).sort()[0] || '' : '');

function selectFilter(key) {
  currentFilter.value = key;
}

function resetFilters() {
  currentFilter.value = 'all';
  currentCategory.value = null;
  selectedBook.value = 'all';
  searchQuery.value = '';
  progressSkill.value = 'any';
  progressStatus.value = 'all';
}

function openLookup(word = '') {
  lookupInitialWord.value = word;
  isLookupOpen.value = true;
}

function openDetail(item) {
  detailError.value = '';
  actionError.value = '';
  selectedWord.value = { ...item };
}

function handleUpdated(updated) {
  if (alive && updated?.child_id === props.childId && selectedWord.value?.id === updated.id) {
    selectedWord.value = { ...updated };
  }
}

function loadWords() {
  if (!alive || !props.childId || !getToken()) return;
  return store.fetchWords(props.childId).catch(() => {});
}

function resetScope() {
  selectedBook.value = 'all';
  detailBusy.value = false;
  selectedWord.value = null;
  isLookupOpen.value = false;
  isBatchOpen.value = false;
  detailError.value = '';
  actionError.value = '';
  store.clear(props.childId || null);
  loadWords();
}

function onResume() {
  if (!document.hidden && alive) {
    calendar.refreshToday();
    loadWords();
  }
}

// Invalidate an older list request at the family date/zone boundary as well.
watch(() => [calendar.ready, calendar.today, calendar.timeZone], () => { if (calendar.ready) loadWords(); });

watch(() => props.childId, () => resetScope(), { flush: 'sync' });
watch(() => store.words, (list) => {
  if (!selectedWord.value) return;
  const fresh = list.find(w => w.id === selectedWord.value.id);
  if (fresh) selectedWord.value = { ...fresh };
});

onMounted(() => {
  store.setChild(props.childId);
  loadWords();
  window.addEventListener('taskie:data-restored', resetScope);
  window.addEventListener('taskie:session-changed', resetScope);
  window.addEventListener('pageshow', onResume);
  document.addEventListener('visibilitychange', onResume);
});

onBeforeUnmount(() => {
  alive = false;
  store.abortFetch();
  window.removeEventListener('taskie:data-restored', resetScope);
  window.removeEventListener('taskie:session-changed', resetScope);
  window.removeEventListener('pageshow', onResume);
  document.removeEventListener('visibilitychange', onResume);
});

async function handleToggleMaster(id) {
  if (!id || detailBusy.value || store.isBusy(id)) return;
  detailBusy.value = true;
  detailError.value = '';
  actionError.value = '';
  const matchesScope = capture();
  try {
    const updated = await store.toggleMaster(id);
    if (matchesScope() && updated && selectedWord.value?.id === id) selectedWord.value = { ...updated };
  } catch (err) {
    if (!matchesScope()) return;
    const msg = typeof err === 'string' ? err : err?.message || '保存失败，请重试';
    if (selectedWord.value?.id === id) detailError.value = msg;
    else actionError.value = msg;
  } finally {
    if (matchesScope()) detailBusy.value = false;
  }
}

async function handleDelete(id) {
  if (!id || detailBusy.value || store.isBusy(id)) return;
  detailBusy.value = true;
  detailError.value = '';
  const matchesScope = capture();
  try {
    const removed = await store.removeWord(id);
    if (matchesScope() && removed && selectedWord.value?.id === id) selectedWord.value = null;
  } catch (err) {
    if (matchesScope()) detailError.value = typeof err === 'string' ? err : err?.message || '移出失败，请重试';
  } finally {
    if (matchesScope()) detailBusy.value = false;
  }
}
</script>
