import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { familyDateConfirmed, FAMILY_DATE_REQUIRED } from '../src/utils/calendarWriteGuard.js';
import * as session from '../src/utils/session.js';
import { pendingWriteStore as pending } from '../src/utils/requestId.js';

const memoryStorage = () => {
  const values = new Map();
  return { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
};
const token = (role = 'parent') => `header.${Buffer.from(JSON.stringify({ role, child_id: 'a', exp: Date.now() / 1000 + 3600 })).toString('base64url')}.signature`;
const action = data_generation => ({ kind: 'backfill', role: 'parent', child_id: 'a', task_id: 'goal', payload: { amount: 1 }, ...(data_generation ? { data_generation } : {}) });
let serial = 0;
async function fixture(t, respond = () => ({})) {
  familyDateConfirmed.value = true;
  t.after(() => { familyDateConfirmed.value = false; });
  for (const name of ['sessionStorage', 'localStorage', 'window']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value: name === 'window' ? new EventTarget() : memoryStorage(), configurable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const sent = [], adapter = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    sent.push(config);
    const result = await respond(config);
    const response = { data: result.data ?? result, status: result.status || 200, headers: {}, config };
    if (response.status >= 400) throw { response, config };
    return response;
  };
  t.after(() => { axios.defaults.adapter = adapter; });
  const url = new URL('../src/api/client.js', import.meta.url);
  const source = (await readFile(url, 'utf8'))
    .replace('import.meta.env.VITE_API_BASE_URL', 'undefined')
    .replace("from 'axios'", `from '${new URL('../node_modules/axios/index.js', import.meta.url)}'`)
    .replace(/from '(\.\.[^']+)'/g, (_, path) => `from '${new URL(path, url)}'`);
  const { api } = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${serial++}`).toString('base64')}`);
  return { api, sent };
}

test('login stores the generation with either role token, clearTokens removes both', async t => {
  const { api } = await fixture(t, config => ({ success: true, token: token(config.url.includes('child') ? 'child' : 'parent'), data_generation: 'restore-1' }));
  for (const role of ['parent', 'child']) {
    await api[role === 'parent' ? 'loginParent' : 'loginChild']({ pin: '1234', child_id: 'a' });
    assert.equal(sessionStorage.getItem('taskie_data_generation'), 'restore-1');
    assert.equal(session.getDataGeneration(), 'restore-1');
    assert.ok(session.getToken(role));
  }
  session.clearTokens();
  assert.equal(session.getDataGeneration(), null);
});

test('a refreshed token without generation calibrates once before creating a write', async t => {
  const { api, sent } = await fixture(t, config => config.url === '/auth/data-generation' ? { data_generation: 'restored' } : {});
  session.saveToken('parent', token());
  await Promise.all([api.getChildren(), api.getChildStats('a')]);
  assert.equal(sessionStorage.getItem('taskie_data_generation'), 'restored');
  assert.equal(sent.filter(c => c.url === '/auth/data-generation').length, 1);
  await api.logPeriodProgress('goal', { amount: 1 }, { childId: 'a' });
  assert.equal(sent.at(-1).headers.get('X-Taskie-Data-Generation'), 'restored');
});

test('pending creation persists generation and retry sends its recorded generation', async t => {
  let lose = true;
  const { api, sent } = await fixture(t, config => {
    if (config.url === '/auth/data-generation') return { data_generation: 'current' };
    if (lose) throw { config };
    return {};
  });
  session.saveToken('parent', token(), 'created');
  await assert.rejects(api.logPeriodProgress('goal', { amount: 1 }, { childId: 'a' }));
  const [first] = pending.list();
  assert.equal(first.data_generation, 'created');
  sessionStorage.setItem('taskie_data_generation', 'current');
  lose = false;
  await api.retryPendingWrite(first);
  assert.equal(sent.at(-1).headers.get('X-Taskie-Data-Generation'), 'created');
  assert.equal(JSON.parse(sent.at(-1).data).request_id, first.request_id);
});

test('login removes old generations and other identities, keeping legacy and current requests', async t => {
  await fixture(t);
  const entries = ['old', 'new', undefined].map((generation, i) => pending.prepare({ ...action(generation), task_id: `goal-${i}` }));
  pending.prepare({ ...action('new'), role: 'child', task_id: 'child-goal' });
  session.saveToken('parent', token(), 'new');
  assert.deepEqual(pending.list(), entries.slice(1));
});

test('legacy pending items retry without a generation header', async t => {
  const { api, sent } = await fixture(t);
  session.saveToken('parent', token(), 'new');
  await api.retryPendingWrite(pending.prepare(action()));
  assert.equal(sent.at(-1).headers.get('X-Taskie-Data-Generation'), undefined);
});

