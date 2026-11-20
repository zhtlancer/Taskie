import { defineStore } from 'pinia';
import api from '../api/client';
import { getToken, getDataGeneration } from '../utils/session.js';
import { playStarAdded } from '../utils/sound';
import { identityKey, hasEnglishDefinition } from '../utils/englishWord';

const readToken = () => (typeof sessionStorage === 'undefined' ? '' : getToken() || '');
const scopeFor = (childId, token = readToken()) => (childId && token ? `${childId}|${token}` : '');
const errMsg = (err, fallback) => (typeof err === 'string' ? err : err?.message || fallback);
const SILENT_READ = { silentError: true, preserveError: true, networkErrorMessage: '无法连接服务器，请检查网络后重新读取。' };
const SILENT_WRITE = { silentError: true, preserveError: true, networkErrorMessage: '无法连接服务器，保存失败，请检查网络后重试。' };

let fetchSerial = 0;
let fetchController = null;

export const useEnglishWordStore = defineStore('englishWord', {
  state: () => ({
    words: [],
    textbooks: [],
    units: [],
    loading: false,
    error: null,
    currentChildId: null,
    loadedScope: '',
    scopeGeneration: 0,
    busyIds: {},
    addingKeys: {},
    filter: 'all',
  }),

  getters: {
    isLoadedFor: (state) => (childId) => {
      const scope = scopeFor(childId);
      return Boolean(state.loadedScope && scope && state.currentChildId === childId && state.loadedScope === scope);
    },
    isLoaded: (state) => {
      const scope = scopeFor(state.currentChildId);
      return Boolean(state.loadedScope && scope && state.loadedScope === scope);
    },
    isBusy: (state) => (id) => Boolean(id && state.busyIds[id]),
    totalCount: (state) => state.words.length,
    masteredCount: (state) => state.words.filter((w) => Boolean(w.is_mastered)).length,
    learningCount: (state) => state.words.filter((w) => !w.is_mastered).length,
    missingDefinitionCount: (state) => state.words.filter((w) => !hasEnglishDefinition(w)).length,
    masteryRate: (state) => {
      if (!state.words.length) return 0;
      return Math.round((state.words.filter((w) => Boolean(w.is_mastered)).length / state.words.length) * 100);
    },
    isWordInBook: (state) => (word, childId = state.currentChildId) => {
      const scope = scopeFor(childId);
      if (!state.loadedScope || !scope || state.currentChildId !== childId || state.loadedScope !== scope) return false;
      const clean = identityKey(word);
      return Boolean(clean) && state.words.some((w) => w.identity_key === clean);
    },
    getWordRecord: (state) => (word, childId = state.currentChildId) => {
      const scope = scopeFor(childId);
      if (!state.loadedScope || !scope || state.currentChildId !== childId || state.loadedScope !== scope) return null;
      const clean = identityKey(word);
      return state.words.find((w) => w.identity_key === clean) || null;
    },
    categoryCount: (state) => (key) => state.words.filter((w) => w.categories?.includes(key)).length,
  },

  actions: {
    abortFetch() {
      fetchSerial++;
      fetchController?.abort();
      fetchController = null;
      this.loading = false;
    },

    clear(childId = null) {
      this.scopeGeneration++;
      this.abortFetch();
      this.words = [];
      this.textbooks = [];
      this.units = [];
      this.loadedScope = '';
      this.error = null;
      this.busyIds = {};
      this.addingKeys = {};
      this.currentChildId = childId;
    },

    setChild(childId) {
      if (this.currentChildId !== childId) {
        this.clear(childId);
      }
    },

    syncTaxonomy() {
      this.textbooks = [...new Set(this.words.map((w) => w.textbook).filter(Boolean))].sort();
      this.units = [...new Set(this.words.map((w) => w.unit).filter(Boolean))].sort();
    },

    acceptWordSnapshot(word) {
      if (!word || word.child_id !== this.currentChildId || !this.isLoaded) return false;
      const existing = this.words.find(entry => entry.id === word.id);
      if (!existing || existing.version > word.version) return false;
      this.abortFetch();
      this.words = this.words.map(entry => entry.id === word.id ? word : entry);
      this.syncTaxonomy();
      return true;
    },

    refreshAfterMutation(childId) {
      // A read already in flight may still contain the list from before this write.
      // fetchWords cancels and invalidates that read before loading a fresh snapshot.
      if (this.loading || !this.isLoadedFor(childId)) this.fetchWords(childId).catch(() => {});
    },

    async fetchWords(childId) {
      const targetChildId = childId || this.currentChildId;
      const scope = scopeFor(targetChildId);
      if (!targetChildId || !scope) return [];

      this.setChild(targetChildId);
      const generation = this.scopeGeneration;
      const serial = ++fetchSerial;
      fetchController?.abort();
      const controller = new AbortController();
      fetchController = controller;
      this.loading = true;
      this.error = null;

      try {
        const list = await api.getEnglishWords(targetChildId, {}, controller.signal, SILENT_READ);
        if (serial !== fetchSerial || generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) {
          return this.words;
        }
        this.words = Array.isArray(list) ? list : [];
        this.syncTaxonomy();
        this.loadedScope = scope;
        return this.words;
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || err?.name === 'AbortError') {
          return this.words;
        }
        if (serial === fetchSerial && generation === this.scopeGeneration && this.currentChildId === targetChildId) {
          this.error = errMsg(err, '读取英语单词本失败，请稍后重试');
        }
        throw err;
      } finally {
        if (serial === fetchSerial) {
          fetchController = null;
          this.loading = false;
        }
      }
    },

    async addWord(data) {
      const targetChildId = data?.child_id || this.currentChildId;
      const key = identityKey(data?.word);
      const scope = scopeFor(targetChildId);
      if (!targetChildId || !key || !scope) return null;
      const addKey = `${scope}:${key}`;
      if (this.addingKeys[addKey]) return null;
      this.addingKeys = { ...this.addingKeys, [addKey]: true };
      const generation = this.scopeGeneration;

      try {
        const created = await api.createEnglishWord({ ...data, child_id: targetChildId, word: key }, SILENT_WRITE);
        if (generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) return null;
        this.words = [created, ...this.words.filter((w) => w.id !== created.id)];
        this.syncTaxonomy();
        this.refreshAfterMutation(targetChildId);
        playStarAdded();
        return created;
      } finally {
        if (generation === this.scopeGeneration && this.currentChildId === targetChildId && scopeFor(targetChildId) === scope) {
          const next = { ...this.addingKeys };
          delete next[addKey];
          this.addingKeys = next;
        }
      }
    },

    async batchImportWords(payload) {
      const targetChildId = payload?.child_id || this.currentChildId;
      const scope = scopeFor(targetChildId);
      const generation = this.scopeGeneration;
      const result = await api.commitEnglishBatch({ ...payload, child_id: targetChildId }, SILENT_WRITE);
      if (generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) return null;
      if (Array.isArray(result.added)) {
        const addedIds = new Set(result.added.map((w) => w.id));
        this.words = [...result.added, ...this.words.filter((w) => !addedIds.has(w.id))];
        this.syncTaxonomy();
        this.refreshAfterMutation(targetChildId);
      }
      if (result.added?.length) playStarAdded();
      return result;
    },

    async updateWord(id, payload, dataGeneration = getDataGeneration()) {
      if (!id || this.busyIds[id]) return null;
      const targetChildId = this.currentChildId;
      const scope = scopeFor(targetChildId);
      const generation = this.scopeGeneration;
      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        const updated = await api.updateEnglishWord(id, payload, SILENT_WRITE, dataGeneration);
        if (generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) return null;
        this.words = this.words.map((w) => (w.id === id ? updated : w));
        this.syncTaxonomy();
        this.refreshAfterMutation(targetChildId);
        return updated;
      } finally {
        if (generation === this.scopeGeneration && this.currentChildId === targetChildId && scopeFor(targetChildId) === scope) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },

    async toggleMaster(id) {
      if (!id || this.busyIds[id]) return null;
      const existing = this.words.find((w) => w.id === id);
      const target = existing ? !existing.is_mastered : true;
      const targetChildId = this.currentChildId;
      const scope = scopeFor(targetChildId);
      const generation = this.scopeGeneration;
      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        const updated = await api.markEnglishWordMastered(id, target, SILENT_WRITE);
        if (generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) return null;
        this.words = this.words.map((w) => (w.id === id ? updated : w));
        this.refreshAfterMutation(targetChildId);
        if (updated?.is_mastered) playStarAdded();
        return updated;
      } finally {
        if (generation === this.scopeGeneration && this.currentChildId === targetChildId && scopeFor(targetChildId) === scope) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },

    async setCategories(id, categories, expectedVersion) {
      if (!id || this.busyIds[id]) return null;
      const targetChildId = this.currentChildId;
      const scope = scopeFor(targetChildId);
      const generation = this.scopeGeneration;
      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        const updated = await api.setEnglishWordCategories(id, categories, expectedVersion, SILENT_WRITE, getDataGeneration());
        if (generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) return null;
        this.words = this.words.map((w) => (w.id === id ? updated : w));
        this.refreshAfterMutation(targetChildId);
        return updated;
      } finally {
        if (generation === this.scopeGeneration && this.currentChildId === targetChildId && scopeFor(targetChildId) === scope) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },

    async removeWord(id) {
      if (!id || this.busyIds[id]) return false;
      const targetChildId = this.currentChildId;
      const scope = scopeFor(targetChildId);
      const generation = this.scopeGeneration;
      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        await api.deleteEnglishWord(id, SILENT_WRITE);
        if (generation !== this.scopeGeneration || this.currentChildId !== targetChildId || scopeFor(targetChildId) !== scope) return false;
        this.words = this.words.filter((w) => w.id !== id);
        this.syncTaxonomy();
        this.refreshAfterMutation(targetChildId);
        return true;
      } finally {
        if (generation === this.scopeGeneration && this.currentChildId === targetChildId && scopeFor(targetChildId) === scope) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },
  },
});
