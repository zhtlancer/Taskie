import { pendingWriteStore } from './requestId.js';

const key = role => `taskie_${role}_token`;
export function getToken(role) {
  if (role) return sessionStorage.getItem(key(role));
  return getToken('parent') || getToken('child');
}
export function saveToken(role, token) {
  // Signing in starts a fresh local session, even when the new role is also "parent".
  if (getToken(role) !== token) pendingWriteStore.clear();
  sessionStorage.setItem(key(role), token);
}
export function clearTokens() {
  for (const role of ['parent', 'child']) sessionStorage.removeItem(key(role));
  sessionStorage.removeItem('parent_auth');
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
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 > Date.now() && payload.role === role && (!childId || payload.child_id === childId);
  } catch { return false; }
}
// The role the API sees: requests carry the parent session when there is one.
export function currentRole() {
  const token = getToken();
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role || null;
  } catch { return null; }
}