test('409 DATA_RESTORED discards the pending attempt and invalidates the original form', async t => {
  const { api, sent } = await fixture(t, () => ({ status: 409, data: { code: 'DATA_RESTORED', error: '数据已恢复，这次操作没有执行，请核对后重新操作' } }));
  session.saveToken('parent', token(), 'old');
  let closed = false;
  window.addEventListener('taskie:data-restored', () => { closed = true; });
  const attempt = {};
  const write = () => api.logPeriodProgress('goal', { amount: 1 }, { childId: 'a', attempt });
  await assert.rejects(write(), error => String(error).includes('数据已恢复'));
  assert.deepEqual(pending.list(), []);
  assert.equal(closed, true);
  const count = sent.length;
  await assert.rejects(write());
  assert.equal(sent.length, count, 'closed attempt must never be posted again');
});

for (const method of ['addTaskStudy', 'addHomeworkStudy', 'gradeWordStudyItem']) test(`${method} binds generation to its original request object across retries`, async t => {
  let lose = true;
  const { api, sent } = await fixture(t, config => { if (lose) throw { config }; return {}; });
  session.saveToken('parent', token(), 'created');
  const body = { request_id: 'manual-original', duration_seconds: 60 };
  await assert.rejects(api[method]('target', body));
  sessionStorage.setItem('taskie_data_generation', 'later');
  lose = false;
  await api[method]('target', body);
  assert.equal(sent.at(-1).headers.get('X-Taskie-Data-Generation'), 'created');
});

test('a late calibration never overwrites a different login', async t => {
  let release, arrive;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { api } = await fixture(t, async config => {
    if (config.url === '/auth/data-generation') { arrive(); await gate; return { data_generation: 'old' }; }
    return {};
  });
  session.saveToken('parent', token());
  const read = assert.rejects(api.getChildren());
  await arrived;
  session.saveToken('child', token('child'), 'new');
  release(); await read;
  assert.equal(session.getDataGeneration(), 'new');
});

test('generation storage failure stops a fresh pending write before HTTP', async t => {
  const { api, sent } = await fixture(t, () => ({ data_generation: 'initial' }));
  session.saveToken('parent', token());
  const setItem = sessionStorage.setItem;
  sessionStorage.setItem = (key, value) => { if (key === 'taskie_data_generation') throw new Error('quota'); setItem(key, value); };
  await assert.rejects(api.logPeriodProgress('goal', { amount: 1 }, { childId: 'a' }));
  assert.deepEqual(sent.map(config => config.url), ['/auth/data-generation']);
  assert.deepEqual(pending.list(), []);
});

test('PIN replacement can proceed when an upgraded session lacks generation', async t => {
  const { api, sent } = await fixture(t);
  session.saveToken('parent', token());
  await api.changeParentPin('1234', '5678');
  assert.deepEqual(sent.map(config => config.url), ['/auth/parent-pin']);
});

test('manual/practice rejected attempt cannot post its original request again', async t => {
  const { api, sent } = await fixture(t, () => ({ status: 409, data: { code: 'DATA_RESTORED', error: '数据已恢复，这次操作没有执行，请核对后重新操作' } }));
  session.saveToken('parent', token(), 'old');
  const body = { request_id: 'manual-original' };
  await assert.rejects(api.addTaskStudy('target', body));
  const count = sent.length;
  await assert.rejects(api.addTaskStudy('target', body));
  assert.equal(sent.length, count);
});


test('unknown family date blocks all mutation transports, manual retries and pending creation before sending', async t => {
  const { api, sent } = await fixture(t, config => config.url === '/auth/data-generation' ? { data_generation: 'current' } : {});
  session.saveToken('parent', token());
  const entry = pending.prepare(action());
  familyDateConfirmed.value = false;
  for (const write of [
    () => api.createAdhocTask('a', { date: '2026-10-22' }),
    () => api.materializeBackfillDay('a', '2026-10-21'),
    () => api.setClassException('class', { date: '2026-10-22', type: 'leave' }),
    () => api.setClassAttendance('class', { date: '2026-10-22' }),
    () => api.addTaskStudy('task', { date: '2026-10-22' }),
    () => api.logPeriodProgress('goal', { date: '2026-10-22' }, { childId: 'a' }),
    () => api.retryPendingWrite(entry)
  ]) await assert.rejects(write(), error => error === FAMILY_DATE_REQUIRED);
  assert.equal(sent.length, 0, 'no HTTP requests, even calibration, before blocking');
  assert.deepEqual(pending.list(), [entry], 'blocked progress creates no uncertain-write entry');
  familyDateConfirmed.value = true;
  await api.createAdhocTask('a', { date: '2026-10-21' });
  assert.equal(JSON.parse(sent.at(-1).data).date, '2026-10-21');
});
