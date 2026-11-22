import { ref, watch, onBeforeUnmount } from 'vue';
import api from '../api/client';
import { useAsyncScope } from './useAsyncScope';
import { getToken, currentRole } from '../utils/session';
export const BOOK_REQUEST = { silentError: true, preserveError: true, preserveNetworkError: true };
export function useWordBooks(childId, language) {
  const books = ref([]), loading = ref(false), error = ref('');
  const role = ref(currentRole());
  let serial = 0, controller;
  const { capture } = useAsyncScope(() => [childId(), language()], () => {
    serial++; controller?.abort(); books.value = []; error.value = ''; loading.value = false; role.value = currentRole();
  });
  async function load() {
    if (!childId() || !getToken()) return;
    const matches = capture(), request = ++serial;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal, target = childId(), lang = language();
    loading.value = true; error.value = '';
    try {
      const all = []; let offset = 0;
      do {
        const result = await api.getWordBooks(target, lang, { offset, limit: 200 }, signal, BOOK_REQUEST);
        if (!matches() || request !== serial) return;
        all.push(...result.items); offset = result.next_offset;
      } while (offset !== null);
      books.value = all;
    } catch (err) {
      if (matches() && request === serial && err?.code !== 'ERR_CANCELED') error.value = err?.message || String(err);
    } finally { if (matches() && request === serial) loading.value = false; }
  }
  const changed = event => {
    if (!event.detail || (event.detail.childId === childId() && event.detail.language === language())) load();
  };
  watch(() => [childId(), language()], load, { immediate: true });
  window.addEventListener('taskie:word-books-changed', changed);
  window.addEventListener('taskie:data-restored', load);
  window.addEventListener('taskie:session-changed', load);
  onBeforeUnmount(() => {
    serial++; controller?.abort();
    window.removeEventListener('taskie:word-books-changed', changed);
    window.removeEventListener('taskie:data-restored', load);
    window.removeEventListener('taskie:session-changed', load);
  });
  return { books, loading, error, load, role };
}
export const notifyWordBooks = (childId, language) => window.dispatchEvent(new CustomEvent('taskie:word-books-changed', { detail: { childId, language } }));
