// Task timing: a timer runs for at most one task of a child at a time. It keeps the seconds of
// earlier runs (timer_elapsed_seconds) plus when the current run started (timer_started_at).
const MAX_DURATION_SECONDS = 12 * 3600;
const MAX_EXPECTED_MINUTES = 600;

function timerSeconds(row, now = Date.now()) {
  const running = row.timer_started_at ? Math.max(0, Math.floor((now - Date.parse(row.timer_started_at)) / 1000)) : 0;
  return Math.min(MAX_DURATION_SECONDS, (row.timer_elapsed_seconds || 0) + running);
}

// The timer as clients show it: seconds so far, counted on the server so device clocks never matter.
function describeTimer(row, now = Date.now()) {
  return { track_time: Boolean(row.track_time), timer_running: Boolean(row.timer_started_at), timer_seconds: timerSeconds(row, now) };
}

// A duration entered by hand, in seconds; null clears it.
function validateDuration(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 60 || value > MAX_DURATION_SECONDS) {
    throw { status: 400, message: '用时必须在 1 分钟到 12 小时之间' };
  }
  return value;
}

// The duration recorded when a task is done or progress is logged: an entered one (or none, given
// null) wins; otherwise the timer's total if it ran.
function resolveDuration(row, entered) {
  if (entered !== undefined) {
    const seconds = validateDuration(entered);
    return { seconds, source: seconds === null ? null : 'manual' };
  }
  const total = timerSeconds(row);
  return total > 0 ? { seconds: total, source: 'timer' } : { seconds: null, source: null };
}

// Timing settings of a template or long-term task: whether time is recorded, and optionally how many
// minutes a session should take.
function validateTiming({ track_time = false, expected_minutes = null }) {
  if (typeof track_time !== 'boolean') throw { status: 400, message: '“记录用时”设置无效' };
  if (expected_minutes !== null && (!Number.isSafeInteger(expected_minutes) || expected_minutes < 1 || expected_minutes > MAX_EXPECTED_MINUTES)) {
    throw { status: 400, message: `预计用时必须为 1 至 ${MAX_EXPECTED_MINUTES} 分钟` };
  }
  return { track_time, expected_minutes: track_time ? expected_minutes : null };
}

module.exports = { MAX_DURATION_SECONDS, timerSeconds, describeTimer, validateDuration, resolveDuration, validateTiming };
