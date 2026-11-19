<template>
  <UiDialog :title="word.word" wide :busy="busy" @close="$emit('close')">
    <template #subtitle>
      <div class="flex flex-wrap items-center gap-2">
        <span v-if="word.pos" class="px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 font-bold">
          {{ word.pos }}
        </span>
        <span v-if="word.phonetic_uk" class="font-mono text-cyan-700 dark:text-cyan-300">英 /{{ word.phonetic_uk }}/</span>
        <span v-if="word.phonetic_us" class="font-mono text-cyan-700 dark:text-cyan-300">美 /{{ word.phonetic_us }}/</span>
        <span v-else-if="word.phonetic" class="font-mono text-cyan-700 dark:text-cyan-300">/{{ word.phonetic }}/</span>
      </div>
    </template>

    <div class="space-y-4">
      <!-- Pronunciation & Original Dictionary Bar -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="clip in dictAudio.slice(0, 3)"
          :key="clip.id"
          type="button"
          class="min-h-11 px-3 py-1.5 rounded-xl bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-800 text-xs font-bold text-brand-700 dark:text-brand-300 flex items-center gap-1"
          @click="playClip(clip.url)"
        >
          <span>🔊</span>
          <span>{{ clip.label }}</span>
        </button>

        <button
          type="button"
          class="min-h-11 px-3.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs font-black text-indigo-700 dark:text-indigo-300"
          @click="articleOpen = true"
        >
          📖 查看完整原词典
        </button>

        <button
          v-if="!editing"
          type="button"
          class="min-h-11 px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200"
          @click="startEdit"
        >
          ✏️ {{ role === 'parent' ? '编辑释义与单元' : '编辑释义' }}
        </button>
      </div>

      <p v-if="audioError" role="alert" class="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200">
        {{ audioError }}
      </p>

      <p v-if="error || localError" role="alert" class="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-bold text-rose-700 dark:text-rose-200">
        {{ localError || error }}
      </p>

      <!-- Display Mode -->
      <div v-if="!editing" class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-2.5 text-sm">
        <div v-for="(sense, index) in word.senses" :key="sense.id" class="space-y-1 [overflow-wrap:anywhere]" :data-sense-detail="sense.id">
          <p class="text-xs font-bold text-brand-700 dark:text-brand-300">义项 {{ index + 1 }}{{ sense.id === word.primary_sense_id ? ' · 学习释义' : '' }} <span v-if="sense.pos">{{ sense.pos }}</span></p>
          <p class="font-bold text-slate-800 dark:text-slate-100">{{ sense.definition_zh || (sense.definition_en ? '' : '（未填写）') }}</p>
          <p v-if="sense.definition_en" class="text-slate-700 dark:text-slate-200">{{ sense.definition_en }}</p>
          <p v-if="sense.example" class="text-slate-700 dark:text-slate-200">例句：{{ sense.example }}</p>
          <p v-if="sense.source" class="text-xs text-slate-500 dark:text-slate-400">来源：{{ sense.source.name || sense.source.dict_id }} · {{ sense.source.headword }}</p>
        </div>
        <div v-if="word.textbook || word.unit" class="flex flex-wrap gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
          <span v-if="word.textbook" class="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">教材：{{ word.textbook }}</span>
          <span v-if="word.unit" class="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">单元：{{ word.unit }}</span>
        </div>
        <p v-if="word.strict_case" class="text-xs font-bold text-amber-700 dark:text-amber-300">默写规则：严格区分大小写</p>
        <div v-if="word.note">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">记忆笔记：</span>
          <p class="mt-0.5 text-slate-700 dark:text-slate-200">{{ word.note }}</p>
        </div>
      </div>

      <!-- Edit Mode -->
      <div v-else class="rounded-2xl border border-brand-200 dark:border-brand-800 bg-brand-50/30 dark:bg-brand-950/20 p-4 space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-black text-slate-800 dark:text-slate-100">编辑词条内容</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            英文词条
            <input v-model="editForm.word" type="text" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold" />
          </label>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            英式音标
            <input v-model="editForm.phonetic_uk" type="text" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold" />
          </label>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            美式音标
            <input v-model="editForm.phonetic_us" type="text" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold" />
          </label>
        </div>
        <EnglishSensesEditor v-model="editForm" :candidates="dictionaryCandidates" :disabled="busy" />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            教材/分类
            <input v-model="editForm.textbook" :disabled="role !== 'parent'" type="text" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold" />
          </label>
          <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
            单元
            <input v-model="editForm.unit" :disabled="role !== 'parent'" type="text" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold" />
          </label>
        </div>
        <p v-if="role !== 'parent'" class="text-xs font-bold text-slate-500 dark:text-slate-400">教材和单元由家长设置。</p>
        <label class="block text-xs font-bold text-slate-600 dark:text-slate-300">
          记忆笔记
          <input v-model="editForm.note" type="text" class="mt-1 w-full min-h-11 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-bold" />
        </label>
        <label class="flex items-center gap-2 min-h-11 text-xs font-bold text-slate-700 dark:text-slate-200">
          <input v-model="editForm.strict_case" :disabled="busy" type="checkbox" class="w-5 h-5 accent-brand-500" />
          默写时严格区分大小写
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">修改规则仅影响后续生成的学习项，旧清单继续使用原规则。</p>
        <EnglishCaseConfirmation v-model="editForm.confirmed_case_variants" :word="editForm.word || ''" :variants="caseVariants" :disabled="busy" />
        <div class="flex flex-wrap gap-2 justify-end">
          <button type="button" :disabled="savingEdit" class="ui-button-secondary" @click="editing = false">取消</button>
          <button type="button" :disabled="busy || !caseConfirmed" class="ui-button-primary" @click="saveEdit">
            {{ savingEdit ? '保存中…' : '保存修改' }}
          </button>
        </div>
      </div>

      <!-- Categories -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold text-slate-500 dark:text-slate-400">分类标记（去掉分类需要家长操作）：</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="cat in ENGLISH_CATEGORIES"
            :key="cat.key"
            type="button"
            :disabled="busy || savingEdit"
            :aria-pressed="word.categories?.includes(cat.key)"
            class="min-h-11 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all"
            :class="word.categories?.includes(cat.key)
              ? cat.chip
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'"
            @click="onToggleCategory(cat.key)"
          >
            {{ cat.icon }} {{ cat.label }}
          </button>
        </div>
      </div>

      <!-- Confirm Delete -->
      <div v-if="confirmDelete" class="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-3 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-rose-800 dark:text-rose-200">
        <span>确认将“{{ word.word }}”移出单词本吗？已有学习统计记录会保留快照。</span>
        <div class="flex gap-2">
          <button type="button" :disabled="busy" class="min-h-11 px-3 rounded-xl bg-rose-600 text-white" @click="$emit('delete', word.id)">确认移出</button>
          <button type="button" :disabled="busy" class="min-h-11 px-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600" @click="confirmDelete = false">取消</button>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="w-full flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          :disabled="busy || savingEdit || (role !== 'parent' && Boolean(word.categories?.length))"
          class="min-h-11 px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-xs font-bold disabled:opacity-45"
          :title="role !== 'parent' && word.categories?.length ? '有分类标记的单词需由家长移出' : '移出单词本'"
          @click="confirmDelete = true"
        >
          {{ role !== 'parent' && word.categories?.length ? '🔒 有分类需家长移出' : '🗑️ 移出单词本' }}
        </button>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="busy || savingEdit"
            class="min-h-11 px-4 py-2 rounded-xl text-xs font-black transition-all"
            :class="word.is_mastered
              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
              : 'bg-brand-500 text-white'"
            @click="$emit('toggle-master', word.id)"
          >
            {{ word.is_mastered ? '✅ 已掌握' : '标记已掌握' }}
          </button>
          <button type="button" :disabled="busy || savingEdit" class="ui-button-secondary" @click="$emit('close')">关闭</button>
        </div>
      </div>
    </template>

    <DictionaryArticleDrawer
      v-if="articleOpen"
      :initial-word="word.word"
      @close="articleOpen = false"
    />
  </UiDialog>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import UiDialog from './UiDialog.vue';
