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
client.interceptors.response.use(response => response, async error => {
  if (error === FAMILY_DATE_REQUIRED) return Promise.reject(error);
  if (axios.isCancel(error)) return Promise.reject(error);
  // Audio requests return Blob on success, but their failure body is still JSON.
  if (error.config?.responseType === 'blob' && typeof Blob !== 'undefined' && error.response?.data instanceof Blob && error.response.data.size <= 65536) {
    try { error.response.data = JSON.parse(await error.response.data.text()); } catch {}
  }
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
  if ((!silentError || (error.response?.status === 401 && !login)) && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('taskie:error', { detail: { message, status: error.response?.status, code, login } }));
  if (error.config?.preserveNetworkError && !error.response) return Promise.reject(Object.assign(new Error(message), { networkFailure: true }));
  return Promise.reject(error.config?.preserveError ? Object.assign(new Error(message), {
    status: error.response?.status, code,
    ...(Array.isArray(error.response?.data?.conflicts) ? { conflicts: error.response.data.conflicts } : {})
  }) : message);
});
const requestTimeout = (url, data) => {
  if (url.startsWith('/backups')) return 180000;
  // A cold dictionary query waits for a shared background build on slower devices.
  if ((url.startsWith('/dictionary/') && url !== '/dictionary/status') ||
    (url === '/english-words/batch-preview' && data?.use_dictionary !== false)) return 120000;
  return 15000;
};
const request = async (method, url, data, params, signal, options = {}) =>
  (await client.request({ ...options, method, url, data, params, signal, timeout: requestTimeout(url, data) })).data;
const get = (url, params, signal, options) => request('get', url, undefined, params, signal, options);
const post = (url, data, options) => request('post', url, data, undefined, undefined, options);
const generationHeaders = generation => generation ? { 'X-Taskie-Data-Generation': generation } : {};
const formOptions = generation => ({ headers: generationHeaders(generation), preserveError: true, silentError: true,
  networkErrorMessage: '连接中断，保存结果尚未确认，请在当前表单按原内容重试。' });
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

async function sendPendingWrite(entry, options = {}) {
  requireFamilyDate();
  if (activeWrites.has(entry.request_id)) throw '请求正在确认，请稍候';
  activeWrites.add(entry.request_id);
  notifyPendingWrites();
  try {
    const url = entry.kind === 'redemption' ? `/children/${entry.child_id}/redemptions` : `/period-tasks/${entry.task_id}/logs`;
    const result = await post(url, { ...entry.payload, request_id: entry.request_id }, { ...options, headers: generationHeaders(entry.data_generation), pendingRequestId: entry.request_id });
    pendingWriteStore.done(entry.request_id);
    return result;
  } finally { activeWrites.delete(entry.request_id); notifyPendingWrites(); }
}

