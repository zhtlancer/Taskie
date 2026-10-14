import axios from 'axios';
import { getToken, saveToken, clearTokens } from '../utils/session.js';

export const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
let mockStore;
const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 15000 });
client.interceptors.request.use(config => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
client.interceptors.response.use(response => response, error => {
  const login = error.config?.url?.includes('-login');
  if (error.response?.status === 401 && !login) clearTokens();
  const message = !error.response ? '无法连接服务器，操作未确认。请检查网络并刷新重试。'
    : error.response.data?.error || error.response.data?.message || '操作失败，请重试';
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('taskie:error', { detail: { message, status: error.response?.status, login } }));
  return Promise.reject(message);
});
const request = async (method, url, data, demo, params) => {
  if (demoMode) {
    mockStore ||= (await import('./mockStore')).mockStore;
    return demo();
  }
  return (await client.request({ method, url, data, params, timeout: url.startsWith('/backups') ? 180000 : 15000 })).data;
};
const get = (url, demo, params) => request('get', url, undefined, demo, params);
const post = (url, data, demo) => request('post', url, data, demo);
const put = (url, data, demo) => request('put', url, data, demo);
const remove = (url, demo) => request('delete', url, undefined, demo);

export const api = {
  async loginParent({ pin }) {
    const result = await post('/auth/parent-login', { pin }, () => mockStore.parentLogin(pin));
    if (!result.success) throw result.error;
    saveToken('parent', result.token || 'demo-parent');
    return result;
  },
  async loginChild({ child_id, pin }) {
    const result = await post('/auth/child-login', { child_id, pin }, () => mockStore.childLogin(child_id, pin));
    if (!result.success) throw result.error;
    clearTokens();
    saveToken('child', result.token || 'demo-child');
    return result;
  },
  getChildren: () => get('/children', () => mockStore.getChildren()),
  createChild: data => post('/children', data, () => mockStore.createChild(data)),
  updateChild: (id, data) => put(`/children/${id}`, data, () => mockStore.updateChild(id, data)),
  deleteChild: id => remove(`/children/${id}`, () => mockStore.deleteChild(id)),
  getTaskTemplates: () => get('/task-templates', () => mockStore.getTemplates()),
  createTaskTemplate: data => post('/task-templates', data, () => mockStore.createTemplate(data)),
  updateTaskTemplate: (id, data) => put(`/task-templates/${id}`, data, () => mockStore.updateTemplate(id, data)),
  deleteTaskTemplate: id => remove(`/task-templates/${id}`, () => mockStore.deleteTemplate(id)),
  getDailyTasks: (id, date) => get('/daily-tasks', () => mockStore.getDailyTasks(id, date), { child_id: id, date }),
  completeDailyTask: id => post(`/daily-tasks/${id}/complete`, undefined, () => mockStore.completeTask(id)),
  uncompleteDailyTask: id => post(`/daily-tasks/${id}/uncomplete`, undefined, () => mockStore.uncompleteTask(id)),
  getChildStats: id => get(`/children/${id}/stats`, () => mockStore.getChildStats(id)),
  getChildBadges: id => get(`/children/${id}/badges`, () => mockStore.getChildBadges(id)),
  getBadgeDefinitions: () => get('/badge-definitions', () => mockStore.getBadgeDefinitions()),
  getHistory: (id, days = 30) => get(`/children/${id}/history`, () => mockStore.getHistory(id, days), { days }),
  getWeeklySummary: id => get(`/children/${id}/weekly-summary`, () => mockStore.getWeeklySummary(id)),
  getPointLogs: id => get(`/children/${id}/point-logs`, () => mockStore.getPointLogs(id)),
  getMistakes: (id, subject) => get('/mistakes', () => mockStore.getMistakes(id, subject), { child_id: id, subject: subject === '全部' ? undefined : subject }),
  async createMistake(data) {
    let payload = data;
    if (!(data instanceof FormData) && (data.photo_file || data.photoFile)) {
      payload = new FormData();
      for (const field of ['child_id', 'subject', 'description']) payload.append(field, data[field]);
      const file = data.photo_file || data.photoFile;
      payload.append('file', file, file.name || 'mistake.webp');
    }
    const value = key => payload instanceof FormData ? payload.get(key) : payload[key];
    return post('/mistakes', payload, () => mockStore.createMistake({ child_id: value('child_id'), subject: value('subject'), description: value('description'), photo_path: value('photo_data_url') || value('photo_path') }));
  },
  markMistakeMastered: (id, mastered = true) => put(`/mistakes/${id}/master`, { is_mastered: mastered }, () => mockStore.markMistakeMastered(id, mastered)),
  deleteMistake: id => remove(`/mistakes/${id}`, () => mockStore.deleteMistake(id)),
  getCharacters: (id, mastered = null) => get('/characters', () => mockStore.getCharacters(id, mastered), { child_id: id, is_mastered: mastered === null ? undefined : Number(Boolean(mastered)) }),
  createCharacter: data => post('/characters', data, () => mockStore.createCharacter(data)),
  markCharacterMastered: (id, mastered = null) => put(`/characters/${id}/master`, { is_mastered: mastered }, () => mockStore.markCharacterMastered(id, mastered)),
  deleteCharacter: id => remove(`/characters/${id}`, () => mockStore.deleteCharacter(id)),
  async loadPhoto(url) {
    if (!url.startsWith('/uploads/')) return url;
    const response = await client.get(url.replace('/uploads/', '../uploads/'), { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
  getRewardItems: () => get('/reward-items', () => mockStore.getRewardItems()),
  createRewardItem: data => post('/reward-items', data, () => mockStore.createRewardItem(data)),
  updateRewardItem: (id, data) => put(`/reward-items/${id}`, data, () => mockStore.updateRewardItem(id, data)),
  deleteRewardItem: id => remove(`/reward-items/${id}`, () => mockStore.deleteRewardItem(id)),
  getChildRedemptions: (id, params = {}) => get(`/children/${id}/redemptions`, () => mockStore.getRedemptions({ ...params, childId: id }), params),
  requestRedemption: (id, rewardId) => post(`/children/${id}/redemptions`, { reward_id: rewardId }, () => mockStore.requestRedemption(id, rewardId)),
  getRedemptions: (status, params = {}) => get('/redemptions', () => mockStore.getRedemptions({ ...params, status }), { ...params, status }),
  approveRedemption: id => post(`/redemptions/${id}/approve`, undefined, () => mockStore.resolveRedemption(id, 'approved')),
  rejectRedemption: id => post(`/redemptions/${id}/reject`, undefined, () => mockStore.resolveRedemption(id, 'rejected')),
  cancelRedemption: id => post(`/redemptions/${id}/cancel`, undefined, () => mockStore.resolveRedemption(id, 'cancelled')),
  getBackups: () => get('/backups', () => ({ backups: [], interval_hours: 0, retention: 0 })),
  createBackup: () => post('/backups', undefined, () => { throw '演示模式不支持备份'; }),
  async downloadBackup(name) { return (await client.get(`/backups/${encodeURIComponent(name)}/download`, { responseType: 'blob', timeout: 180000 })).data; },
  restoreBackup(file, pin) {
    const data = new FormData(); data.append('pin', pin); data.append('file', file);
    return post('/backups/restore', data, () => { throw '演示模式不支持恢复'; });
  },
  changeParentPin: (oldPin, newPin) => put('/auth/parent-pin', { old_pin: oldPin, new_pin: newPin }, () => { throw '演示模式不支持修改 PIN'; })
};
export default api;