import DictionaryArticleDrawer from './DictionaryArticleDrawer.vue';
import EnglishSensesEditor from './EnglishSensesEditor.vue';
import { withEnglishSenses, sensesFromEntry } from '../utils/englishSenses';
import EnglishCaseConfirmation from './EnglishCaseConfirmation.vue';
import api from '../api/client';
import { currentRole } from '../utils/session';
import { useEnglishWordStore } from '../stores/englishWord';
import { playDictionaryAudio, stopDictionaryAudio } from '../utils/dictionaryAudio';
import { ENGLISH_CATEGORIES, toggleEnglishCategory, identityKey, englishCaseVariants } from '../utils/englishWord';
import { useAsyncScope } from '../composables/useAsyncScope';

const props = defineProps({
  word: { type: Object, required: true },
  busy: Boolean,
  error: { type: String, default: '' }
});

const emit = defineEmits(['close', 'toggle-master', 'delete', 'updated']);
const store = useEnglishWordStore();
const role = ref(currentRole());

const dictMatch = ref(null);
const dictAudio = computed(() => dictMatch.value?.audio || []);
const audioError = ref('');
const localError = ref('');
const articleOpen = ref(false);
const confirmDelete = ref(false);
const editing = ref(false);
const savingEdit = ref(false);
const savingCategories = ref(false);
const dictionaryCandidates = computed(() => identityKey(editForm.value.word) === identityKey(props.word.word) ? dictMatch.value?.senses || [] : []);

