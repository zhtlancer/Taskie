import { defineStore } from 'pinia';
import api from '../api/client';
import { withClock } from '../utils/taskTimer.js';

// The child's one running timer, shown on every page of the child's space. Pages that start or stop
// timers refresh it; pausedAt tells the today board to reload after the bar paused a timer.
export const useRunningTimerStore = defineStore('runningTimer', {
  state: () => ({ childId: null, timer: null, serial: 0, pausing: false, pausedAt: 0 }),

  actions: {
    async refresh(childId = this.childId) {
      if (!childId) return;
      if (childId !== this.childId) Object.assign(this, { childId, timer: null });
      const serial = ++this.serial;
      try {
        const { timer } = await api.getRunningTimer(childId);
        if (serial === this.serial && childId === this.childId) this.timer = timer && withClock({ ...timer, timer_running: true });
      } catch (err) {
        console.error('Failed to load the running timer:', err);
      }
    },

    async pause() {
      if (!this.timer || this.pausing) return;
      const childId = this.childId, serial = ++this.serial;
      this.pausing = true;
      try {
        const { timer } = await api.pauseRunningTimer(childId);
        if (childId !== this.childId) return;
        // A concurrent read may describe either the old timer or a newly started one. Read again
        // after the pause response instead of guessing which state that response should replace.
        if (serial === this.serial) this.timer = timer && withClock({ ...timer, timer_running: true });
        else await this.refresh(childId);
        if (childId !== this.childId) return;
        this.pausedAt = Date.now();
      } catch (err) {
        console.error('Failed to pause the running timer:', err);
        if (childId === this.childId) await this.refresh(childId);
      } finally {
        this.pausing = false;
      }
    }
  }
});
