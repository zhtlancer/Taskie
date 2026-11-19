<template>
  <UiDialog :title="currentWord ? `原词典 · ${currentWord}` : '完整原词典'" large @close="$emit('close')">
    <template v-if="history.length > 0" #subtitle>
      <div class="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          type="button"
          class="min-h-11 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200"
          @click="goBack"
        >
          ← 返回 {{ history.at(-1) }}
        </button>
      </div>
    </template>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap gap-1.5" role="tablist" aria-label="原词典来源">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.key"
            class="min-h-11 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all"
            :class="activeTab === tab.key
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>

        <button
          v-if="allowPick && currentWord && currentWord !== initialWord"
          type="button"
          class="min-h-11 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
          @click="$emit('pick-word', currentWord)"
        >
          用“{{ currentWord }}”继续查词
        </button>
      </div>

      <p v-if="audioError" role="alert" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200">
        {{ audioError }}
      </p>

      <div v-if="loading" class="py-10 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
        正在读取原词典释义…
      </div>

      <div v-else-if="error" class="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-700 dark:text-rose-200 space-y-2">
        <p class="font-bold">{{ error }}</p>
        <button type="button" class="min-h-11 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold" @click="loadWord(currentWord)">
          重试读取
        </button>
      </div>

      <div v-else-if="!visibleArticles.length" class="py-10 text-center text-sm font-bold text-slate-500 dark:text-slate-400">
        {{ available ? `原词典中暂未找到“${currentWord}”的完整条目` : (unavailableReason || '当前环境未挂载离线原词典') }}
      </div>

      <div v-else class="space-y-4">
        <section
          v-for="dict in visibleArticles"
          :key="dict.dict_id"
          class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3"
        >
          <header class="flex items-center justify-between gap-2 pb-2 border-b border-slate-200/80 dark:border-slate-700">
            <h3 class="text-sm font-black text-slate-800 dark:text-slate-100">{{ dict.name }}</h3>
            <span class="text-xs font-bold text-slate-500 dark:text-slate-400">{{ dict.entries.length }} 条释义</span>
          </header>

          <!-- Babylon EN-ZH entries -->
          <template v-if="dict.dict_id === 'bgl'">
            <div
              v-for="(entry, idx) in dict.entries"
              :key="idx"
              class="rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 p-3 space-y-1.5 text-sm"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-black text-slate-800 dark:text-slate-100">{{ entry.headword }}</span>
                <span v-if="entry.pos" class="px-2 py-0.5 rounded-md text-xs font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">{{ entry.pos }}</span>
                <span v-if="entry.phonetic" class="text-xs font-mono text-cyan-700 dark:text-cyan-300">[{{ entry.phonetic }}]</span>
              </div>
              <ul class="list-disc pl-5 space-y-1 text-slate-700 dark:text-slate-200">
                <li v-for="(sense, sIdx) in entry.senses" :key="sIdx">{{ sense }}</li>
              </ul>
              <p v-if="entry.inflections?.length" class="text-xs text-slate-500 dark:text-slate-400">
                词形变化：{{ entry.inflections.join(', ') }}
              </p>
            </div>
          </template>

          <!-- DSL rich AST entries (OALD8 / MW) -->
          <template v-else>
            <div
              v-for="(entry, idx) in dict.entries"
              :key="idx"
              class="rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 p-3.5 space-y-1.5 text-sm leading-relaxed"
            >
              <div
                v-for="(block, bIdx) in entry.blocks"
                :key="bIdx"
                :style="{ paddingLeft: `${Math.min(block.indent, 4) * 0.9}rem` }"
                class="break-words [overflow-wrap:anywhere]"
              >
                <template v-for="(node, nIdx) in block.nodes" :key="nIdx">
                  <button
                    v-if="node.type === 'audio'"
                    type="button"
                    class="inline-flex items-center gap-1 mx-1 px-2.5 py-1 min-h-11 rounded-lg bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-800 text-xs font-bold hover:bg-brand-100 dark:hover:bg-brand-900/70 align-middle"
                    @click="playNodeAudio(node)"
                  >
                    <span>🔊</span>
                    <span>{{ node.label }}</span>
                  </button>
                  <button
                    v-else-if="node.type === 'ref'"
                    type="button"
                    class="inline font-bold text-indigo-600 dark:text-indigo-300 underline decoration-dotted underline-offset-2 hover:text-indigo-800 dark:hover:text-indigo-200 mx-0.5"
                    @click="jumpToWord(node.target)"
                  >
                    {{ node.label }}
                  </button>
                  <span
                    v-else-if="node.type === 'badge'"
                    class="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold"
                  >
                    {{ node.text }}
                  </span>
                  <span
                    v-else-if="node.type === 'text'"
                    :class="[
                      node.bold ? 'font-bold' : '',
                      node.italic ? 'italic' : '',
                      node.underline ? 'underline' : '',
                      node.sup ? 'text-xs align-super' : '',
                      node.sub ? 'text-xs align-sub' : '',
                      toneClass(node.tone)
                    ]"
                  >{{ node.text }}</span>
                </template>
              </div>
            </div>
          </template>
        </section>
      </div>
    </div>

    <template #footer>
      <button type="button" class="ui-button-secondary" @click="$emit('close')">关闭</button>
    </template>
  </UiDialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import UiDialog from './UiDialog.vue';
