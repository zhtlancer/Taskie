import { defineStore } from 'pinia';
import api from '../api/client';
import { withClock } from '../utils/taskTimer.js';

// The child's current timer (running, or the latest one paused), shown on every page of the child's
// space. Pages that start or stop timers refresh it; changedAt tells the today board to reload after
// the bar paused or resumed a timer.
export const useRunningTimerStore = defineStore('runningTimer', {
  state: () => ({ childId: null, timer: null, serial: 0, busy: false, error: '', changedAt: 0 }),

  actions: {
    async refresh(childId = this.childId) {
      if (!childId) return;
      if (childId !== this.childId) Object.assign(this, { childId, timer: null, error: '' });
      const serial = ++this.serial;
      try {
        const { timer } = await api.getCurrentTimer(childId);
        if (serial === this.serial && childId === this.childId) this.timer = timer && withClock(timer);
      } catch (err) {
        console.error('Failed to load the current timer:', err);
      }
    },

    async change(request) {
      if (!this.timer || this.busy) return;
      const childId = this.childId, serial = ++this.serial;
      this.busy = true;
      this.error = '';
      try {
        const { timer } = await request(childId);
        if (childId !== this.childId) return;
        // A concurrent read may describe either the old timer or a newly started one. Read again
        // after the response instead of guessing which state that response should replace.
        if (serial === this.serial) this.timer = timer && withClock(timer);
        else await this.refresh(childId);
        if (childId !== this.childId) return;
        this.changedAt = Date.now();
      } catch (err) {
        console.error('Failed to change the current timer:', err);
        if (childId !== this.childId) return;
        const message = this.error = typeof err === 'string' ? err : '操作失败，请重试';
        setTimeout(() => { if (this.error === message) this.error = ''; }, 5000);
        await this.refresh(childId);
      } finally {
        this.busy = false;
      }
    },

    pause() { return this.change(api.pauseCurrentTimer); },
    resume() { return this.change(api.resumeCurrentTimer); }
  }
});
