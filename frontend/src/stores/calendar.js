import { defineStore } from 'pinia';
import api from '../api/client';
import { createCalendarState } from '../utils/calendarState.js';

export const useCalendarStore = defineStore('calendar', () => createCalendarState(api.getCalendar));