import api from '../api/client';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';

const props = defineProps({
  initialWord: { type: String, required: true },
  allowPick: Boolean
});

defineEmits(['close', 'pick-word']);

const currentWord = ref(props.initialWord);
const history = ref([]);
const articles = ref([]);
const available = ref(true);
const unavailableReason = ref('');
const activeTab = ref('all');
const loading = ref(false);
const error = ref('');
const audioError = ref('');

let controller = null;
let loadSerial = 0;

const tabs = computed(() => {
  const list = [{ key: 'all', label: `全部词典 (${articles.value.length})` }];
  for (const a of articles.value) {
    list.push({
      key: a.dict_id,
      label: a.dict_id === 'oald8' ? '牛津高阶 (OALD8)' : a.dict_id === 'mw11' ? '韦氏词典 (MW)' : '巴比伦英汉'
    });
  }
  return list;
});

const visibleArticles = computed(() => (
  activeTab.value === 'all' ? articles.value : articles.value.filter(a => a.dict_id === activeTab.value)
));

function toneClass(tone) {
  switch (tone) {
    case 'accent': return 'text-rose-600 dark:text-rose-300';
    case 'warn': return 'text-orange-600 dark:text-orange-300';
    case 'pos': return 'text-amber-700 dark:text-amber-300';
    case 'phonetic': return 'text-cyan-700 dark:text-cyan-300';
    case 'section': return 'text-fuchsia-700 dark:text-fuchsia-300';
    case 'muted': return 'text-slate-500 dark:text-slate-400';
    case 'strong': return 'text-slate-800 dark:text-slate-100';
    default: return 'text-slate-700 dark:text-slate-200';
  }
}

async function loadWord(word) {
  if (!word) return;
  stopDictionaryAudio();
  const serial = ++loadSerial;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  error.value = '';
  audioError.value = '';
  activeTab.value = 'all';

  try {
    const res = await api.getDictionaryArticle(word, 'all', controller.signal, { silentError: true, preserveError: true });
    if (serial !== loadSerial) return;
    available.value = Boolean(res.available);
    unavailableReason.value = res.reason || '';
    articles.value = Array.isArray(res.articles) ? res.articles : [];
  } catch (err) {
    if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') return;
    if (serial !== loadSerial) return;
    error.value = err?.message || '读取原词典失败';
  } finally {
    if (serial === loadSerial) loading.value = false;
  }
}

function jumpToWord(target) {
  const clean = String(target || '').trim();
  if (!clean || clean === currentWord.value) return;
  history.value = [...history.value, currentWord.value];
  currentWord.value = clean;
  loadWord(clean);
}

function goBack() {
  if (!history.value.length) return;
  const prev = history.value.at(-1);
  history.value = history.value.slice(0, -1);
  currentWord.value = prev;
  loadWord(prev);
}

async function playNodeAudio(node) {
  const serial = loadSerial;
  audioError.value = '';
  try {
    await playDictionaryAudio(node.url);
  } catch (err) {
    if (serial === loadSerial) audioError.value = err?.message || '发音播放失败';
  }
}

watch(() => props.initialWord, (next) => {
  history.value = [];
  currentWord.value = next;
  loadWord(next);
}, { immediate: true });

onBeforeUnmount(() => {
  loadSerial++;
  controller?.abort();
  stopDictionaryAudio();
});
</script>
