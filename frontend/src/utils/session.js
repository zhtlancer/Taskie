import { pendingWriteStore } from './requestId.js';

const key = role => `taskie_${role}_token`;
function tokenPayload(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch { return null; }
}
export function getToken(role) {
  if (role) return sessionStorage.getItem(key(role));
  return getToken('parent') || getToken('child');
}
export function getDataGeneration() { return sessionStorage.getItem('taskie_data_generation'); }
export function saveDataGeneration(generation, expectedToken = getToken()) {
  if (typeof generation !== 'string' || !generation) throw new Error('无法确认数据代次，请重新登录后重试');
  if (!expectedToken || getToken() !== expectedToken) throw new Error('登录状态已变更，请重新操作');
  sessionStorage.setItem('taskie_data_generation', generation);
}
export function clearDataGeneration() { sessionStorage.removeItem('taskie_data_generation'); }
export function saveToken(role, token, generation) {
  // Token rotation is not an identity change. Reauthentication retains the exact
  // uncertain operations owned by this identity, even after a 401 removed its token.
  const payload = tokenPayload(token);
  pendingWriteStore.retainIdentity(role, payload?.role === 'child' ? payload.child_id : null, generation);
  clearTokens();
  sessionStorage.setItem(key(role), token);
  if (generation) saveDataGeneration(generation, token);
}
export function clearTokens() {
  for (const role of ['parent', 'child']) sessionStorage.removeItem(key(role));
  sessionStorage.removeItem('parent_auth');
  clearDataGeneration();
}
// Only deliberate logout/account switch and successful data restore discard bodies.
export function endSession() {
  clearTokens();
  pendingWriteStore.clear();
}
// Set while the parent signed in with the default PIN and must replace it first.
export function mustChangePin() { return sessionStorage.getItem('parent_must_change_pin') === 'true'; }
export function setMustChangePin(value) {
  if (value) sessionStorage.setItem('parent_must_change_pin', 'true');
  else sessionStorage.removeItem('parent_must_change_pin');
}
export function hasSession(role, childId) {
  const token = getToken(role);
  if (!token) return false;
  const payload = tokenPayload(token);
  return Boolean(payload && payload.exp * 1000 > Date.now() && payload.role === role && (!childId || payload.child_id === childId));
}
// The role the API sees: requests carry the parent session when there is one.
export function currentRole() {
  return tokenPayload(getToken())?.role || null;
}

export function isParentSession() {
  return currentRole() === 'parent' && hasSession('parent');
}

// Reauthentication from a board may only return to a local board route.
export function parentLoginReturnPath(value) {
  return typeof value === 'string' && /^\/child\/[^/?#]+\/today$/.test(value) ? value : '/parent/dashboard';
}
