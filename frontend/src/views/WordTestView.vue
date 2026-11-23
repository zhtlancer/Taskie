<template>
  <div class="min-h-screen bg-[var(--ui-page)] p-3 sm:p-5 pb-24">
    <main class="max-w-4xl mx-auto space-y-4">
      <header class="flex flex-wrap justify-between gap-3 items-center">
        <div>
          <h1 class="text-xl font-black">按词本自测</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
            独立练习，不改变日常复习进度、任务、积分或学习用时。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="busy"
            class="ui-button-secondary"
            @click="goLanguage(language === 'zh' ? 'en' : 'zh')"
          >
            {{ language === 'zh' ? '切换英语' : '切换语文' }}
          </button>
          <button type="button" :disabled="busy" class="ui-button-secondary" @click="goLauncher()">
            新建自测
          </button>
          <button type="button" :disabled="busy" class="ui-button-secondary" @click="goLauncher('history')">
            自测记录
          </button>
          <button
            type="button"
            :disabled="busy"
            class="ui-button-secondary"
            @click="router.push({ path: `/child/${childId}/word-study`, query: { language } })"
          >
            返回日常学习
          </button>
        </div>
      </header>
      <p
        v-if="notice"
        role="status"
        class="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm text-emerald-700 dark:text-emerald-300"
      >
        {{ notice }}
      </p>
      <p
        v-if="actionError || draftError"
        role="alert"
        class="rounded-xl bg-rose-50 dark:bg-rose-950/30 p-3 text-sm text-rose-700 dark:text-rose-300"
      >
        {{ actionError || draftError }}
      </p>

      <section
        v-if="!testId && route.query.view !== 'history'"
        class="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-4"
        aria-label="自测设置"
      >
        <h2 class="font-bold">{{ language === 'zh' ? '语文字词' : '英语单词' }}自测</h2>
        <fieldset :disabled="writing || Boolean(pendingCreate) || !createReady" class="space-y-4 min-w-0">
          <WordTestBookPicker v-model="form.book_ids" :child-id="childId" :language="language" />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block text-sm font-bold"
              >测试方式<select v-model="form.skill" aria-label="测试方式" class="ui-input block w-full mt-1">
                <option value="recognize">认读后自评</option>
                <option value="write">
                  {{ language === 'zh' ? '纸上听写后自评' : '输入拼写，系统判分' }}
                </option>
              </select></label
            >
            <label class="block text-sm font-bold"
              >词条范围<select
                v-model="form.scope_filter"
                aria-label="词条范围"
                class="ui-input block w-full mt-1"
              >
                <option value="all">全部</option>
                <option value="unmastered">未标记掌握</option>
                <option value="error_prone">易错字词</option>
              </select></label
            >
            <label class="block text-sm font-bold"
              >出题顺序<select
                v-model="form.order_mode"
                aria-label="出题顺序"
                class="ui-input block w-full mt-1"
              >
                <option value="ordered">按词本与词序</option>
                <option value="shuffle">随机一次后固定</option>
              </select></label
            >
            <label class="block text-sm font-bold"
              >题量<select v-model.number="form.limit" aria-label="题量" class="ui-input block w-full mt-1">
                <option :value="10">最多 10 题</option>
                <option :value="20">最多 20 题</option>
                <option :value="50">最多 50 题</option>
                <option :value="100">最多 100 题</option>
                <option :value="200">全部（最多 200 题）</option>
              </select></label
            >
          </div>
        </fieldset>
        <p v-if="pendingCreate && !writing" class="text-xs text-amber-700 dark:text-amber-300">
          创建结果尚未确认，请按原设置重试。刷新后也会保留这次请求。
        </p>
        <button
          type="button"
          :disabled="busy || !createReady || (!pendingCreate && !form.book_ids.length)"
          class="ui-button-primary w-full"
          @click="createTest"
        >
          {{ writing ? '正在保存…' : pendingCreate ? '重试确认创建' : '开始自测' }}
        </button>
      </section>

      <template v-if="testId">
        <PageState v-if="detailLoading && !activeTest" kind="loading" title="正在读取自测…" />
        <PageState
          v-else-if="detailError && !activeTest"
          kind="error"
          title="自测未能读取"
          :description="detailError"
          :busy="detailLoading"
          @retry="() => loadDetail()"
        />
        <div v-if="activeTest" class="space-y-4">
          <header
            class="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 space-y-2"
          >
            <h2 class="text-lg font-black [overflow-wrap:anywhere]">{{ activeTest.title }}</h2>
            <p class="text-sm">
              已确认 {{ activeTest.answered_count }} / {{ activeTest.total_count }} 题 · 正确
              {{ activeTest.correct_count }} 题
            </p>
            <p class="text-xs text-slate-500 dark:text-slate-400 [overflow-wrap:anywhere]">
              词本快照：{{ activeTest.book_names.join('、') }} · 开始于
              {{ formatTime(activeTest.created_at) }}
            </p>
            <p
              v-if="activeTest.excluded_no_definition || activeTest.excluded_invalid_pinyin"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              创建时排除：缺少英语释义 {{ activeTest.excluded_no_definition }} 项，拼音需补全
              {{ activeTest.excluded_invalid_pinyin }} 项。
            </p>
            <button type="button" :disabled="busy" class="ui-button-secondary" @click="() => loadDetail()">
              读取保存状态
            </button>
            <p v-if="detailError" role="alert" class="text-xs text-amber-700 dark:text-amber-300">
              {{ detailError }} 当前保留上次读取的题目。
            </p>
          </header>
          <template v-if="activeTest.status === 'in_progress' && currentItem">
            <div ref="questionPanel" tabindex="-1">
              <WordTestQuestion
                :item="currentItem"
                :language="activeTest.language"
                :skill="activeTest.skill"
                :total="activeTest.total_count"
                :revealed="revealed"
                v-model:typed="typed"
                :busy="busy"
                :pending="Boolean(pendingAnswer)"
                @reveal="revealed = true"
                @answer="answer"
              />
            </div>
            <div
              v-if="pendingAnswer && !writing"
              class="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2 text-sm text-amber-800 dark:text-amber-200"
            >
              <p>答案尚未确认。可以按原答案重试，或先读取保存状态；不会自动离线提交。</p>
              <button type="button" :disabled="busy" class="ui-button-primary" @click="answer()">
                重试确认答案
              </button>
            </div>
            <button
              v-if="currentItem.result"
              type="button"
              :disabled="busy"
              class="ui-button-primary w-full"
              @click="nextQuestion"
            >
              下一题
            </button>
          </template>
          <section
            v-if="activeTest.status === 'completed'"
            data-word-test-result
            class="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 space-y-4"
            aria-label="自测结果"
          >
            <h2 class="text-lg font-black">自测已完成 · {{ accuracy }}%</h2>
            <p class="text-sm">
              共 {{ activeTest.total_count }} 题，正确 {{ activeTest.correct_count }} 题，需复习
              {{ wrongItems.length }} 题。
            </p>
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{
                activeTest.language === 'en' && activeTest.skill === 'write'
                  ? '拼写由服务端按本场固定的大小写规则判分。'
                  : '本场结果来自认读或纸上听写后的自评。'
              }}
              完成于 {{ formatTime(activeTest.completed_at) }}。
            </p>
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                :disabled="busy || !wrongItems.length"
                class="ui-button-primary"
                @click="retryWrong"
              >
                {{ writing ? '保存中…' : pendingRetry ? '重试确认错题复测' : '只复测错题' }}
              </button>
              <button
                type="button"
                :disabled="busy || !wrongItems.length || Boolean(pendingRetry)"
                class="ui-button-secondary"
                @click="markWrong"
              >
                将错词标为易错
              </button>
            </div>
            <p v-if="pendingRetry && !writing" class="text-xs text-amber-700 dark:text-amber-300">
              错题复测的创建结果尚未确认，请按原请求重试。
            </p>
            <ul class="space-y-2">
              <li
                v-for="item in wrongItems"
                :key="item.id"
                class="rounded-xl bg-amber-50 dark:bg-amber-950/30 p-3 text-sm [overflow-wrap:anywhere]"
              >
                <strong>{{ item.text }}</strong><span v-if="item.pinyin"> · {{ item.pinyin }}</span
                ><span v-if="item.meaning_zh || item.meaning_en">
                  · {{ item.meaning_zh || item.meaning_en }}</span
                >
                <p v-if="item.typed_answer !== null">首次拼写：{{ item.typed_answer || '（空白）' }}</p>
              </li>
            </ul>
          </section>
          <details class="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <summary class="min-h-11 cursor-pointer font-bold">查看本场题目与首次答案</summary>
            <ol class="space-y-2">
              <li
                v-for="item in activeTest.items"
                :key="item.id"
                class="flex flex-wrap items-center gap-2 text-sm border-t border-slate-100 dark:border-slate-800 py-2"
              >
                <span class="min-w-0 flex-1 [overflow-wrap:anywhere]"
                  >{{ item.position + 1 }}.
                  {{ item.result || activeTest.skill !== 'write' ? item.text : '待作答题目' }} ·
                  {{ resultName(item.result) }}</span
                >
                <button
                  v-if="item.result"
                  type="button"
                  :disabled="busy"
                  class="ui-button-secondary"
                  :aria-label="'查看已确认第 ' + (item.position + 1) + ' 题'"
                  @click="reviewItemId = item.id"
                >
                  查看
                </button>
              </li>
            </ol>
          </details>
          <div v-if="reviewItem" class="space-y-2">
            <button type="button" :disabled="busy" class="ui-button-secondary" @click="reviewItemId = ''">
              收起题目详情</button
            ><WordTestQuestion
              :item="reviewItem"
              :language="activeTest.language"
              :skill="activeTest.skill"
              :total="activeTest.total_count"
              :revealed="true"
              :typed="reviewItem.typed_answer || ''"
              :busy="busy"
            />
          </div>
        </div>
      </template>

      <section
        id="word-test-history"
        class="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 space-y-3"
        aria-label="自测记录"
      >
        <div class="flex flex-wrap justify-between items-center gap-2">
          <h2 class="font-black">{{ language === 'en' ? '英语' : '语文' }}自测记录</h2>
          <button
            type="button"
            :disabled="writing || historyLoading"
            class="ui-button-secondary"
            @click="() => loadHistory(true)"
          >
            刷新记录
          </button>
        </div>
        <p v-if="historyError" role="alert" class="text-sm text-rose-600 dark:text-rose-300">
          {{ historyError }}
        </p>
        <p v-if="historyLoading" role="status" class="text-sm">正在读取记录…</p>
        <p
          v-if="historyLoaded && !historyLoading && !historyError && !history.length"
          class="text-sm text-slate-500 dark:text-slate-400"
        >
          还没有自测记录。
        </p>
        <button
          v-for="test in history"
          :key="test.id"
          type="button"
          :disabled="busy"
          class="block w-full min-h-11 text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-1"
          @click="navigateToTest(test.id)"
        >
          <span class="block font-bold [overflow-wrap:anywhere]">{{ test.title }}</span><span
            class="block text-xs text-slate-500 dark:text-slate-400"
            >{{
              test.status === 'completed'
                ? `已完成 · 正确 ${test.correct_count}/${test.total_count}`
                : `待继续 · 已确认 ${test.answered_count}/${test.total_count}`
            }}
            · {{ formatTime(test.created_at) }}</span
          >
        </button>
        <button
          v-if="nextCursor"
          type="button"
          :disabled="writing || historyLoading"
          class="ui-button-secondary w-full"
          @click="() => loadHistory(false)"
        >
          加载更多记录
        </button>
      </section>
    </main>
    <ChildTabBar :child-id="childId" />
  </div>
