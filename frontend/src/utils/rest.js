// A rest countdown the child starts from the timer bar. It lives only on this device: the study timer
// is paused on the server as usual, and rest time is never recorded as study time.
export const REST_MINUTES = [5, 10, 15];
// A rest that ended long ago (the tablet slept, the child left) is not worth announcing any more.
const STALE_AFTER_MS = 60 * 60 * 1000;

const key = childId => `taskie_rest_${childId}`;
const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function saveRest(childId, minutes, now = Date.now(), storage = defaultStorage()) {
  if (!REST_MINUTES.includes(minutes)) throw new Error(`Unsupported rest length: ${minutes}`);
  const rest = { minutes, ends_at: now + minutes * 60000 };
  try { storage?.setItem(key(childId), JSON.stringify(rest)); } catch { /* still counts down in this page */ }
  return rest;
}

export function readRest(childId, now = Date.now(), storage = defaultStorage()) {
  try {
    const rest = JSON.parse(storage?.getItem(key(childId)) ?? 'null');
    if (!rest || !REST_MINUTES.includes(rest.minutes) || !Number.isFinite(rest.ends_at)) return null;
    if (now - rest.ends_at > STALE_AFTER_MS) { storage.removeItem(key(childId)); return null; }
    return rest;
  } catch {
    return null;
  }
}

export function clearRest(childId, storage = defaultStorage()) {
  try { storage?.removeItem(key(childId)); } catch { /* nothing saved */ }
}

export const restSecondsLeft = (rest, now = Date.now()) => Math.max(0, Math.ceil((rest.ends_at - now) / 1000));
