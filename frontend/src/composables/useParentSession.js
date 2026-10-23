import { onUnmounted, ref } from 'vue';
import { isParentSession } from '../utils/session.js';

// sessionStorage and JWT expiry are not reactive. Refresh on resume and while a
// page is open, and expose the same check for actions suspended by a confirmation.
export function useParentSession() {
  const asParent = ref(isParentSession());
  const refreshParentSession = () => (asParent.value = isParentSession());
  const timer = setInterval(refreshParentSession, 1000);
  window.addEventListener('pageshow', refreshParentSession);
  document.addEventListener('visibilitychange', refreshParentSession);
  onUnmounted(() => {
    clearInterval(timer);
    window.removeEventListener('pageshow', refreshParentSession);
    document.removeEventListener('visibilitychange', refreshParentSession);
  });
  return { asParent, refreshParentSession };
}
