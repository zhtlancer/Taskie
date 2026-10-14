import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
const { mockStore } = await import('../src/api/mockStore.js');
const date = offset => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  storage.clear();
  mockStore.state = {
    children: [{ id: 'a' }, { id: 'b' }],
    task_templates: [
      { id: 'shared', title: '共同任务', subject: '数学', points: 10, days_of_week: [0, 1, 2, 3, 4, 5, 6], child_ids: null },
      { id: 'scoped', title: '专属任务', subject: '语文', points: 10, days_of_week: [0, 1, 2, 3, 4, 5, 6], child_ids: ['a'] }
    ],
    daily_tasks: [], point_logs: [], child_badges: [], badge_definitions: []
  };
});

test('demo assignment changes revoke today tasks and fill missing tasks even when other tasks already exist', () => {
  const oldA = mockStore.getDailyTasks('a').find(t => t.template_id === 'scoped');
  assert.equal(mockStore.getDailyTasks('b').length, 1);
  mockStore.updateTemplate('scoped', { child_ids: ['b'] });
  assert.deepEqual(mockStore.getDailyTasks('a').map(t => t.template_id), ['shared']);
  assert.throws(() => mockStore.completeTask(oldA.id), /Task not found/);
  assert.equal(mockStore.state.point_logs.length, 0);
  assert.deepEqual(mockStore.getDailyTasks('b').map(t => t.template_id), ['shared', 'scoped']);
  assert.equal(mockStore.getDailyTasks('b').length, 2);
  mockStore.updateTemplate('scoped', { child_ids: null });
  assert.equal(mockStore.getDailyTasks('a').length, 2);
});

test('demo reassignment preserves completed tasks and history, and undo removes the revoked today task', () => {
  const past = mockStore.getDailyTasks('a', date(-1)).find(t => t.template_id === 'scoped');
  const current = mockStore.getDailyTasks('a').find(t => t.template_id === 'scoped');
  mockStore.completeTask(current.id);
  mockStore.updateTemplate('scoped', { child_ids: ['b'] });
  assert.equal(mockStore.getDailyTasks('a').find(t => t.id === current.id).is_completed, true);
  assert.ok(mockStore.getDailyTasks('a', date(-1)).some(t => t.id === past.id));
  assert.equal(mockStore.state.point_logs.reduce((sum, log) => sum + log.points, 0), 10);
  mockStore.uncompleteTask(current.id);
  assert.equal(mockStore.getDailyTasks('a').some(t => t.template_id === 'scoped'), false);
  assert.throws(() => mockStore.completeTask(current.id), /Task not found/);
  assert.equal(mockStore.state.point_logs.length, 0);
});

test('demo pre-generated tasks cannot earn points after assignment is revoked when their date becomes today', () => {
  const future = mockStore.getDailyTasks('a', date(1)).find(t => t.template_id === 'scoped');
  mockStore.updateTemplate('scoped', { child_ids: ['b'] });
  mockStore.state.daily_tasks.find(t => t.id === future.id).date = date(0);
  assert.throws(() => mockStore.completeTask(future.id), /任务已取消分配/);
  assert.equal(mockStore.state.point_logs.length, 0);
  assert.equal(mockStore.getDailyTasks('a').some(t => t.id === future.id), false);
});
