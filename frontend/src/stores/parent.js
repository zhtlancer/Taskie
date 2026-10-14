import { defineStore } from 'pinia';
import api from '../api/client';
import { hasSession, clearTokens, setMustChangePin } from '../utils/session.js';

export const useParentStore = defineStore('parent', {
  state: () => ({
    isAuthenticated: hasSession('parent'),
    authError: null,
    // Kept in memory only, so the forced PIN change does not ask for the default PIN twice.
    pendingPin: null
  }),

  actions: {
    async login(pin) {
      this.authError = null;
      try {
        const res = await api.loginParent({ pin });
        if (res.success) {
          this.isAuthenticated = true;
          sessionStorage.setItem('parent_auth', 'true');
          setMustChangePin(Boolean(res.must_change_pin));
          this.pendingPin = res.must_change_pin ? pin : null;
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
      this.pendingPin = null;
      sessionStorage.removeItem('parent_auth');
      setMustChangePin(false);
      clearTokens();
    }
  }
});
