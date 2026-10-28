export const DRAFT_PREFIX = 'taskie_form_draft_v1:';
export const DRAFT_TTL = 7 * 86400000;
export const canonicalForm = value => Array.isArray(value) ? value.map(canonicalForm) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonicalForm(value[key])])) : value;
export const serializeForm = value => JSON.stringify(canonicalForm(value));
export function restoreFormFields(form, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('草稿内容无法读取，请丢弃后重新填写');
  for (const name of Object.keys(form)) {
    const value = values[name], previous = form[name];
    if (Object.hasOwn(values, name) && (typeof value === typeof previous ||
      (previous === null && typeof value === 'number') || (typeof previous === 'number' && value === null))) form[name] = value;
  }
}
const newId = () => globalThis.crypto?.randomUUID?.() || `form_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export function formDraftScope(token, generation, { kind, child_id, record_id = null }) {
  try {
    const owner = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!['parent', 'child'].includes(owner.role) || !owner.epoch || !generation || !kind || !child_id ||
        (owner.role === 'child' && owner.child_id !== child_id)) return null;
    // No credential is stored. Epochs isolate installations, restores and PIN changes.
    return { role: owner.role, owner: owner.role === 'child' ? owner.child_id : 'parent', epoch: owner.epoch,
      child_epoch: owner.role === 'child' ? owner.child_epoch ?? null : null, generation, kind, child_id, record_id };
  } catch { return null; }
}

export function formDraftStore(storage = () => globalThis.localStorage, now = () => Date.now()) {
  const target = () => typeof storage === 'function' ? storage() : storage;
  const key = scope => DRAFT_PREFIX + serializeForm(scope);
  const read = scope => {
    const raw = target().getItem(key(scope));
    if (!raw) return null;
    let entry;
    try { entry = JSON.parse(raw); } catch { target().removeItem(key(scope)); return null; }
    if (!entry?.revision || !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload) ||
        (entry.attempt && (!/^[a-zA-Z0-9_-]{8,100}$/.test(entry.attempt.request_id) || !entry.attempt.body || typeof entry.attempt.body !== 'object')) ||
        !Number.isFinite(entry.updated_at) || now() - entry.updated_at >= DRAFT_TTL ||
        serializeForm(entry.scope) !== serializeForm(scope)) {
      target().removeItem(key(scope)); return null;
    }
    return entry;
  };
  const prune = keepKey => {
    const store = target();
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(k => k?.startsWith(DRAFT_PREFIX));
    const live = [];
    for (const k of keys) {
      try {
        const entry = JSON.parse(store.getItem(k));
        if (!entry?.revision || !Number.isFinite(entry.updated_at) || now() - entry.updated_at >= DRAFT_TTL) store.removeItem(k);
        else live.push({ key: k, ...entry });
      } catch { store.removeItem(k); }
    }
    if (live.length >= 100 && !live.some(entry => entry.key === keepKey)) {
      throw new Error('本机草稿已满，请先核对或丢弃已有草稿');
    }
  };
  return {
    read,
    clearAll() {
      const store = target();
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(k => k?.startsWith(DRAFT_PREFIX));
      for (const k of keys) store.removeItem(k);
    },
    save(scope, payload, expectedRevision, attempt = null) {
      const current = read(scope);
      if ((current?.revision ?? null) !== expectedRevision) throw Object.assign(new Error('另一标签页已更新这份草稿，请先核对'), { draftConflict: true });
      prune(key(scope));
      const entry = { scope, payload, attempt, revision: newId(), updated_at: now() };
      const text = JSON.stringify(entry);
      if (text.length > 50000) throw new Error('草稿内容过大，请缩短文字后重试');
      target().setItem(key(scope), text);
      return entry;
    },
    remove(scope, expectedRevision) {
      if ((read(scope)?.revision ?? null) !== expectedRevision) return false;
      target().removeItem(key(scope)); return true;
    },
    newRequestId: newId
  };
}
export const localFormDrafts = formDraftStore();
