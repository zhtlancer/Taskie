// crypto.randomUUID needs a secure context, which a NAS on plain HTTP does not provide.
export const newRequestId = () => globalThis.crypto?.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const PREFIX = 'taskie_pending_write_v1:';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const identity = ({ kind, role, child_id, task_id, payload }) => JSON.stringify(canonical({ kind, role, child_id, task_id, payload }));
export const notifyPendingWrites = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('taskie:pending-writes'));
};

// Store the entire operation before sending it. A reload, changed suggestion or completed task
// must not change the body of an uncertain request. Storage failure stops the write before HTTP.
export function pendingWrites(storage = () => globalThis.sessionStorage) {
  const getStorage = () => typeof storage === 'function' ? storage() : storage;
  const list = () => {
    const target = getStorage();
    if (!target) return [];
    const entries = [];
    for (let index = 0; index < target.length; index++) {
      const key = target.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const entry = JSON.parse(target.getItem(key));
        if (entry?.request_id && entry.payload && entry.child_id && entry.task_id) entries.push(entry);
      } catch { /* A damaged entry is not sent as a different request. */ }
    }
    return entries;
  };
  return {
    list,
    prepare(action) {
      const entries = list();
      const previous = entries.find(entry => identity(entry) === identity(action));
      if (previous) return previous;
      if (!action.child_id || !action.task_id || !['parent', 'child'].includes(action.role)) throw new Error('无法确定操作的孩子或任务，请重新登录后重试');
      const entry = JSON.parse(JSON.stringify({ ...action, request_id: newRequestId() }));
      const target = getStorage();
      if (!target) throw new Error('无法保存待确认请求，请允许会话存储后重试');
      target.setItem(`${PREFIX}${entry.request_id}`, JSON.stringify(entry));
      notifyPendingWrites();
      return entry;
    },
    done(id) { getStorage().removeItem(`${PREFIX}${id}`); notifyPendingWrites(); }
  };
}
export const pendingWriteStore = pendingWrites();
export const activeWrites = new Set();
