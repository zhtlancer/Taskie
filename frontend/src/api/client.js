import axios from 'axios';
import { getToken, saveToken, clearTokens } from '../utils/session.js';

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 15000 });
client.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
client.interceptors.response.use(response => response, error => {
  if (axios.isCancel(error)) return Promise.reject(error);
  // This browser lost or never had device authorization: show the pairing page.
  if (error.response?.data?.code === 'DEVICE_NOT_AUTHORIZED' && typeof window !== 'undefined') {
    window.location.href = '/api/device/page';
    return new Promise(() => {});
  }
  const login = error.config?.url?.includes('-login');
  if (error.response?.status === 401 && !login) clearTokens();
  const message = !error.response ? '无法连接服务器，操作未确认。请检查网络并刷新重试。'
    : error.response.data?.error || error.response.data?.message || '操作失败，请重试';
  const code = error.response?.data?.code;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('taskie:error', { detail: { message, status: error.response?.status, code, login } }));
  return Promise.reject(message);
});
const request = async (method, url, data, params, signal) =>
  (await client.request({ method, url, data, params, signal, timeout: url.startsWith('/backups') ? 180000 : 15000 })).data;
const get = (url, params, signal) => request('get', url, undefined, params, signal);
const post = (url, data) => request('post', url, data);
const put = (url, data) => request('put', url, data);
const remove = url => request('delete', url);

