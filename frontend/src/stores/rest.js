import { defineStore } from 'pinia';
import { clearRest, readRest, saveRest } from '../utils/rest.js';

// The child's rest countdown on this device, shared by the timer bar (phone), the sidebar card
// (tablet) and the countdown dialog.
export const useRestStore = defineStore('rest', {
  state: () => ({ childId: null, rest: null, picking: false, minimized: false, resumeRequested: 0 }),

  actions: {
    load(childId) {
      Object.assign(this, { childId, rest: readRest(childId), picking: false, minimized: false });
    },
    start(minutes, target) {
      Object.assign(this, { rest: saveRest(this.childId, minutes, Date.now(), undefined, target), picking: false, minimized: false });
    },
    end() {
      clearRest(this.childId);
      Object.assign(this, { rest: null, minimized: false });
    }
  }
});