</template>
<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import api from '../api/client';
import ChildTabBar from '../components/ChildTabBar.vue';
import PageState from '../components/ParentPageState.vue';
import WordTestBookPicker from '../components/WordTestBookPicker.vue';
import WordTestQuestion from '../components/WordTestQuestion.vue';
import { useAsyncScope } from '../composables/useAsyncScope';
import { getToken, getDataGeneration } from '../utils/session';
import { newRequestId } from '../utils/requestId';
import { wordTestDrafts, wordTestScope } from '../utils/wordTestDrafts';
import { notifyWordBooks } from '../composables/useWordBooks';
import { stopDictionaryAudio } from '../utils/dictionaryAudio';
const route = useRoute(),
  router = useRouter();
const childId = computed(() => String(route.params.id || '')),
  language = computed(() => (route.query.language === 'en' ? 'en' : 'zh'));
const testId = computed(() => (typeof route.query.test === 'string' ? route.query.test : ''));
const initialForm = () => ({
  book_ids: typeof route.query.book === 'string' && route.query.book.length <= 100 ? [route.query.book] : [],
  skill: 'recognize',
  scope_filter: 'all',
  order_mode: 'ordered',
  limit: 200,
});
const form = ref(initialForm()),
  createReady = ref(false),
  pendingCreate = ref(null),
  pendingAnswer = ref(null),
  pendingRetry = ref(null);
