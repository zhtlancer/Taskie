// crypto.randomUUID needs a secure context, which a NAS on plain HTTP does not provide.
export const newRequestId = () => globalThis.crypto?.randomUUID?.() || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

// One id per unfinished action: retrying the same action after a lost response reuses its id, so the
// server records it once; a different action, or the next one after success, gets a new id.
export function pendingRequests() {
  const pending = new Map();
  return {
    idFor(key) {
      if (!pending.has(key)) pending.set(key, newRequestId());
      return pending.get(key);
    },
    done(key) { pending.delete(key); }
  };
}
