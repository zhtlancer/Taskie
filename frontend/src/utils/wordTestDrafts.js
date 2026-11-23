import { formDraftScope, serializeForm } from './formDrafts.js';
export const WORD_TEST_DRAFT_PREFIX = 'taskie_word_test_v1:';
const TTL = 24 * 60 * 60 * 1000;
export function wordTestScope(token, generation, childId, kind, recordId) {
  return formDraftScope(token, generation, {
    kind: `word-test-${kind}`,
    child_id: childId,
    record_id: recordId,
  });
}
export function wordTestDraftStore(storage = () => globalThis.sessionStorage, now = () => Date.now()) {
  const target = () => (typeof storage === 'function' ? storage() : storage);
  const key = (scope) => {
    if (!scope) throw new Error('无法确认本次测试的会话范围，请重新读取后再操作');
    return WORD_TEST_DRAFT_PREFIX + serializeForm(scope);
  };
  const keys = () =>
    Array.from({ length: target().length }, (_, i) => target().key(i)).filter((value) =>
      value?.startsWith(WORD_TEST_DRAFT_PREFIX),
    );
  return {
    read(scope) {
      const value = target().getItem(key(scope));
      if (!value) return null;
      let entry;
      try {
        entry = JSON.parse(value);
      } catch {
        target().removeItem(key(scope));
        return null;
      }
      if (
        !entry ||
        serializeForm(entry.scope) !== serializeForm(scope) ||
        !Number.isFinite(entry.updated_at) ||
        now() - entry.updated_at >= TTL ||
        !entry.payload ||
        typeof entry.payload !== 'object' ||
        Array.isArray(entry.payload) ||
        (entry.attempt &&
          (!/^[a-zA-Z0-9_-]{8,100}$/.test(entry.attempt.request_id) ||
            !entry.attempt.body ||
            entry.attempt.body.request_id !== entry.attempt.request_id))
      ) {
        target().removeItem(key(scope));
        return null;
      }
      return entry;
    },
    save(scope, payload, attempt = null) {
      const name = key(scope),
        value = JSON.stringify({ scope, payload, attempt, updated_at: now() });
      if (value.length > 50000) throw new Error('测试草稿过大，请缩短输入后重试');
      for (const old of keys()) {
        try {
          const entry = JSON.parse(target().getItem(old));
          if (!Number.isFinite(entry.updated_at) || now() - entry.updated_at >= TTL) target().removeItem(old);
        } catch {
          target().removeItem(old);
        }
      }
      if (keys().length >= 100 && !target().getItem(name))
        throw new Error('本标签页的测试草稿已满，请先完成已有测试');
      target().setItem(name, value);
    },
    remove(scope) {
      if (scope) target().removeItem(key(scope));
    },
    clearAll() {
      for (const name of keys()) target().removeItem(name);
    },
  };
}
export const wordTestDrafts = wordTestDraftStore();
export function clearWordTestDrafts() {
  try {
    wordTestDrafts.clearAll();
  } catch {}
}
if (typeof window !== 'undefined') window.addEventListener?.('taskie:data-restored', clearWordTestDrafts);
