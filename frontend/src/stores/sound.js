import { defineStore } from 'pinia';
import {
  isMuted,
  setMuted,
  toggleMute,
  playTaskComplete,
  playTaskUncomplete,
  playAllDone,
  playBadgeUnlocked,
  playClick,
  playCameraShutter,
  initAudioUnlock
} from '../utils/sound';

export const useSoundStore = defineStore('sound', {
  state: () => ({
    muted: isMuted()
  }),

  getters: {
    isSoundMuted: (state) => state.muted,
  },

  actions: {
    toggle() {
      const next = toggleMute();
      this.muted = next;
      return next;
    },

    setMute(val) {
      setMuted(val);
      this.muted = Boolean(val);
    },

    init() {
      this.muted = isMuted();
      initAudioUnlock();
    },

    playTaskComplete() {
      playTaskComplete();
    },

    playTaskUncomplete() {
      playTaskUncomplete();
    },

    playAllDone() {
      playAllDone();
    },

    playBadgeUnlocked() {
      playBadgeUnlocked();
    },

    playClick() {
      playClick();
    },

    playCameraShutter() {
      playCameraShutter();
    }
  }
});
