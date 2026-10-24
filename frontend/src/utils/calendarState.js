import { ref } from 'vue';

// One request per app lifetime, shared by every route. No device/Shanghai guess while loading.
export function createCalendarState(fetchCalendar) {
  const timeZone = ref(null), loading = ref(false), error = ref('');
  let pending;
  function load() {
    if (pending) return pending;
    loading.value = true;
    pending = (async () => {
      try {
        const result = await fetchCalendar();
        if (!result?.time_zone) throw new Error('Missing family time zone');
        new Intl.DateTimeFormat('en', { timeZone: result.time_zone }).format();
        timeZone.value = result.time_zone;
      } catch {
        timeZone.value = 'UTC';
        error.value = '无法读取家庭时区，暂按 UTC 显示日期和时间。请重新读取家庭时区后再核对日期。';
      } finally { loading.value = false; }
    })();
    return pending;
  }
  return { timeZone, loading, error, load };
}