export const api = {
  async loginParent({ pin }) {
    const result = await post('/auth/parent-login', { pin });
    if (!result.success) throw result.error;
    saveToken('parent', result.token);
    return result;
  },
  async loginChild({ child_id, pin }) {
    const result = await post('/auth/child-login', { child_id, pin });
    if (!result.success) throw result.error;
    clearTokens();
    saveToken('child', result.token);
    return result;
  },
  getAuthSetup: () => get('/auth/setup'),
  getChildren: () => get('/children'),
  createChild: data => post('/children', data),
  updateChild: (id, data) => put(`/children/${id}`, data),
  deleteChild: id => remove(`/children/${id}`),
  getTaskTemplates: () => get('/task-templates'),
  createTaskTemplate: data => post('/task-templates', data),
  updateTaskTemplate: (id, data) => put(`/task-templates/${id}`, data),
  deleteTaskTemplate: id => remove(`/task-templates/${id}`),
  getDailyTasks: (id, date) => get('/daily-tasks', { child_id: id, date }),
  // data.duration_seconds: the time a timed task took (null for none); left out, the timer's time counts.
  completeDailyTask: (id, data) => post(`/daily-tasks/${id}/complete`, data),
  taskTimer: (id, action) => post(`/daily-tasks/${id}/timer/${action}`),
  setTaskDuration: (id, seconds) => put(`/daily-tasks/${id}/duration`, { duration_seconds: seconds }),
  goalTimer: (id, action) => post(`/period-tasks/${id}/timer/${action}`),
  setGoalLogDuration: (id, seconds) => put(`/period-task-logs/${id}/duration`, { duration_seconds: seconds }),
  uncompleteDailyTask: id => post(`/daily-tasks/${id}/uncomplete`),
  skipDailyTask: (id, reason) => post(`/daily-tasks/${id}/skip`, { reason }),
  unskipDailyTask: id => post(`/daily-tasks/${id}/unskip`),
  getSkipRequests: (status, params = {}) => get('/skip-requests', { ...params, status }),
  approveSkipRequest: id => post(`/skip-requests/${id}/approve`),
  rejectSkipRequest: id => post(`/skip-requests/${id}/reject`),
  cancelSkipRequest: id => post(`/skip-requests/${id}/cancel`),
  getChildStats: id => get(`/children/${id}/stats`),
  getChildBadges: id => get(`/children/${id}/badges`),
  getBadgeDefinitions: () => get('/badge-definitions'),
  getHistory: (id, days = 30) => get(`/children/${id}/history`, { days }),
  getWeeklySummary: id => get(`/children/${id}/weekly-summary`),
  getPointLogs: id => get(`/children/${id}/point-logs`),
  getMistakes: (id, subject) => get('/mistakes', { child_id: id, subject: subject === '全部' ? undefined : subject }),
  createMistake(data) {
    let payload = data;
    if (!(data instanceof FormData) && (data.photo_file || data.photoFile)) {
      payload = new FormData();
      for (const field of ['child_id', 'subject', 'description']) payload.append(field, data[field]);
      const file = data.photo_file || data.photoFile;
      payload.append('file', file, file.name || 'mistake.webp');
    }
    return post('/mistakes', payload);
  },
  markMistakeMastered: (id, mastered = true) => put(`/mistakes/${id}/master`, { is_mastered: mastered }),
  deleteMistake: id => remove(`/mistakes/${id}`),
  getCharacters: (id, mastered = null) => get('/characters', { child_id: id, is_mastered: mastered === null ? undefined : Number(Boolean(mastered)) }),
  createCharacter: data => post('/characters', data),
  markCharacterMastered: (id, mastered = null) => put(`/characters/${id}/master`, { is_mastered: mastered }),
  deleteCharacter: id => remove(`/characters/${id}`),
  setCharacterCategories: (id, categories) => put(`/characters/${id}/categories`, { categories }),
  async loadPhoto(url) {
    if (!url.startsWith('/uploads/')) return url;
    const response = await client.get(url.replace('/uploads/', '../uploads/'), { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
  getRewardItems: () => get('/reward-items'),
  createRewardItem: data => post('/reward-items', data),
  updateRewardItem: (id, data) => put(`/reward-items/${id}`, data),
  deleteRewardItem: id => remove(`/reward-items/${id}`),
  getChildRedemptions: (id, params = {}) => get(`/children/${id}/redemptions`, params),
  requestRedemption: (id, rewardId) => post(`/children/${id}/redemptions`, { reward_id: rewardId }),
  getRedemptions: (status, params = {}) => get('/redemptions', { ...params, status }),
  approveRedemption: id => post(`/redemptions/${id}/approve`),
  rejectRedemption: id => post(`/redemptions/${id}/reject`),
  cancelRedemption: id => post(`/redemptions/${id}/cancel`),
  getAdhocTasks: id => get(`/children/${id}/adhoc-tasks`),
  createAdhocTask: (childId, data) => post(`/children/${childId}/adhoc-tasks`, data),
  deleteAdhocTask: id => remove(`/adhoc-tasks/${id}`),
  getChildPeriods: id => get(`/children/${id}/periods`),
  getChildGoals: id => get(`/children/${id}/goals`),
  createGoal: (childId, data) => post(`/children/${childId}/goals`, data),
  createPeriod: (childId, data) => post(`/children/${childId}/periods`, data),
  updatePeriod: (id, data) => put(`/periods/${id}`, data),
  deletePeriod: id => remove(`/periods/${id}`),
  createPeriodTask: (periodId, data) => post(`/periods/${periodId}/tasks`, data),
  updatePeriodTask: (id, data) => put(`/period-tasks/${id}`, data),
  deletePeriodTask: id => remove(`/period-tasks/${id}`),
  logPeriodProgress: (taskId, data) => post(`/period-tasks/${taskId}/logs`, data),
  deletePeriodLog: id => remove(`/period-task-logs/${id}`),
  getChildSchedule: (id, from, to = from) => get(`/children/${id}/schedule`, { from, to }),
  getTimeStats: (id, from, to, signal) => get(`/children/${id}/time-stats`, { from, to }, signal),
  getTimetables: (childId, signal) => get(`/children/${childId}/timetables`, undefined, signal),
  createTimetable: (childId, data) => post(`/children/${childId}/timetables`, data),
  updateTimetable: (id, data) => put(`/timetables/${id}`, data),
  deleteTimetable: id => remove(`/timetables/${id}`),
  getOutsideClasses: () => get('/outside-classes'),
  createOutsideClass: data => post('/outside-classes', data),
  updateOutsideClass: (id, data) => put(`/outside-classes/${id}`, data),
  deleteOutsideClass: id => remove(`/outside-classes/${id}`),
  setClassException: (classId, data) => put(`/outside-classes/${classId}/exceptions`, data),
  deleteClassException: id => remove(`/outside-class-exceptions/${id}`),
  getMakeupDays: childId => get(`/children/${childId}/makeup-days`),
  createMakeupDay: (childId, data) => post(`/children/${childId}/makeup-days`, data),
  deleteMakeupDay: id => remove(`/makeup-days/${id}`),
  getDevices: () => get('/devices'),
  approveDevice: (code, label) => post('/devices/approve', { code, label }),
  revokeDevice: id => remove(`/devices/${id}`),
  getDeviceEvents: () => get('/devices/events?limit=50'),
  getBackups: () => get('/backups'),
  createBackup: () => post('/backups'),
  async downloadBackup(name) { return (await client.get(`/backups/${encodeURIComponent(name)}/download`, { responseType: 'blob', timeout: 180000 })).data; },
  restoreBackup(file, pin) {
    const data = new FormData(); data.append('pin', pin); data.append('file', file);
    return post('/backups/restore', data);
  },
  changeParentPin: (oldPin, newPin) => put('/auth/parent-pin', { old_pin: oldPin, new_pin: newPin })
};
export default api;
