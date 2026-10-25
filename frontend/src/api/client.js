import { requireFamilyDate, FAMILY_DATE_REQUIRED } from '../utils/calendarWriteGuard.js';
import axios from 'axios';
import { getToken, saveToken, clearTokens, currentRole, getDataGeneration, saveDataGeneration, clearDataGeneration } from '../utils/session.js';
import { pendingWriteStore, activeWrites, notifyPendingWrites } from '../utils/requestId.js';

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 15000 });
let calibration;
async function ensureDataGeneration() {
  const token = getToken();
  if (!token || getDataGeneration()) return;
  if (!calibration || calibration.token !== token) {
    const promise = client.get('/auth/data-generation').then(response => saveDataGeneration(response.data.data_generation, token));
    calibration = { token, promise };
    promise.finally(() => { if (calibration?.promise === promise) calibration = null; }).catch(() => {});
  }
  await calibration.promise;
}
client.interceptors.request.use(async config => {
  if (!['get', 'head', 'options'].includes(config.method) && !config.url.startsWith('/auth/')) requireFamilyDate();
  if (!config.url.startsWith('/auth/')) await ensureDataGeneration();
  if (!['get', 'head', 'options'].includes(config.method) && !config.url.startsWith('/auth/')) requireFamilyDate();
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
client.interceptors.response.use(response => response, error => {
  if (error === FAMILY_DATE_REQUIRED) return Promise.reject(error);
  if (axios.isCancel(error)) return Promise.reject(error);
  // This browser lost or never had device authorization: show the pairing page.
  if (error.response?.data?.code === 'DEVICE_NOT_AUTHORIZED' && typeof window !== 'undefined') {
    window.location.href = '/api/device/page';
    return new Promise(() => {});
  }
  if (error.response?.status === 409 && error.response?.data?.code === 'DATA_RESTORED') {
    if (error.config.pendingRequestId) pendingWriteStore.discard(error.config.pendingRequestId);
    clearDataGeneration();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('taskie:data-restored'));
  }
  const login = error.config?.url?.includes('-login');
  if (error.response?.status === 401 && !login) clearTokens();
  const message = !error.response ? (error.config?.networkErrorMessage || '无法连接服务器，操作未确认。请检查网络后，在原处重试，或到“待确认请求”核对。')
    : error.response.data?.error || error.response.data?.message || '操作失败，请重试';
  const code = error.response?.data?.code;
  const silentError = typeof error.config?.silentError === 'function' ? error.config.silentError(error) : error.config?.silentError;
  if (!silentError && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('taskie:error', { detail: { message, status: error.response?.status, code, login } }));
  if (error.config?.preserveNetworkError && !error.response) return Promise.reject(Object.assign(new Error(message), { networkFailure: true }));
  return Promise.reject(error.config?.preserveError ? Object.assign(new Error(message), { status: error.response?.status }) : message);
});
const request = async (method, url, data, params, signal, options = {}) =>
  (await client.request({ ...options, method, url, data, params, signal, timeout: url.startsWith('/backups') ? 180000 : 15000 })).data;
const get = (url, params, signal, options) => request('get', url, undefined, params, signal, options);
const post = (url, data, options) => request('post', url, data, undefined, undefined, options);
const generationHeaders = generation => generation ? { 'X-Taskie-Data-Generation': generation } : {};
// Non-persisted practice/manual forms keep the same object for an uncertain attempt.
const requestGenerations = new WeakMap();
const invalidAttempts = new WeakSet();
async function idempotentPost(url, data, options = {}) {
  requireFamilyDate();
  if (invalidAttempts.has(data)) throw '数据已恢复，这次操作没有执行，请核对后重新操作';
  await ensureDataGeneration();
  if (!requestGenerations.has(data)) requestGenerations.set(data, getDataGeneration());
  try { return await post(url, data, { ...options, headers: generationHeaders(requestGenerations.get(data)) }); }
  catch (error) {
    if (error === '数据已恢复，这次操作没有执行，请核对后重新操作') invalidAttempts.add(data);
    throw error;
  }
}
const put = (url, data, options) => request('put', url, data, undefined, undefined, options);
const remove = (url, options) => request('delete', url, undefined, undefined, undefined, options);

async function sendPendingWrite(entry) {
  requireFamilyDate();
  if (activeWrites.has(entry.request_id)) throw '请求正在确认，请稍候';
  activeWrites.add(entry.request_id);
  notifyPendingWrites();
  try {
    const url = entry.kind === 'redemption' ? `/children/${entry.child_id}/redemptions` : `/period-tasks/${entry.task_id}/logs`;
    const result = await post(url, { ...entry.payload, request_id: entry.request_id }, { headers: generationHeaders(entry.data_generation), pendingRequestId: entry.request_id });
    pendingWriteStore.done(entry.request_id);
    return result;
  } finally { activeWrites.delete(entry.request_id); notifyPendingWrites(); }
}

async function pendingWrite(action, attempt) {
  requireFamilyDate();
  try {
    // Validate a suspended form before calibrating or sending anything. Its original
    // entry supplies the generation, including a legacy entry that has none.
    if (!attempt?.request_id) await ensureDataGeneration();
    return await sendPendingWrite(pendingWriteStore.prepare({ ...action, role: currentRole(), data_generation: getDataGeneration() || undefined }, attempt));
  }
  catch (err) { return Promise.reject(typeof err === 'string' ? err : err.message || '无法保存待确认请求，请允许会话存储后重试'); }
}

export const api = {
  async loginParent({ pin }) {
    const result = await post('/auth/parent-login', { pin });
    if (!result.success) throw result.error;
    saveToken('parent', result.token, result.data_generation);
    return result;
  },
  async loginChild({ child_id, pin }) {
    const result = await post('/auth/child-login', { child_id, pin });
    if (!result.success) throw result.error;
    saveToken('child', result.token, result.data_generation);
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
  getUnfinishedStudy: id => get(`/children/${id}/unfinished-study`),
  getCalendar: () => get('/calendar', undefined, undefined, { silentError: true }),
  // The running timer, else the latest one paused; pausing keeps it, resuming starts it again.
  getCurrentTimer: id => get(`/children/${id}/current-timer`),
  // target: the timer the bar showed, so a change made meanwhile on another device is not overridden.
  pauseCurrentTimer: (id, target) => post(`/children/${id}/current-timer/pause`, { target }),
  resumeCurrentTimer: (id, target) => post(`/children/${id}/current-timer/resume`, { target }),
  // data.duration_seconds: the time a timed task took (null for none); left out, the timer's time counts.
  getBackfillTasks: (id, date) => get('/daily-tasks/backfill', { child_id: id, date }),
  materializeBackfillDay: (id, date) => post('/daily-tasks/backfill/day', { child_id: id, date }),
  backfillDailyTask: (id, data) => post(`/daily-tasks/${id}/backfill`, data),
  undoBackfillDailyTask: id => post(`/daily-tasks/${id}/undo-backfill`),
  completeDailyTask: (id, data) => post(`/daily-tasks/${id}/complete`, data),
  taskTimer: (id, action) => post(`/daily-tasks/${id}/timer/${action}`),
  getTaskStudy: id => get(`/daily-tasks/${id}/study`),
  correctTaskLegacy: (id, data) => put(`/daily-tasks/${id}/study/legacy`, data),
  startTaskStudy: id => post(`/daily-tasks/${id}/study/start`),
  pauseTaskStudy: (id, sid) => post(`/daily-tasks/${id}/sessions/${sid}/pause`),
  finishTaskStudy: (id, sid, data) => post(`/daily-tasks/${id}/sessions/${sid}/finish`, data),
  addTaskStudy: (id, data) => idempotentPost(`/daily-tasks/${id}/sessions`, data),
  editTaskStudy: (id, sid, data) => put(`/daily-tasks/${id}/sessions/${sid}`, data),
  completeTaskStudy: (id, data = {}, options) => idempotentPost(`/daily-tasks/${id}/study/complete`, data, options),
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
  getWordStudy: id => get(`/children/${id}/word-study`),
  getWordStudyHistory: id => get(`/children/${id}/word-study/history`),
  saveWordStudyPlan: (id, skill, data) => put(`/children/${id}/word-study/plans/${skill}`, data),
  addWordStudyExtra: (id, requestId) => idempotentPost(`/word-study/days/${id}/extra`, { request_id: requestId }),
  gradeWordStudyItem: (id, data) => idempotentPost(`/word-study/items/${id}/attempts`, data, {
    preserveNetworkError: true,
    // The practice dialog provides recovery only for this specific date rejection.
    silentError: error => error.response?.status === 403 && error.response?.data?.error === '只能记录今天实际进行的练习'
  }),
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
  requestRedemption: (id, rewardId, title, childName) => pendingWrite({ kind: 'redemption', child_id: id, child_name: childName, task_id: rewardId, title, payload: { reward_id: rewardId } }),
  retryPendingWrite: entry => sendPendingWrite(entry),
  getRedemptions: (status, params = {}) => get('/redemptions', { ...params, status }),
  approveRedemption: id => post(`/redemptions/${id}/approve`),
  rejectRedemption: id => post(`/redemptions/${id}/reject`),
  cancelRedemption: id => post(`/redemptions/${id}/cancel`),
  getAdhocTasks: id => get(`/children/${id}/adhoc-tasks`),
  createAdhocTask: (childId, data) => post(`/children/${childId}/adhoc-tasks`, data),
  deleteAdhocTask: id => remove(`/adhoc-tasks/${id}`),
  getHomeworkStudy: id => get(`/homework/${id}/study`),
  correctHomeworkLegacy: (id, data) => put(`/homework/${id}/study/legacy`, data),
  startHomeworkStudy: id => post(`/homework/${id}/study/start`),
  pauseHomeworkStudy: (id, sid) => post(`/homework/${id}/sessions/${sid}/pause`),
  finishHomeworkStudy: (id, sid, data) => post(`/homework/${id}/sessions/${sid}/finish`, data),
  addHomeworkStudy: (id, data) => idempotentPost(`/homework/${id}/sessions`, data),
  editHomeworkStudy: (id, sid, data) => put(`/homework/${id}/sessions/${sid}`, data),
  completeHomework: (id, data = {}, options) => idempotentPost(`/homework/${id}/complete`, data, options),
  rejectHomeworkCompletion: id => post(`/homework/${id}/reject-completion`),
  getHomeworkCompletionRequests: () => get('/homework-completion-requests'),
  getHomework: (childId, params = {}) => get(`/children/${childId}/homework`, params),
  getHomeworkCourses: childId => get(`/children/${childId}/homework/courses`),
  getHomeworkSummary: (childId, params = {}) => get(`/children/${childId}/homework/summary`, params),
  suggestHomework: (childId, params) => get(`/children/${childId}/homework/suggest`, params),
  createHomework: (childId, data) => post(`/children/${childId}/homework`, data),
  updateHomework: (id, data) => put(`/homework/${id}`, data),
  deleteHomework: (id, deleteTask = false) => remove(`/homework/${id}${deleteTask ? '?delete_task=1' : ''}`),
  createHomeworkTask: (id, data = {}) => post(`/homework/${id}/task`, data),
  rejectHomeworkTask: id => post(`/homework/${id}/reject-task`),
  getHomeworkRequests: () => get('/homework-requests'),
  setHomeworkCoursePoints: (courseKey, points) => put('/homework-course-points', { course_key: courseKey, points }),
  getChildPeriods: id => get(`/children/${id}/periods`),
  getChildGoals: id => get(`/children/${id}/goals`),
  createGoal: (childId, data) => post(`/children/${childId}/goals`, data),
  createPeriod: (childId, data) => post(`/children/${childId}/periods`, data),
  updatePeriod: (id, data) => put(`/periods/${id}`, data),
  deletePeriod: id => remove(`/periods/${id}`),
  createPeriodTask: (periodId, data) => post(`/periods/${periodId}/tasks`, data),
  updatePeriodTask: (id, data) => put(`/period-tasks/${id}`, data),
  deletePeriodTask: id => remove(`/period-tasks/${id}`),
  logPeriodProgress: (taskId, data, { childId, childName, title, backfill = false, attempt }) => pendingWrite({ kind: backfill ? 'backfill' : 'progress', child_id: childId, child_name: childName, task_id: taskId, title, payload: data }, attempt),
  deletePeriodLog: id => remove(`/period-task-logs/${id}`),
  getChildSchedule: (id, from, to = from) => get(`/children/${id}/schedule`, { from, to }),
  getTimeStats: (id, from, to, signal) => get(`/children/${id}/time-stats`, { from, to }, signal),
  getTimetables: (childId, signal) => get(`/children/${childId}/timetables`, undefined, signal),
  createTimetable: (childId, data) => post(`/children/${childId}/timetables`, data),
  updateTimetable: (id, data) => put(`/timetables/${id}`, data),
  deleteTimetable: id => remove(`/timetables/${id}`),
  getOutsideClasses: () => get('/outside-classes'),
  getOutsideClassStats: childId => get('/outside-classes/stats', { child_id: childId }),
  getOutsideClassDetails: (id, childId, from, to) => get(`/outside-classes/${id}/stats`, { child_id: childId, from, to }),
  setClassAttendance: (id, data, options) => put(`/outside-classes/${id}/attendance`, data, options),
  setClassFee: (id, data) => put(`/outside-classes/${id}/fee`, data),
  createOutsideClass: data => post('/outside-classes', data),
  updateOutsideClass: (id, data) => put(`/outside-classes/${id}`, data),
  deleteOutsideClass: id => remove(`/outside-classes/${id}`),
  setClassException: (classId, data, options) => put(`/outside-classes/${classId}/exceptions`, data, options),
  deleteClassException: (id, options) => remove(`/outside-class-exceptions/${id}`, options),
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
  // A direct link with a short-lived ticket, so a large photo package is not held in page memory.
  photoPackageTicket: (scope = 'all') => post('/backups/photos/export-ticket', { scope }),
  async importPhotos(file, onUploadProgress) {
    const data = new FormData(); data.append('file', file);
    return (await client.post('/backups/photos/import', data, { timeout: 0, onUploadProgress })).data;
  },
  changeParentPin: (oldPin, newPin) => put('/auth/parent-pin', { old_pin: oldPin, new_pin: newPin })
};
export default api;
