import { defineStore } from 'pinia';
import api from '../api/client';
import { currentRole, endSession } from '../utils/session.js';

export const useChildStore = defineStore('child', {
  state: () => ({
    currentChild: JSON.parse(sessionStorage.getItem('current_child') || 'null'),
    stats: {
      total_points: 0,
      available_points: 0,
      current_streak: 0,
      today_total_tasks: 0,
      today_completed_tasks: 0,
      today_completion_rate: 0,
      today_points: 0
    },
    statsRequestId: 0,
    loadingStats: false
  }),

  getters: {
    isLoggedIn: (state) => !!state.currentChild,
    childName: (state) => state.currentChild?.name || '小朋友',
    childAvatar: (state) => state.currentChild?.avatar_emoji || '🐱',
    childId: (state) => state.currentChild?.id || null,
  },

  actions: {
    setChild(child) {
      // Selecting a view is not a new login: parents may browse several children's
      // pages while their own pending requests still need confirmation.
      this.currentChild = child;
      if (child) {
        sessionStorage.setItem('current_child', JSON.stringify(child));
        this.fetchStats();
      } else {
        sessionStorage.removeItem('current_child');
      }
    },

    async fetchStats() {
      if (!this.childId) return;
      const requestedChild = this.childId;
      const serial = ++this.statsRequestId;
      this.loadingStats = true;
      try {
        const stats = await api.getChildStats(requestedChild);
        if (this.childId !== requestedChild || serial !== this.statsRequestId) return;
        this.stats = {
          total_points: stats.total_points || 0,
          available_points: stats.available_points ?? stats.total_points ?? 0,
          current_streak: stats.current_streak || 0,
          today_total_tasks: stats.today_total_tasks || 0,
          today_completed_tasks: stats.today_completed_tasks || 0,
          today_completion_rate: stats.today_completion_rate || 0,
          today_points: stats.today_points || 0
        };
      } catch (err) {
        console.error('Failed to fetch child stats:', err);
      } finally {
        if (this.childId === requestedChild && serial === this.statsRequestId) this.loadingStats = false;
      }
    },

    clearChild() {
      this.setChild(null);
    },

    switchAccount() {
      // A parent can browse another child without ending the parent's identity.
      if (currentRole() === 'child') endSession();
      this.clearChild();
    }
  }
});
