// crypto.randomUUID needs a secure context, which a NAS on plain HTTP does not provide.
export const newRequestId = () => globalThis.crypto?.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

const PREFIX = 'taskie_pending_write_v1:';
const CONFIRMED_PREFIX = 'taskie_confirmed_write_v1:';
export const RECEIPT_LIMIT = 200;
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const keysWithPrefix = (storage, prefix) => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key?.startsWith(prefix));
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
  const pruneReceipts = (keep = RECEIPT_LIMIT) => {
    const receipts = getConfirmations();
    if (!receipts) return;
    const now = Date.now();
    const entries = keysWithPrefix(receipts, CONFIRMED_PREFIX).map(key => ({ key, at: Number(receipts.getItem(key)) || 0 }))
      .sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
    for (const [index, entry] of entries.entries()) {
      // Legacy "1" receipts have no reliable date and are retired first.
      if (index >= keep || entry.at <= 1 || now - entry.at >= RECEIPT_TTL_MS) receipts.removeItem(entry.key);
    }
  };
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
    const unresolved = entries.filter(entry => {
      if (!isConfirmed(entry.request_id)) return true;
      target.removeItem(`${PREFIX}${entry.request_id}`);
      return false;
    });
    pruneReceipts();
    return unresolved;
  };
  return {
    list,
    prepare(action, attempt = {}) {
      const entries = list();
      // A failed form remains the same attempt, including after confirmation in another tab/UI.
      if (attempt.request_id && !entries.some(entry => entry.request_id === attempt.request_id)) {
        // Receipts are bounded; a suspended form must never turn an old attempt into a
        // new request just because its receipt was evicted or its session was cleared.
        throw new Error('原操作已确认或当前会话已结束。请关闭当前表单；如需更正，请修改已有记录，新增操作请重新打开。');
      }
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
      // Only opaque ids and timestamps are shared. If a copied session outlives receipt
      // retention, its persisted operation still replays the SAME id for server deduplication.
      const receipts = getConfirmations();
      if (!receipts) throw new Error('无法同步操作确认结果，请允许本地存储后重试');
      pruneReceipts(RECEIPT_LIMIT - 1);
      try { receipts.setItem(`${CONFIRMED_PREFIX}${id}`, String(Date.now())); }
      catch (error) {
        // Free only our receipt keys, never unrelated preferences or unresolved requests.
        pruneReceipts(Math.floor(RECEIPT_LIMIT / 2));
        const oldest = keysWithPrefix(receipts, CONFIRMED_PREFIX).sort((a, b) => Number(receipts.getItem(a)) - Number(receipts.getItem(b)));
        if (oldest.length) receipts.removeItem(oldest[0]);
        receipts.setItem(`${CONFIRMED_PREFIX}${id}`, String(Date.now()));
      }
      getStorage().removeItem(`${PREFIX}${id}`);
      notifyPendingWrites();
    },
    clear() {
      const target = getStorage();
      if (target) for (const key of keysWithPrefix(target, PREFIX)) target.removeItem(key);
      notifyPendingWrites();
    }
  };
}
export const pendingWriteStore = pendingWrites();
export const activeWrites = new Set();

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (!event.key?.startsWith(CONFIRMED_PREFIX) || !event.newValue) return;
  try {
    pendingWriteStore.list();
    notifyPendingWrites();
    window.dispatchEvent(new Event('taskie:write-confirmed'));
  } catch { /* Keep the original operation when storage cannot be reconciled. */ }
});
