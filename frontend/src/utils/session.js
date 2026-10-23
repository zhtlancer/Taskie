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
export function saveToken(role, token) {
  // Token rotation is not an identity change. Reauthentication retains the exact
  // uncertain operations owned by this identity, even after a 401 removed its token.
  const payload = tokenPayload(token);
  pendingWriteStore.retainIdentity(role, payload?.role === 'child' ? payload.child_id : null);
  clearTokens();
  sessionStorage.setItem(key(role), token);
}
export function clearTokens() {
  for (const role of ['parent', 'child']) sessionStorage.removeItem(key(role));
  sessionStorage.removeItem('parent_auth');
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
