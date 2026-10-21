// Task timers count on the server; the board keeps a running one ticking from when it was loaded.
export const LONG_TIMER_SECONDS = 3 * 3600;
export const MAX_TIMER_SECONDS = 12 * 3600;
export const usesStudySessions = task => Boolean(task.homework ||
  (!['goal', 'study'].includes(task.origin) && (task.track_time || task.study_sessions)));

export const withClock = (item, loadedAt = Date.now()) => ({ ...item, timer_loaded_at: loadedAt });

export function liveSeconds(item, now = Date.now()) {
  const base = item.timer_seconds || 0;
  if (!item.timer_running) return base;
  return base + Math.max(0, Math.floor((now - (item.timer_loaded_at ?? now)) / 1000));
}

// The running-timer bar's link back to its task: a study session reopens its record, a plain or
// long-term timer brings its card into view.
export function timerTarget(timer) {
  if (timer.kind !== 'session') return { focus: timer.id };
  return timer.record_id ? { homework: timer.record_id } : { study: timer.id };
}

// 12:34, or 1:02:03 past an hour.
export function formatClock(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// 23 分钟, 1 小时 5 分钟; under half a minute reads as less than a minute.
export function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '不到 1 分钟';
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} 分钟`;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}

// Against the expected minutes: time left, or how far over.
export function paceLabel(seconds, expectedMinutes) {
  if (!expectedMinutes) return null;
  const left = expectedMinutes * 60 - seconds;
  return left >= 0
    ? { over: false, text: `还剩 ${Math.max(1, Math.ceil(left / 60))} 分钟` }
    : { over: true, text: `超时 ${Math.ceil(-left / 60)} 分钟` };
}

// Finishing a timed task asks for the time when the timer barely ran (under a minute, likely never
// started) or ran so long it was probably left on.
export function needsDurationPrompt(item, now = Date.now()) {
  const seconds = liveSeconds(item, now);
  return seconds < 60 || seconds > LONG_TIMER_SECONDS;
}
