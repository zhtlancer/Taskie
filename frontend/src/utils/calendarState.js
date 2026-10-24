import { ref, computed } from 'vue';
import { businessDate } from './businessDate.js';
import { FAMILY_DATE_REQUIRED } from './calendarWriteGuard.js';

export function createCalendarState(fetchCalendar, { confirmed = ref(false), clock = () => Date.now() } = {}) {
  const timeZone = ref(null), ready = confirmed, loading = ref(false), error = ref('');
  const now = ref(clock());
  const today = computed(() => businessDate(now.value, timeZone.value));
  const refreshToday = () => { now.value = clock(); };
  let pending, loaded = false, stopClock;
  function load({ force = false } = {}) {
    if (pending) return pending;
    if (loaded && !force) return Promise.resolve();
    loading.value = true;
    ready.value = false;
    pending = (async () => {
      try {
        const result = await fetchCalendar();
        if (!result?.time_zone) throw new Error('Missing family time zone');
        new Intl.DateTimeFormat('en', { timeZone: result.time_zone }).format();
        timeZone.value = result.time_zone;
        refreshToday();
        ready.value = true;
        error.value = '';
      } catch {
        timeZone.value = 'UTC'; // Read-only display; never authorizes a write.
        error.value = `无法读取家庭时区，暂按 UTC 显示日期和时间。${FAMILY_DATE_REQUIRED}`;
      } finally { loading.value = false; loaded = true; }
    })().finally(() => { pending = null; });
    return pending;
  }
  function start() {
    if (stopClock) return;
    // Preserve immediate midnight invalidation for open course confirmations.
    const tick = setInterval(refreshToday, 1000);
    const resume = () => { if (!document.hidden) refreshToday(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', refreshToday);
    stopClock = () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', refreshToday);
      stopClock = undefined;
    };
  }
  const stop = () => stopClock?.();
  return { timeZone, ready, today, loading, error, load, refreshToday, start, stop };
}
