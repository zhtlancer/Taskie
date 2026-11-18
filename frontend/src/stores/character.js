import { defineStore } from 'pinia';
import api from '../api/client';
import { getToken } from '../utils/session.js';
import { playStarAdded } from '../utils/sound';
import { cleanEntry } from '../utils/wordBook';

const readToken = () => (typeof sessionStorage === 'undefined' ? '' : getToken() || '');
const scopeFor = (childId, token = readToken()) => (childId && token ? `${childId}|${token}` : '');
const errMsg = (err, fallback) => (typeof err === 'string' ? err : err?.message || fallback);
const SILENT_READ = { silentError: true, preserveError: true, networkErrorMessage: '无法连接服务器，请检查网络后重新读取。' };
const SILENT_WRITE = { silentError: true, preserveError: true, networkErrorMessage: '无法连接服务器，保存失败，请检查网络后重试。' };

let fetchSerial = 0;
let fetchController = null;

export const useCharacterStore = defineStore('character', {
  state: () => ({
    characters: [],
    loading: false,
    error: null,
    currentChildId: null,
    loadedScope: '',
    scopeGeneration: 0,
    busyIds: {},
    addingKeys: {},
    filter: 'all', // 'all' | 'learning' | 'mastered'
    showAllPinyin: false,
  }),

  getters: {
    isLoadedFor: (state) => (childId) => {
      const loaded = state.loadedScope;
      const current = state.currentChildId;
      const scope = scopeFor(childId);
      return Boolean(loaded && scope && current === childId && loaded === scope);
    },
    isLoaded: (state) => {
      const loaded = state.loadedScope;
      const scope = scopeFor(state.currentChildId);
      return Boolean(loaded && scope && loaded === scope);
    },
    isBusy: (state) => (id) => Boolean(id && state.busyIds[id]),
    totalCount: (state) => state.characters.length,
    masteredCount: (state) => state.characters.filter((c) => Boolean(c.is_mastered)).length,
    learningCount: (state) => state.characters.filter((c) => !c.is_mastered).length,
    masteryRate: (state) => {
      if (state.characters.length === 0) return 0;
      const count = state.characters.filter((c) => Boolean(c.is_mastered)).length;
      return Math.round((count / state.characters.length) * 100);
    },
    filteredCharacters: (state) => {
      if (state.filter === 'mastered') {
        return state.characters.filter((c) => Boolean(c.is_mastered));
      }
      if (state.filter === 'learning') {
        return state.characters.filter((c) => !c.is_mastered);
      }
      return state.characters;
    },
    isCharInBook: (state) => (char, childId = state.currentChildId) => {
      const loaded = state.loadedScope;
      const current = state.currentChildId;
      const list = state.characters;
      const scope = scopeFor(childId);
      if (!loaded || !scope || current !== childId || loaded !== scope) return false;
      const clean = cleanEntry(char);
      return Boolean(clean) && list.some((c) => c.char === clean);
    },
    getCharRecord: (state) => (char, childId = state.currentChildId) => {
      const loaded = state.loadedScope;
      const current = state.currentChildId;
      const list = state.characters;
      const scope = scopeFor(childId);
      if (!loaded || !scope || current !== childId || loaded !== scope) return null;
      const clean = cleanEntry(char);
      return list.find((c) => c.char === clean) || null;
    },
    categoryCount: (state) => (key) => state.characters.filter((c) => c.categories?.includes(key)).length,
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
      this.characters = [];
      this.loadedScope = '';
      this.error = null;
      this.busyIds = {};
      this.addingKeys = {};
      this.currentChildId = childId;
    },

    setChild(childId) {
      if (childId !== this.currentChildId) {
        this.clear(childId || null);
      }
    },

    async fetchCharacters(childId) {
      const token = readToken();
      if (!childId || !token) {
        this.clear(childId || null);
        return;
      }
      if (childId !== this.currentChildId) {
        this.clear(childId);
      } else {
        this.abortFetch();
      }
      const serial = ++fetchSerial;
      const gen = this.scopeGeneration;
      const scope = scopeFor(childId, token);
      const controller = new AbortController();
      fetchController = controller;
      const matches = () => serial === fetchSerial && gen === this.scopeGeneration && this.currentChildId === childId && readToken() === token;

      this.loading = true;
      this.error = null;
      try {
        const data = await api.getCharacters(childId, null, controller.signal, SILENT_READ);
        if (!matches()) return;
        this.characters = Array.isArray(data) ? data : [];
        this.loadedScope = scope;
      } catch (err) {
        if (matches() && !controller.signal.aborted) {
          this.error = errMsg(err, '加载生字生词本失败，请重试。');
        }
      } finally {
        if (serial === fetchSerial) {
          this.loading = false;
          fetchController = null;
        }
      }
    },

    async ensureChildLoaded(childId) {
      const scope = scopeFor(childId);
      if (!scope) return;
      if (this.currentChildId !== childId) {
        return this.fetchCharacters(childId);
      }
      if (this.loadedScope !== scope && !this.loading) {
        return this.fetchCharacters(childId);
      }
    },

    refreshAfterMutation(childId) {
      // A pending read may contain the list from before this confirmed write,
      // even if that read started after the write was submitted.
      if (this.loading || !this.isLoadedFor(childId)) this.fetchCharacters(childId);
    },

    async addCharacter({ child_id, char, pinyin, strokes, radical, categories = [] }) {
      const targetChildId = child_id || this.currentChildId;
      if (!targetChildId) throw new Error('缺少孩子账号信息');
      const token = readToken();
      if (!token) throw new Error('请先登录后再操作');
      const clean = cleanEntry(char);
      if (!clean) throw new Error('请输入有效汉字');

      const scope = scopeFor(targetChildId, token);
      if (this.currentChildId === targetChildId && this.loadedScope === scope) {
        const existing = this.characters.find((c) => c.char === clean);
        if (existing) return { alreadyExists: true, character: existing };
      }

      const addKey = `${targetChildId}:${clean}`;
      if (this.addingKeys[addKey]) {
        throw new Error('正在保存，请勿重复提交');
      }

      const startGen = this.scopeGeneration;
      this.addingKeys = { ...this.addingKeys, [addKey]: true };

      try {
        const created = await api.createCharacter({
          child_id: targetChildId,
          char: clean,
          pinyin,
          strokes,
          radical,
          categories,
        }, SILENT_WRITE);

        if (this.scopeGeneration === startGen && this.currentChildId === targetChildId && readToken() === token) {
          if (!this.characters.some((c) => c.id === created.id)) {
            this.characters.unshift(created);
          }
          this.refreshAfterMutation(targetChildId);
        }

        playStarAdded();
        return { success: true, character: created };
      } catch (err) {
        if (err?.status === 409 && this.scopeGeneration === startGen && this.currentChildId === targetChildId && readToken() === token) {
          await this.fetchCharacters(targetChildId);
        }
        throw new Error(errMsg(err, '加入生字生词本失败'));
      } finally {
        if (this.scopeGeneration === startGen) {
          const next = { ...this.addingKeys };
          delete next[addKey];
          this.addingKeys = next;
        }
      }
    },

    async toggleMaster(id, forcedState = null) {
      if (!id || this.busyIds[id]) return null;
      const index = this.characters.findIndex((c) => c.id === id);
      if (index === -1) return null;

      const targetItem = this.characters[index];
      const nextMastered = forcedState !== null ? Boolean(forcedState) : !targetItem.is_mastered;
      const startGen = this.scopeGeneration;
      const startChildId = targetItem.child_id || this.currentChildId;
      const startToken = readToken();

      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        const updated = await api.markCharacterMastered(id, nextMastered, SILENT_WRITE);
        if (this.scopeGeneration !== startGen || this.currentChildId !== startChildId || readToken() !== startToken) {
          return null;
        }
        const currentIdx = this.characters.findIndex((c) => c.id === id);
        if (currentIdx !== -1) {
          this.characters[currentIdx] = {
            ...this.characters[currentIdx],
            ...updated,
            is_mastered: nextMastered,
            mastered_at: nextMastered ? updated.mastered_at || new Date().toISOString() : null,
          };
          this.refreshAfterMutation(startChildId);
          return this.characters[currentIdx];
        }
        return null;
      } catch (err) {
        console.error('[CharacterStore] toggleMaster error:', err);
        throw err;
      } finally {
        if (this.scopeGeneration === startGen) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },

    // Throws the server's message, e.g. when a child tries to take a category away.
    async setCategories(id, categories) {
      if (!id || this.busyIds[id]) throw new Error('正在保存，请稍候');
      const targetItem = this.characters.find((c) => c.id === id);
      const startGen = this.scopeGeneration;
      const startChildId = targetItem?.child_id || this.currentChildId;
      const startToken = readToken();

      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        const updated = await api.setCharacterCategories(id, categories, SILENT_WRITE);
        if (this.scopeGeneration !== startGen || this.currentChildId !== startChildId || readToken() !== startToken) {
          return updated;
        }
        const index = this.characters.findIndex((c) => c.id === id);
        if (index !== -1) {
          this.characters[index] = { ...this.characters[index], ...updated };
        }
        this.refreshAfterMutation(startChildId);
        return updated;
      } finally {
        if (this.scopeGeneration === startGen) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },

    async removeCharacter(id) {
      if (!id || this.busyIds[id]) return;
      const targetItem = this.characters.find((c) => c.id === id);
      const startGen = this.scopeGeneration;
      const startChildId = targetItem?.child_id || this.currentChildId;
      const startToken = readToken();

      this.busyIds = { ...this.busyIds, [id]: true };
      try {
        await api.deleteCharacter(id, SILENT_WRITE);
        if (this.scopeGeneration !== startGen || this.currentChildId !== startChildId || readToken() !== startToken) {
          return;
        }
        this.characters = this.characters.filter((c) => c.id !== id);
        this.refreshAfterMutation(startChildId);
      } catch (err) {
        console.error('[CharacterStore] removeCharacter error:', err);
        throw err;
      } finally {
        if (this.scopeGeneration === startGen) {
          const next = { ...this.busyIds };
          delete next[id];
          this.busyIds = next;
        }
      }
    },

    setFilter(filter) {
      this.filter = filter;
    },

    toggleAllPinyin() {
      this.showAllPinyin = !this.showAllPinyin;
    },
  },
});
