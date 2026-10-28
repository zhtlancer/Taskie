import { reactive, watch, onBeforeUnmount } from 'vue';
import { formDraftScope, localFormDrafts, serializeForm } from '../utils/formDrafts.js';
import { getToken, getDataGeneration } from '../utils/session.js';

// The draft owns the original submission body before HTTP. Recovery never submits automatically.
export function useFormDraft(target, { read, apply, hasContent, invalidated }) {
  const scope = formDraftScope(getToken(), getDataGeneration(), target);
  const state = reactive({ available: false, saved: false, pending: false, error: '', restored: false, preview: '', requiresConfirmation: false });
  const initial = JSON.parse(JSON.stringify(read()));
  let entry = null, revision = null, attempt = null, dirty = false, silenced = false;
  const sameOwner = () => scope && serializeForm(formDraftScope(getToken(), getDataGeneration(), target)) === serializeForm(scope);
  const storageError = error => {
    state.saved = false;
    if (error.draftConflict) {
      try {
        entry = localFormDrafts.read(scope); state.available = Boolean(entry);
        if (!entry) revision = null; // Another tab cleared it (or it expired); keep current input retryable.
      } catch { /* Retain current input. */ }
    }
    state.error = error.message || '无法保存本机草稿，请保留当前输入并检查浏览器存储';
  };
  if (scope) {
    try { entry = localFormDrafts.read(scope); revision = entry?.revision ?? null; state.available = Boolean(entry); }
    catch (error) { storageError(error); }
  }
  const updatePreview = () => { const form = entry?.payload?.form; const value = form?.content ?? form?.description ?? form?.title; state.preview = typeof value === 'string' ? value : ''; state.requiresConfirmation = Boolean(entry?.attempt); };
  updatePreview();
  function persist() {
    if (!sameOwner() || silenced || state.available || !dirty) return;
    try {
      if (!hasContent(read())) {
        localFormDrafts.remove(scope, revision); revision = null; state.saved = false; return;
      }
      entry = localFormDrafts.save(scope, read(), revision, attempt);
      revision = entry.revision; state.saved = true; state.error = '';
    } catch (error) { storageError(error); updatePreview(); }
  }
  const stop = watch(read, () => { if (!silenced) { dirty = true; persist(); } }, { deep: true, flush: 'sync' });
  state.restore = () => {
    if (!entry || !sameOwner()) return;
    silenced = true;
    try {
      apply(entry.payload); revision = entry.revision; attempt = entry.attempt;
      state.pending = Boolean(attempt); state.available = false; state.restored = true; state.error = '';
      dirty = true; state.saved = true;
    } catch (error) { storageError(error); }
    finally { silenced = false; }
  };
  state.discard = () => {
    if (!sameOwner()) return;
    try {
      const uncertain = Boolean(attempt || entry?.attempt);
      const current = localFormDrafts.read(scope);
      localFormDrafts.remove(scope, current?.revision ?? null);
      // Dropping an uncertain receipt starts a fresh form, never a one-click duplicate submit.
      if (uncertain) { silenced = true; try { apply(initial); } finally { silenced = false; } }
      entry = null; revision = null; attempt = null; dirty = false;
      state.available = false; state.pending = false; state.saved = false; state.restored = false; state.error = ''; state.requiresConfirmation = false;
    } catch (error) { storageError(error); }
  };
  state.prepare = body => {
    if (!sameOwner()) throw new Error('登录状态或数据已改变，请重新打开表单');
    if (state.available) throw new Error('请先恢复或丢弃已有草稿');
    const previous = attempt;
    if (!attempt) attempt = { request_id: localFormDrafts.newRequestId(), body: JSON.parse(JSON.stringify(body)) };
    dirty = true;
    try {
      const saved = localFormDrafts.save(scope, read(), revision, attempt);
      entry = saved; revision = saved.revision; state.pending = true; state.saved = true; state.error = '';
      state.requiresConfirmation = true;
      return attempt;
    } catch (error) {
      if (!previous) attempt = null; // Nothing was sent; a later edit must not submit an obsolete body.
      storageError(error); updatePreview();
      throw new Error('本机草稿未能保存，本次尚未提交。请检查浏览器存储后重试');
    }
  };
  state.failed = error => {
    // A definitive validation/auth/version rejection did not commit this attempt.
    // Network errors and server/proxy failures keep its exact body and id for safe retries.
    if (error.status && error.status < 500 && !error.code?.startsWith('FORM_SUBMISSION_')) { attempt = null; state.pending = false; state.requiresConfirmation = false; persist(); }
  };
  state.complete = () => {
    if (scope) { try { localFormDrafts.remove(scope, revision); } catch { /* A server receipt still makes stale recovery safe. */ } }
    entry = null; revision = null; attempt = null; dirty = false; state.pending = false; state.saved = false; state.requiresConfirmation = false;
  };
  function identityChanged() { if (!sameOwner()) invalidated?.(); }
  function restored() { state.complete(); invalidated?.(); }
  if (typeof window !== 'undefined') {
    window.addEventListener('taskie:session-changed', identityChanged);
    window.addEventListener('taskie:data-restored', restored);
    window.addEventListener('pagehide', persist);
  }
  onBeforeUnmount(() => {
    stop(); persist();
    if (typeof window !== 'undefined') {
      window.removeEventListener('taskie:session-changed', identityChanged);
      window.removeEventListener('taskie:data-restored', restored);
      window.removeEventListener('pagehide', persist);
    }
  });
  return state;
}
