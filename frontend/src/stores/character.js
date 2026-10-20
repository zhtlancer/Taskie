import { defineStore } from 'pinia';
import api from '../api/client';
import { playStarAdded } from '../utils/sound';
import { cleanEntry } from '../utils/wordBook';

export const useCharacterStore = defineStore('character', {
  state: () => ({
    characters: [],
    loading: false,
    error: null,
    currentChildId: null,
    filter: 'all', // 'all' | 'learning' | 'mastered'
    showAllPinyin: false,
  }),

  getters: {
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
    isCharInBook: (state) => (char) => {
      const clean = cleanEntry(char);
      return Boolean(clean) && state.characters.some((c) => c.char === clean);
    },
    getCharRecord: (state) => (char) => {
      const clean = cleanEntry(char);
      return state.characters.find((c) => c.char === clean) || null;
    },
    categoryCount: (state) => (key) => state.characters.filter((c) => c.categories?.includes(key)).length,
  },

  actions: {
    async fetchCharacters(childId) {
      if (!childId) return;
      this.currentChildId = childId;
      this.loading = true;
      this.error = null;
      try {
        const data = await api.getCharacters(childId);
        this.characters = Array.isArray(data) ? data : [];
      } catch (err) {
        console.error('[CharacterStore] Fetch error:', err);
        this.error = typeof err === 'string' ? err : err.message || '加载生字生词本失败';
      } finally {
        this.loading = false;
      }
    },

    async addCharacter({ child_id, char, pinyin, strokes, radical, categories = [] }) {
      const targetChildId = child_id || this.currentChildId;
      if (!targetChildId) throw new Error('缺少孩子账号信息');
      const clean = cleanEntry(char);
      if (!clean) throw new Error('请输入有效汉字');

      // Check if already in book
      const existing = this.characters.find((c) => c.char === clean);
      if (existing) {
        return { alreadyExists: true, character: existing };
      }

      this.loading = true;
      try {
        const created = await api.createCharacter({
          child_id: targetChildId,
          char: clean,
          pinyin,
          strokes,
          radical,
          categories,
        });

        // Add to state list head if not present
        if (!this.characters.some((c) => c.id === created.id)) {
          this.characters.unshift(created);
        }

        // Play feedback sound
        playStarAdded();

        return { success: true, character: created };
      } catch (err) {
        const msg = typeof err === 'string' ? err : err.message || '加入生字生词本失败';
        this.error = msg;
        throw new Error(msg);
      } finally {
        this.loading = false;
      }
    },

    async toggleMaster(id, forcedState = null) {
      const index = this.characters.findIndex((c) => c.id === id);
      if (index === -1) return;

      const targetItem = this.characters[index];
      const nextMastered = forcedState !== null ? Boolean(forcedState) : !targetItem.is_mastered;

      try {
        const updated = await api.markCharacterMastered(id, nextMastered);
        this.characters[index] = {
          ...targetItem,
          ...updated,
          is_mastered: nextMastered,
          mastered_at: nextMastered ? updated.mastered_at || new Date().toISOString() : null,
        };
        return this.characters[index];
      } catch (err) {
        console.error('[CharacterStore] toggleMaster error:', err);
        // Keep the server-confirmed state; callers show the error and allow a retry.
        throw err;
      }
    },

    // Throws the server's message, e.g. when a child tries to take a category away.
    async setCategories(id, categories) {
      const index = this.characters.findIndex((c) => c.id === id);
      const updated = await api.setCharacterCategories(id, categories);
      if (index !== -1) this.characters[index] = { ...this.characters[index], ...updated };
      return updated;
    },

    async removeCharacter(id) {
      try {
        await api.deleteCharacter(id);
        this.characters = this.characters.filter((c) => c.id !== id);
      } catch (err) {
        console.error('[CharacterStore] removeCharacter error:', err);
        throw err;
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
