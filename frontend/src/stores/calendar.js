import { defineStore } from 'pinia';
import { onScopeDispose } from 'vue';
import api from '../api/client';
import { createCalendarState } from '../utils/calendarState.js';
import { familyDateConfirmed } from '../utils/calendarWriteGuard.js';

export const useCalendarStore = defineStore('calendar', () => {
  const state = createCalendarState(api.getCalendar, { confirmed: familyDateConfirmed });
  state.start();
  onScopeDispose(state.stop);
  return state;
});