const activeTest = ref(null),
  currentItemId = ref(''),
  reviewItemId = ref(''),
  typed = ref(''),
  revealed = ref(false),
  questionPanel = ref(null);
const writing = ref(false),
  detailLoading = ref(false),
  detailError = ref(''),
  actionError = ref(''),
  draftError = ref(''),
  notice = ref('');
const history = ref([]),
  historyLoading = ref(false),
  historyLoaded = ref(false),
  historyError = ref(''),
  nextCursor = ref(null);
const busy = computed(() => writing.value || detailLoading.value),
  currentItem = computed(() => activeTest.value?.items.find((item) => item.id === currentItemId.value));
const reviewItem = computed(() => activeTest.value?.items.find((item) => item.id === reviewItemId.value));
const wrongItems = computed(() => activeTest.value?.items.filter((item) => item.result === 'wrong') || []);
const accuracy = computed(() =>
  Math.round((100 * activeTest.value.correct_count) / activeTest.value.total_count),
);
const REQUEST = { silentError: true, preserveError: true, preserveNetworkError: true };
let detailSerial = 0,
  historySerial = 0,
  detailController,
  historyController,
  restoringCreate = false,
  restoringAnswer = false,
  internalNavigation = false;
const stopAudio = () => {
  stopDictionaryAudio();
  globalThis.speechSynthesis?.cancel();
};
function resetDetail() {
  detailSerial++;
  detailController?.abort();
  detailLoading.value = false;
  activeTest.value = null;
  currentItemId.value = '';
  reviewItemId.value = '';
  pendingAnswer.value = null;
  pendingRetry.value = null;
  typed.value = '';
  revealed.value = false;
  detailError.value = '';
  stopAudio();
}
const { capture: captureContext } = useAsyncScope(
  () => [childId.value, language.value],
  () => {
    resetDetail();
    historySerial++;
    historyController?.abort();
    history.value = [];
    historyLoading.value = false;
    historyLoaded.value = false;
    historyError.value = '';
    nextCursor.value = null;
    createReady.value = false;
    pendingCreate.value = null;
    writing.value = false;
    internalNavigation = false;
    form.value = initialForm();
    actionError.value = '';
    draftError.value = '';
    notice.value = '';
  },
);
const { capture: captureDetail } = useAsyncScope(
  () => [childId.value, language.value, testId.value],
  resetDetail,
);
const scope = (kind, recordId) =>
  wordTestScope(getToken(), getDataGeneration(), childId.value, kind, recordId);
