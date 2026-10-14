import { defineStore } from 'pinia';
import api from '../api/client';
import { hasSession, clearTokens } from '../utils/session.js';

export const useParentStore = defineStore('parent', {
  state: () => ({
    isAuthenticated: hasSession('parent'),
    authError: null
  }),

  actions: {
    async login(pin) {
      this.authError = null;
      try {
        const res = await api.loginParent({ pin });
        if (res.success) {
          this.isAuthenticated = true;
          sessionStorage.setItem('parent_auth', 'true');
          return true;
        }
        return false;
      } catch (err) {
        this.authError = typeof err === 'string' ? err : 'PIN 码错误';
        throw this.authError;
      }
    },

    logout() {
      this.isAuthenticated = false;
      sessionStorage.removeItem('parent_auth');
      clearTokens();
    }
  }
});