async function pendingWrite(action, attempt, options) {
  requireFamilyDate();
  try {
    // Validate a suspended form before calibrating or sending anything. Its original
    // entry supplies the generation, including a legacy entry that has none.
    if (!attempt?.request_id) await ensureDataGeneration();
    return await sendPendingWrite(pendingWriteStore.prepare({ ...action, role: currentRole(), data_generation: getDataGeneration() || undefined }, attempt), options);
  }
  catch (err) { return Promise.reject(options?.preserveError ? err : typeof err === 'string' ? err : err.message || '无法保存待确认请求，请允许会话存储后重试'); }
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
  getChildren: (signal, options) => get('/children', undefined, signal, options),
  createChild: data => post('/children', data),
  updateChild: (id, data) => put(`/children/${id}`, data),
  deleteChild: id => remove(`/children/${id}`),
  getTaskTemplates: () => get('/task-templates'),
  createTaskTemplate: data => post('/task-templates', data),
  updateTaskTemplate: (id, data) => put(`/task-templates/${id}`, data),
  deleteTaskTemplate: id => remove(`/task-templates/${id}`),
  getDailyTasks: (id, date, signal, options) => get('/daily-tasks', { child_id: id, date }, signal, options),
  setTaskPriority: (id, priority, generation) => put(`/daily-tasks/${id}/priority`, { priority }, { headers: generationHeaders(generation) }),
  getUnfinishedStudy: id => get(`/children/${id}/unfinished-study`),
  getCalendar: () => get('/calendar', undefined, undefined, { silentError: true }),
  // The running timer, else the latest one paused; pausing keeps it, resuming starts it again.
  getCurrentTimer: (id, signal, options) => get(`/children/${id}/current-timer`, undefined, signal, options),
  // target: the timer the bar showed, so a change made meanwhile on another device is not overridden.
  pauseCurrentTimer: (id, target) => post(`/children/${id}/current-timer/pause`, { target }),
  resumeCurrentTimer: (id, target) => post(`/children/${id}/current-timer/resume`, { target }),
  // data.duration_seconds: the time a timed task took (null for none); left out, the timer's time counts.
  getBackfillTasks: (id, date, signal, options) => get('/daily-tasks/backfill', { child_id: id, date }, signal, options),
  materializeBackfillDay: (id, date, options) => post('/daily-tasks/backfill/day', { child_id: id, date }, options),
  backfillDailyTask: (id, data, options) => post(`/daily-tasks/${id}/backfill`, data, options),
  undoBackfillDailyTask: (id, options) => post(`/daily-tasks/${id}/undo-backfill`, undefined, options),
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
  skipDailyTask: (id, reason, options) => post(`/daily-tasks/${id}/skip`, { reason }, options),
  unskipDailyTask: (id, options) => post(`/daily-tasks/${id}/unskip`, undefined, options),
  getSkipRequests: (status, params = {}, signal, options) => get('/skip-requests', { ...params, status }, signal, options),
  approveSkipRequest: (id, options) => post(`/skip-requests/${id}/approve`, undefined, options),
  rejectSkipRequest: (id, options) => post(`/skip-requests/${id}/reject`, undefined, options),
  cancelSkipRequest: id => post(`/skip-requests/${id}/cancel`),
  getChildStats: (id, signal, options) => get(`/children/${id}/stats`, undefined, signal, options),
  getChildBadges: (id, signal, options) => get(`/children/${id}/badges`, undefined, signal, options),
  getBadgeDefinitions: (signal, options) => get('/badge-definitions', undefined, signal, options),
  getHistory: (id, days = 30, signal, options) => get(`/children/${id}/history`, { days }, signal, options),
  getWeeklySummary: (id, signal, options) => get(`/children/${id}/weekly-summary`, undefined, signal, options),
  getPointLogs: (id, signal, options) => get(`/children/${id}/point-logs`, undefined, signal, options),
  getMistakes: (id, subject) => get('/mistakes', { child_id: id, subject: subject === '全部' ? undefined : subject }),
  getMistake: id => get(`/mistakes/${id}`),
  updateMistake: (id, data, generation) => put(`/mistakes/${id}`, data, formOptions(generation)),
  createMistake(data) {
    let payload = data;
    if (!(data instanceof FormData) && (data.photo_file || data.photoFile)) {
      payload = new FormData();
      for (const field of ['child_id', 'subject', 'description']) payload.append(field, data[field]);
      if (data.request_id) payload.append('request_id', data.request_id);
      const file = data.photo_file || data.photoFile;
      payload.append('file', file, file.name || 'mistake.webp');
    }
    return post('/mistakes', payload, formOptions(getDataGeneration()));
  },
  markMistakeMastered: (id, mastered = true) => put(`/mistakes/${id}/master`, { is_mastered: mastered }),
  deleteMistake: id => remove(`/mistakes/${id}`),
  getWordStudy: (id, language = 'zh', signal, options) => get(`/children/${id}/word-study`, language === 'en' ? { language: 'en' } : undefined, signal, options),
  getWordStudyHistory: (id, language = 'zh') => get(`/children/${id}/word-study/history`, language === 'en' ? { language: 'en' } : undefined),
  saveWordStudyPlan: (id, skill, data, language = data?.language || 'zh', options) => put(
    language === 'en' ? `/children/${id}/word-study/en/plans/${skill}` : `/children/${id}/word-study/plans/${skill}`,
    data, options
  ),
  addWordStudyExtra: (id, requestId) => idempotentPost(`/word-study/days/${id}/extra`, { request_id: requestId }),
  gradeWordStudyItem: (id, data) => idempotentPost(`/word-study/items/${id}/attempts`, data, {
    preserveNetworkError: true,
    // The practice dialog provides recovery only for this specific date rejection.
    silentError: error => error.response?.status === 403 && error.response?.data?.error === '只能记录今天实际进行的练习'
  }),
  getEnglishWords: (id, params = {}, signal, options) => get('/english-words', { child_id: id, ...params }, signal, options),
  getEnglishWordTaxonomy: (id, signal, options) => get('/english-words/taxonomy', { child_id: id }, signal, options),
  createEnglishWord: (data, options) => post('/english-words', data, options),
  previewEnglishBatch: (childId, text, options, useDictionary = true) => post('/english-words/batch-preview', { child_id: childId, text, use_dictionary: useDictionary }, options),
  commitEnglishBatch: (data, options) => post('/english-words/batch', data, options),
  updateEnglishWord: (id, data, options) => put(`/english-words/${id}`, data, options),
  markEnglishWordMastered: (id, mastered = null, options) => put(`/english-words/${id}/master`, { is_mastered: mastered }, options),
  setEnglishWordCategories: (id, categories, options) => put(`/english-words/${id}/categories`, { categories }, options),
  deleteEnglishWord: (id, options) => remove(`/english-words/${id}`, options),
  getDictionaryStatus: (signal, options) => get('/dictionary/status', undefined, signal, options),
  lookupDictionary: (word, signal, options) => get('/dictionary/lookup', { word }, signal, options),
  suggestDictionary: (prefix, limit = 10, signal, options) => get('/dictionary/suggest', { prefix, limit }, signal, options),
  getDictionaryArticle: (word, dictId = 'all', signal, options) => get('/dictionary/article', { word, dict_id: dictId }, signal, options),
  rebuildDictionaryIndex: (options) => post('/dictionary/rebuild-index', undefined, options),
  async fetchDictionaryImageBlob(url, signal) {
    if (!/^\/api\/dictionary\/image\/(?:oald8|mw11)\/[a-z0-9._-]+\?v=[a-f0-9]{64}$/i.test(url)) throw new Error('词典图片地址无效');
    const apiPath = url.slice(4);
    const response = await client.get(apiPath, { responseType: 'blob', signal, silentError: true, preserveError: true, timeout: requestTimeout(apiPath) });
    return response.data;
  },
  async fetchDictionaryAudioBlob(url, signal) {
    const apiPath = url.startsWith('/api/') ? url.slice(4) : url;
    const response = await client.get(apiPath, { responseType: 'blob', signal, silentError: true, preserveError: true, timeout: requestTimeout(apiPath) });
    return response.data;
  },
  getCharacters: (id, mastered = null, signal, options) => get('/characters', { child_id: id, is_mastered: mastered === null ? undefined : Number(Boolean(mastered)) }, signal, options),
  createCharacter: (data, options) => post('/characters', data, options),
  markCharacterMastered: (id, mastered = null, options) => put(`/characters/${id}/master`, { is_mastered: mastered }, options),
  deleteCharacter: (id, options) => remove(`/characters/${id}`, options),
  setCharacterCategories: (id, categories, options) => put(`/characters/${id}/categories`, { categories }, options),
  async loadPhoto(url) {
    if (!url.startsWith('/uploads/')) return url;
    const response = await client.get(url.replace('/uploads/', '../uploads/'), { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
  getRewardItems: (signal, options) => get('/reward-items', undefined, signal, options),
  createRewardItem: data => post('/reward-items', data),
  updateRewardItem: (id, data) => put(`/reward-items/${id}`, data),
  deleteRewardItem: id => remove(`/reward-items/${id}`),
  getChildRedemptions: (id, params = {}, signal, options) => get(`/children/${id}/redemptions`, params, signal, options),
  requestRedemption: (id, rewardId, title, childName, attempt, options) => pendingWrite({ kind: 'redemption', child_id: id, child_name: childName, task_id: rewardId, title, payload: { reward_id: rewardId } }, attempt, options),
  retryPendingWrite: entry => sendPendingWrite(entry),
  getRedemptions: (status, params = {}) => get('/redemptions', { ...params, status }),
  approveRedemption: id => post(`/redemptions/${id}/approve`),
  rejectRedemption: id => post(`/redemptions/${id}/reject`),
  cancelRedemption: (id, options) => post(`/redemptions/${id}/cancel`, undefined, options),
  refundRedemption: (id, data, generation) => post(`/redemptions/${id}/refund`, data, formOptions(generation)),
  getAdhocTasks: (id, signal, options) => get(`/children/${id}/adhoc-tasks`, undefined, signal, options),
  getAdhocTask: id => get(`/adhoc-tasks/${id}`),
  updateAdhocTask: (id, data, generation) => put(`/adhoc-tasks/${id}`, data, formOptions(generation)),
  createAdhocTask: (childId, data) => post(`/children/${childId}/adhoc-tasks`, data, formOptions(getDataGeneration())),
  deleteAdhocTask: (id, options) => remove(`/adhoc-tasks/${id}`, options),
  getHomeworkStudy: id => get(`/homework/${id}/study`),
  correctHomeworkLegacy: (id, data) => put(`/homework/${id}/study/legacy`, data),
  startHomeworkStudy: id => post(`/homework/${id}/study/start`),
  pauseHomeworkStudy: (id, sid) => post(`/homework/${id}/sessions/${sid}/pause`),
  finishHomeworkStudy: (id, sid, data) => post(`/homework/${id}/sessions/${sid}/finish`, data),
  addHomeworkStudy: (id, data) => idempotentPost(`/homework/${id}/sessions`, data),
  editHomeworkStudy: (id, sid, data) => put(`/homework/${id}/sessions/${sid}`, data),
  completeHomework: (id, data = {}, options) => idempotentPost(`/homework/${id}/complete`, data, options),
  rejectHomeworkCompletion: (id, options) => post(`/homework/${id}/reject-completion`, undefined, options),
  getHomeworkCompletionRequests: (signal, options) => get('/homework-completion-requests', undefined, signal, options),
  getHomework: (childId, params = {}, signal, options) => get(`/children/${childId}/homework`, params, signal, options),
  getRecurringHomework: childId => get(`/children/${childId}/recurring-homework`),
  createRecurringHomework: (childId, data, generation) => post(`/children/${childId}/recurring-homework`, data, formOptions(generation)),
  updateRecurringHomework: (id, data, generation) => put(`/recurring-homework/${id}`, data, formOptions(generation)),
  deleteRecurringHomework: (id, version, generation) => request('delete', `/recurring-homework/${id}`, { expected_version: version }, undefined, undefined, formOptions(generation)),
  skipRecurringHomework: (id, data, generation) => post(`/recurring-homework/${id}/skip`, data, formOptions(generation)),
  getHomeworkRecord: (id, signal) => get(`/homework/${id}`, undefined, signal, { silentError: true }),
  getHomeworkCourses: (childId, signal, options) => get(`/children/${childId}/homework/courses`, undefined, signal, options),
  getHomeworkSummary: (childId, params = {}, signal, options) => get(`/children/${childId}/homework/summary`, params, signal, options),
  suggestHomework: (childId, params) => get(`/children/${childId}/homework/suggest`, params),
  createHomework: (childId, data) => post(`/children/${childId}/homework`, data, formOptions(getDataGeneration())),
  updateHomework: (id, data, generation) => put(`/homework/${id}`, data, formOptions(generation ?? getDataGeneration())),
  deleteHomework: (id, deleteTask = false, options) => remove(`/homework/${id}${deleteTask ? '?delete_task=1' : ''}`, options),
  createHomeworkTask: (id, data = {}, options) => post(`/homework/${id}/task`, data, options),
  rejectHomeworkTask: (id, options) => post(`/homework/${id}/reject-task`, undefined, options),
  getHomeworkRequests: (signal, options) => get('/homework-requests', undefined, signal, options),
  setHomeworkCoursePoints: (courseKey, points, options) => put('/homework-course-points', { course_key: courseKey, points }, options),
  getChildPeriods: id => get(`/children/${id}/periods`),
  getChildGoals: (id, signal, options) => get(`/children/${id}/goals`, undefined, signal, options),
  createGoal: (childId, data) => post(`/children/${childId}/goals`, data),
  createPeriod: (childId, data) => post(`/children/${childId}/periods`, data),
  updatePeriod: (id, data) => put(`/periods/${id}`, data),
  deletePeriod: id => remove(`/periods/${id}`),
  createPeriodTask: (periodId, data) => post(`/periods/${periodId}/tasks`, data),
  updatePeriodTask: (id, data) => put(`/period-tasks/${id}`, data),
  deletePeriodTask: id => remove(`/period-tasks/${id}`),
  logPeriodProgress: (taskId, data, { childId, childName, title, backfill = false, attempt }) => pendingWrite({ kind: backfill ? 'backfill' : 'progress', child_id: childId, child_name: childName, task_id: taskId, title, payload: data }, attempt),
  deletePeriodLog: id => remove(`/period-task-logs/${id}`),
  getChildSchedule: (id, from, to = from, signal, options) => get(`/children/${id}/schedule`, { from, to }, signal, options),
  getTimeStats: (id, from, to, signal, options) => get(`/children/${id}/time-stats`, { from, to }, signal, options),
  getTimetables: (childId, signal, options) => get(`/children/${childId}/timetables`, undefined, signal, options),
  createTimetable: (childId, data) => post(`/children/${childId}/timetables`, data),
  updateTimetable: (id, data) => put(`/timetables/${id}`, data),
  deleteTimetable: id => remove(`/timetables/${id}`),
  getOutsideClasses: () => get('/outside-classes'),
  getOutsideClassStats: (childId, signal, options) => get('/outside-classes/stats', { child_id: childId }, signal, options),
  getOutsideClassDetails: (id, childId, from, to) => get(`/outside-classes/${id}/stats`, { child_id: childId, from, to }),
  async setClassAttendance(id, data, options = {}) {
    requireFamilyDate();
    await ensureDataGeneration();
    return put(`/outside-classes/${id}/attendance`, data, { ...options, headers: { ...generationHeaders(getDataGeneration()), ...options.headers } });
  },
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
