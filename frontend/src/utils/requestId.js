// crypto.randomUUID needs a secure context, which a NAS on plain HTTP does not provide.
export const newRequestId = () => globalThis.crypto?.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const PREFIX = 'taskie_pending_write_v1:';
const CONFIRMED_PREFIX = 'taskie_confirmed_write_v1:';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const scope = ({ kind, role, child_id, task_id }) => JSON.stringify({ kind, role, child_id, task_id });
const identity = ({ kind, role, child_id, task_id, payload }) => JSON.stringify(canonical({ kind, role, child_id, task_id, payload }));
export const notifyPendingWrites = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('taskie:pending-writes'));
};

// Store the entire operation before sending it. A reload, changed suggestion or completed task
// must not change the body of an uncertain request. Storage failure stops the write before HTTP.
export function pendingWrites(storage = () => globalThis.sessionStorage, confirmations = () => globalThis.localStorage) {
  const getStorage = () => typeof storage === 'function' ? storage() : storage;
  const getConfirmations = () => typeof confirmations === 'function' ? confirmations() : confirmations;
  const isConfirmed = id => Boolean(getConfirmations()?.getItem(`${CONFIRMED_PREFIX}${id}`));
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
    return entries.filter(entry => {
      if (!isConfirmed(entry.request_id)) return true;
      target.removeItem(`${PREFIX}${entry.request_id}`);
      return false;
    });
  };
  return {
    list,
    prepare(action, attempt = {}) {
      const entries = list();
      // A failed form remains the same attempt, including after confirmation in another tab/UI.
      if (attempt.request_id && isConfirmed(attempt.request_id)) throw new Error('原操作已确认。请关闭当前表单；如需更正，请修改已有记录，新增操作请重新打开。');
      const previous = entries.find(entry => identity(entry) === identity(action));
      const unresolved = entries.find(entry => scope(entry) === scope(action));
      if (unresolved && !previous) {
        attempt.request_id = unresolved.request_id;
        throw new Error('内容已修改，尚未提交。请先关闭当前表单，再到“待确认请求”确认原操作；如需更正，请修改已有记录。');
      }
      if (previous) { attempt.request_id = previous.request_id; return previous; }
      if (!action.child_id || !action.task_id || !['parent', 'child'].includes(action.role)) throw new Error('无法确定操作的孩子或任务，请重新登录后重试');
      const entry = JSON.parse(JSON.stringify({ ...action, request_id: newRequestId() }));
      const receipts = getConfirmations();
      if (!receipts) throw new Error('无法同步操作确认结果，请允许本地存储后重试');
      // Check access before HTTP. A confirmed write must remain recoverable if storage fills up.
      receipts.getItem(`${CONFIRMED_PREFIX}${entry.request_id}`);
      const target = getStorage();
      if (!target) throw new Error('无法保存待确认请求，请允许会话存储后重试');
      target.setItem(`${PREFIX}${entry.request_id}`, JSON.stringify(entry));
      attempt.request_id = entry.request_id;
      notifyPendingWrites();
      return entry;
    },
    done(id) {
      // Only an opaque id is shared. Keep receipts so suspended/reloaded copied sessions can
      // reconcile too; no child names, task titles or request bodies go into localStorage.
      const receipts = getConfirmations();
      if (!receipts) throw new Error('无法同步操作确认结果，请允许本地存储后重试');
      receipts.setItem(`${CONFIRMED_PREFIX}${id}`, '1');
      getStorage().removeItem(`${PREFIX}${id}`);
      notifyPendingWrites();
    }
  };
}
export const pendingWriteStore = pendingWrites();
export const activeWrites = new Set();

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (!event.key?.startsWith(CONFIRMED_PREFIX) || event.newValue !== '1') return;
  try {
    pendingWriteStore.list();
    notifyPendingWrites();
    window.dispatchEvent(new Event('taskie:write-confirmed'));
  } catch { /* Keep the original operation when storage cannot be reconciled. */ }
});