const editForm = ref({});
const serverCaseVariants = ref([]);
const caseVariants = computed(() => identityKey(editForm.value.word) === identityKey(props.word.word) ? []
  : englishCaseVariants(editForm.value.word, [...store.words.filter(word => word.id !== props.word.id).map(word => word.word), ...serverCaseVariants.value]));
const caseConfirmed = computed(() => caseVariants.value.every(word => editForm.value.confirmed_case_variants?.includes(word)));
watch(() => editForm.value.word, () => {
  editForm.value.confirmed_case_variants = [];
  serverCaseVariants.value = [];
}, { flush: 'sync' });
const busy = computed(() => props.busy || savingEdit.value || savingCategories.value || store.isBusy(props.word.id));
let audioController = null;
const { capture } = useAsyncScope(() => [props.word.id, props.word.word, props.word.child_id, store.scopeGeneration], () => {
  role.value = currentRole();
  stopDictionaryAudio();
  audioController?.abort();
  dictMatch.value = null;
  confirmDelete.value = false;
  articleOpen.value = false;
  editing.value = false;
  savingEdit.value = false;
  savingCategories.value = false;
  localError.value = '';
  audioError.value = '';
});
onBeforeUnmount(() => audioController?.abort());

async function loadDictionaryAudioForWord(targetWord) {
  const matchesScope = capture();
  audioController?.abort();
  audioController = new AbortController();
  dictMatch.value = null;
  try {
    const res = await api.lookupDictionary(targetWord, audioController.signal, { silentError: true });
    const match = res?.exact_matches?.find(m => m.word === targetWord) || res?.exact_matches?.[0] || null;
    if (matchesScope()) dictMatch.value = match;
  } catch {}
}

watch([() => props.word.id, () => props.word.word, () => props.word.child_id, () => store.scopeGeneration], () => {
  if (props.word.word) loadDictionaryAudioForWord(props.word.word);
}, { immediate: true });

function startEdit() {
  if (busy.value) return;
  editForm.value = withEnglishSenses({
    word: props.word.word,
    pos: props.word.pos || '',
    phonetic_uk: props.word.phonetic_uk || '',
    phonetic_us: props.word.phonetic_us || '',
    definition_zh: props.word.definition_zh || '',
    definition_en: props.word.definition_en || '',
    textbook: props.word.textbook || '',
    unit: props.word.unit || '',
    note: props.word.note || '',
    strict_case: Boolean(props.word.strict_case), confirmed_case_variants: []
  }, sensesFromEntry(props.word), props.word.primary_sense_id);
  editing.value = true;
}

async function saveEdit() {
  if (busy.value) return;
  savingEdit.value = true;
  localError.value = '';
  const matchesScope = capture();
  const targetWord = identityKey(editForm.value.word);
  try {
    const payload = {
      ...editForm.value,
      phonetic: editForm.value.phonetic_uk || editForm.value.phonetic_us || ''
    };
    if (role.value !== 'parent') {
      delete payload.textbook;
      delete payload.unit;
    }
    const updated = await store.updateWord(props.word.id, payload);
    if (matchesScope() && updated) {
      editing.value = false;
      emit('updated', updated);
    }
  } catch (err) {
    if (matchesScope() && targetWord === identityKey(editForm.value.word) && err?.code === 'ENGLISH_CASE_CONFIRMATION_REQUIRED') {
      serverCaseVariants.value = err.conflicts?.find(item => item.word === targetWord)?.variants || [];
    }
    if (matchesScope()) localError.value = typeof err === 'string' ? err : err?.message || '保存失败，请重试';
  } finally {
    if (matchesScope()) savingEdit.value = false;
  }
}

async function onToggleCategory(key) {
  if (busy.value) return;
  localError.value = '';
  const { categories, blocked } = toggleEnglishCategory(props.word.categories || [], key, role.value);
  if (blocked) {
    localError.value = '只有家长可以去掉分类标记';
    return;
  }
  const matchesScope = capture();
  savingCategories.value = true;
  try {
    const updated = await store.setCategories(props.word.id, categories);
    if (matchesScope() && updated) emit('updated', updated);
  } catch (err) {
    if (matchesScope()) localError.value = typeof err === 'string' ? err : err?.message || '更新分类失败';
  } finally {
    if (matchesScope()) savingCategories.value = false;
  }
}

async function playClip(url) {
  const matchesScope = capture();
  audioError.value = '';
  try {
    await playDictionaryAudio(url);
  } catch (err) {
    if (matchesScope()) audioError.value = err?.message || '发音播放失败';
  }
}
</script>
