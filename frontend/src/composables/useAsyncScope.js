import { watch, onBeforeUnmount } from 'vue';
import { getToken, getDataGeneration } from '../utils/session.js';

// Capture the owner of a callback, including close/reopen and same-child restores.
// Writes may already have reached the server; only their obsolete UI callbacks
// are discarded. Each caller still serializes repeated requests within a scope.
export function useAsyncScope(source, onInvalidate) {
  let alive = true;
  let epoch = 0;
  function invalidate() {
    epoch++;
    onInvalidate?.();
  }
  watch(source, (next, previous) => {
    if (next.length !== previous.length || next.some((value, index) => value !== previous[index])) invalidate();
  }, { flush: 'sync' });
  window.addEventListener('taskie:session-changed', invalidate);
  window.addEventListener('taskie:data-restored', invalidate);
  onBeforeUnmount(() => {
    alive = false;
    invalidate();
    window.removeEventListener('taskie:session-changed', invalidate);
    window.removeEventListener('taskie:data-restored', invalidate);
  });
  function capture() {
    const requestEpoch = epoch;
    const token = getToken();
    let generation = getDataGeneration();
    return () => {
      if (!alive || requestEpoch !== epoch || token !== getToken()) return false;
      const currentGeneration = getDataGeneration();
      // A request can start while the API is calibrating an unknown generation.
      // Adopt its first known value; restores and session changes still invalidate
      // the epoch, and subsequent changes of a known generation remain stale.
      if (generation === null) generation = currentGeneration;
      return generation === currentGeneration;
    };
  }
  return { capture };
}
