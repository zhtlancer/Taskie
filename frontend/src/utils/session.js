const key = role => `taskie_${role}_token`;
export function getToken(role) {
  if (role) return sessionStorage.getItem(key(role));
  return getToken('parent') || getToken('child');
}
export function saveToken(role, token) { sessionStorage.setItem(key(role), token); }
export function clearTokens() {
  for (const role of ['parent', 'child']) sessionStorage.removeItem(key(role));
  sessionStorage.removeItem('parent_auth');
}
export function hasSession(role, childId) {
  const token = getToken(role);
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000 > Date.now() && payload.role === role && (!childId || payload.child_id === childId);
  } catch { return false; }
}