const createScope = () => scope('create', language.value);
const answerScope = (item) =>
  activeTest.value && item ? scope('answer', JSON.stringify([activeTest.value.id, item.id])) : null;
const retryScope = () => (activeTest.value ? scope('retry', activeTest.value.id) : null);
const copy = (value) => JSON.parse(JSON.stringify(value));
const message = (error) => error?.message || String(error);
const formatTime = (value) => (value ? new Date(value).toLocaleString('zh-CN') : '');
const resultName = (value) => ({ correct: '正确', wrong: '需复习' })[value] || '未确认';
function validForm(value) {
  return (
    value &&
    Array.isArray(value.book_ids) &&
    value.book_ids.length <= 200 &&
    value.book_ids.every((id) => typeof id === 'string' && id && id.length <= 100) &&
    ['recognize', 'write'].includes(value.skill) &&
    ['all', 'unmastered', 'error_prone'].includes(value.scope_filter) &&
    ['ordered', 'shuffle'].includes(value.order_mode) &&
    Number.isSafeInteger(value.limit) &&
    value.limit > 0 &&
    value.limit <= 200
  );
}
function restoreCreate() {
  if (createReady.value || testId.value || !getDataGeneration() || !getToken()) return;
  restoringCreate = true;
  try {
    const entry = wordTestDrafts.read(createScope());
    const value = entry?.attempt?.body || entry?.payload?.form;
    if (
      entry &&
      (!validForm(value) ||
        (entry.attempt && (value.child_id !== childId.value || value.language !== language.value)))
    )
      throw new Error('测试草稿与当前小朋友或语言不一致，请重新选择。');
    if (value)
      form.value = {
        book_ids: [...value.book_ids],
        skill: value.skill,
        scope_filter: value.scope_filter,
        order_mode: value.order_mode,
        limit: value.limit,
      };
    if (!entry?.attempt && typeof route.query.book === 'string') form.value.book_ids = initialForm().book_ids;
    pendingCreate.value = entry?.attempt || null;
    draftError.value = '';
  } catch (error) {
    draftError.value = message(error);
  } finally {
    restoringCreate = false;
    createReady.value = true;
  }
}
function saveCreateDraft() {
  if (!createReady.value || restoringCreate || testId.value || pendingCreate.value) return;
  try {
    wordTestDrafts.save(createScope(), { form: copy(form.value) });
    draftError.value = '';
  } catch (error) {
    draftError.value = message(error);
  }
}
function restoreQuestion() {
  const item = currentItem.value;
  if (!item) return;
  restoringAnswer = true;
  pendingAnswer.value = null;
  typed.value = item.typed_answer || '';
  revealed.value = Boolean(item.result);
  try {
    const target = answerScope(item);
    if (item.result) wordTestDrafts.remove(target);
    else {
      const entry = wordTestDrafts.read(target);
      if (entry) {
        if (
          typeof entry.payload.typed !== 'string' ||
          entry.payload.typed.length > 1000 ||
          typeof entry.payload.revealed !== 'boolean' ||
          (entry.attempt &&
            (entry.attempt.target?.test_id !== activeTest.value.id ||
              entry.attempt.target?.item_id !== item.id))
        )
          throw new Error('本题草稿无法核对，请先读取保存状态。');
        if (entry.attempt) {
          const body = entry.attempt.body,
            spelling = activeTest.value.language === 'en' && activeTest.value.skill === 'write';
          if (
            spelling
              ? typeof body.typed_answer !== 'string' || body.typed_answer.length > 1000
              : !['correct', 'wrong'].includes(body.result)
          )
            throw new Error('本题待确认答案无法读取，请先核对保存状态。');
        }
        pendingAnswer.value = entry.attempt || null;
        typed.value = entry.attempt?.body.typed_answer ?? entry.payload.typed;
        revealed.value = entry.payload.revealed;
      }
    }
  } catch (error) {
    draftError.value = message(error);
  } finally {
    restoringAnswer = false;
  }
}
function saveQuestionDraft(attempt = pendingAnswer.value) {
  if (!currentItem.value || currentItem.value.result) return;
  wordTestDrafts.save(
    answerScope(currentItem.value),
    { typed: typed.value, revealed: revealed.value },
    attempt,
  );
}
watch(form, saveCreateDraft, { deep: true, flush: 'sync' });
watch(
  [typed, revealed],
  () => {
    if (!restoringAnswer && !pendingAnswer.value && currentItem.value && !currentItem.value.result) {
      try {
        saveQuestionDraft();
        draftError.value = '';
      } catch (error) {
        draftError.value = message(error);
      }
    }
  },
  { flush: 'sync' },
);
async function navigateToTest(id) {
  if (writing.value && !internalNavigation) return;
  const matches = captureContext();
  internalNavigation = true;
  try {
    await router.replace({
      path: `/child/${childId.value}/word-test`,
      query: { language: language.value, test: id },
    });
  } finally {
    if (matches()) internalNavigation = false;
  }
}
function goLauncher(view) {
  if (!busy.value)
    router.replace({
      path: `/child/${childId.value}/word-test`,
      query: { language: language.value, ...(view ? { view } : {}) },
    });
}
function goLanguage(lang) {
  if (!busy.value) router.replace({ path: `/child/${childId.value}/word-test`, query: { language: lang } });
}
async function loadHistory(reset = true) {
  if (!getToken()) return;
  const matches = captureContext(),
    request = ++historySerial,
    cursor = reset ? undefined : nextCursor.value;
  if (!reset && !cursor) return;
  historyController?.abort();
  historyController = new AbortController();
  historyLoading.value = true;
  historyError.value = '';
  try {
    const response = await api.getWordTests(
      childId.value,
      language.value,
      { cursor, limit: 20 },
      historyController.signal,
      REQUEST,
    );
    if (!matches() || request !== historySerial) return;
    history.value = reset
      ? response.items
      : [...new Map([...history.value, ...response.items].map((test) => [test.id, test])).values()];
    nextCursor.value = response.next_cursor;
    historyLoaded.value = true;
  } catch (error) {
    if (matches() && request === historySerial && error?.code !== 'ERR_CANCELED')
      historyError.value = message(error);
  } finally {
    if (matches() && request === historySerial) {
      historyLoading.value = false;
      restoreCreate();
    }
  }
}
async function loadDetail() {
  if (!testId.value || !getToken()) return;
  const matches = captureDetail(),
    request = ++detailSerial,
    id = testId.value,
    selected = currentItemId.value;
  detailController?.abort();
  detailController = new AbortController();
  detailLoading.value = true;
  detailError.value = '';
  try {
    const response = await api.getWordTest(id, detailController.signal, REQUEST);
    if (!matches() || request !== detailSerial) return;
    if (response.child_id !== childId.value)
      throw new Error('测试不属于当前小朋友，请从本人的自测记录打开。');
    if (response.language !== language.value) {
      await router.replace({ query: { ...route.query, language: response.language } });
      return;
    }
    activeTest.value = response;
    currentItemId.value = response.items.some((item) => item.id === selected)
      ? selected
      : response.items.find((item) => !item.result)?.id || response.items[0]?.id || '';
    restoreQuestion();
    const retry = wordTestDrafts.read(retryScope())?.attempt;
    if (retry && retry.target?.test_id !== response.id) throw new Error('复测草稿与本场记录不一致。');
    pendingRetry.value = retry || null;
  } catch (error) {
    if (matches() && request === detailSerial && error?.code !== 'ERR_CANCELED')
      detailError.value = message(error);
  } finally {
    if (matches() && request === detailSerial) detailLoading.value = false;
  }
}
async function createTest() {
  if (busy.value || !createReady.value) return;
  const matches = captureContext();
  actionError.value = '';
  draftError.value = '';
  try {
    const requestId = newRequestId();
    const attempt = pendingCreate.value || {
      request_id: requestId,
      body: { child_id: childId.value, language: language.value, ...copy(form.value), request_id: requestId },
    };
    wordTestDrafts.save(createScope(), { form: copy(form.value) }, attempt);
    pendingCreate.value = attempt;
    writing.value = true;
    const response = await api.createWordTest(attempt.body, REQUEST);
    if (!matches()) return;
    wordTestDrafts.remove(createScope());
    pendingCreate.value = null;
    internalNavigation = true;
    await navigateToTest(response.id);
    loadHistory(true);
  } catch (error) {
    if (matches()) {
      actionError.value = message(error);
      if (!error?.networkFailure && !(error?.status >= 500)) {
        pendingCreate.value = null;
        saveCreateDraft();
      }
    }
  } finally {
    if (matches()) {
      internalNavigation = false;
      writing.value = false;
    }
  }
}
async function answer(result) {
  if (busy.value || !currentItem.value || currentItem.value.result) return;
  const matches = captureDetail(),
    itemId = currentItem.value.id,
    id = activeTest.value.id;
  actionError.value = '';
  draftError.value = '';
  try {
    const requestId = newRequestId(),
      spelling = activeTest.value.language === 'en' && activeTest.value.skill === 'write';
    const attempt = pendingAnswer.value || {
      request_id: requestId,
      target: { test_id: id, item_id: itemId },
      body: { request_id: requestId, ...(spelling ? { typed_answer: typed.value } : { result }) },
    };
    saveQuestionDraft(attempt);
    pendingAnswer.value = attempt;
    writing.value = true;
    const response = await api.answerWordTest(id, itemId, attempt.body, REQUEST);
    if (!matches() || currentItemId.value !== itemId) return;
    detailSerial++;
    detailController?.abort();
    detailLoading.value = false;
    wordTestDrafts.remove(answerScope(currentItem.value));
    pendingAnswer.value = null;
    activeTest.value = {
      ...activeTest.value,
      ...response.test,
      items: activeTest.value.items.map((item) => (item.id === itemId ? response.item : item)),
    };
    restoreQuestion();
    if (activeTest.value.status === 'completed') {
      notice.value = '本场自测已完成。';
      notifyWordBooks(childId.value, language.value);
      loadHistory(true);
    }
  } catch (error) {
    if (matches()) {
      actionError.value = message(error);
      if (error?.status === 409) await loadDetail();
      else if (!error?.networkFailure && !(error?.status >= 500)) {
        pendingAnswer.value = null;
        try {
          saveQuestionDraft(null);
        } catch {}
      }
    }
  } finally {
    if (matches()) writing.value = false;
  }
}
function nextQuestion() {
  if (busy.value || pendingAnswer.value) return;
  currentItemId.value = activeTest.value.items.find((item) => !item.result)?.id || currentItemId.value;
  stopAudio();
  restoreQuestion();
  nextTick(() => questionPanel.value?.focus());
}
async function retryWrong() {
  if (busy.value || !activeTest.value || !wrongItems.value.length) return;
  const matches = captureDetail(),
    ownerMatches = captureContext(),
    id = activeTest.value.id;
  actionError.value = '';
  try {
    const requestId = newRequestId(),
      attempt = pendingRetry.value || {
        request_id: requestId,
        body: { request_id: requestId },
        target: { test_id: id },
      };
    wordTestDrafts.save(retryScope(), {}, attempt);
    pendingRetry.value = attempt;
    writing.value = true;
    const response = await api.retryWordTestWrong(id, attempt.body, REQUEST);
    if (!matches()) return;
    wordTestDrafts.remove(retryScope());
    pendingRetry.value = null;
    internalNavigation = true;
    await navigateToTest(response.id);
    loadHistory(true);
  } catch (error) {
    if (matches()) {
      actionError.value = message(error);
      if (!error?.networkFailure && !(error?.status >= 500)) {
        pendingRetry.value = null;
        wordTestDrafts.remove(retryScope());
      }
    }
  } finally {
    if (ownerMatches()) {
      internalNavigation = false;
      writing.value = false;
    }
  }
}
async function markWrong() {
  if (busy.value || !activeTest.value) return;
  const matches = captureDetail();
  writing.value = true;
  actionError.value = '';
  try {
    const result = await api.markWordTestWrong(activeTest.value.id, REQUEST);
    if (matches()) {
      notice.value = `易错标记：新增 ${result.added} 项，已标记 ${result.already} 项，原词条已删除 ${result.deleted} 项。`;
      notifyWordBooks(childId.value, language.value);
    }
  } catch (error) {
    if (matches()) actionError.value = message(error);
  } finally {
    if (matches()) writing.value = false;
  }
}
function loadContext() {
  if (!getToken()) return;
  loadHistory(true);
  if (testId.value) loadDetail();
  else restoreCreate();
}
watch(() => [childId.value, language.value], loadContext);
watch(testId, () => {
  if (testId.value) loadDetail();
  else {
    resetDetail();
    restoreCreate();
  }
});
onBeforeRouteLeave(() => !writing.value || internalNavigation);
onBeforeRouteUpdate(() => !writing.value || internalNavigation);
onMounted(() => {
  loadContext();
  window.addEventListener('taskie:data-restored', loadContext);
  window.addEventListener('taskie:session-changed', loadContext);
});
onBeforeUnmount(() => {
  detailSerial++;
  historySerial++;
  detailController?.abort();
  historyController?.abort();
  stopAudio();
  window.removeEventListener('taskie:data-restored', loadContext);
  window.removeEventListener('taskie:session-changed', loadContext);
});
</script>
