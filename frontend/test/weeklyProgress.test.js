import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
const { mockStore } = await import('../src/api/mockStore.js');

beforeEach(() => {
  storage.clear();
  mockStore.state = {
    children: [{ id: 'a' }],
    task_templates: [{ id: 'read', title: '阅读', subject: '语文', points: 10, schedule_type: 'weekly_times', weekly_target_times: 3, days_of_week: [0, 1, 2, 3, 4, 5, 6], child_ids: null }],
    daily_tasks: [], point_logs: [], child_badges: [], badge_definitions: []
  };
});

// 2026-10-12 is a Monday.
const reading = date => mockStore.getDailyTasks('a', date).find(task => task.template_id === 'read');

test('demo weekly tasks are optional while there is slack and required once there is none', () => {
  assert.deepEqual(pick(reading('2026-10-12')), { is_optional: true, week_days_left: 7, weekly_remaining_times: 3 });
  assert.equal(reading('2026-10-15').is_optional, true);
  assert.deepEqual(pick(reading('2026-10-16')), { is_optional: false, week_days_left: 3, weekly_remaining_times: 3 });
});

test('demo completions on earlier days restore slack for later days', () => {
  mockStore.state.daily_tasks.push(
    { id: 'mon', child_id: 'a', template_id: 'read', date: '2026-10-12', schedule_type: 'weekly_times', weekly_target_times: 3, is_completed: true },
    { id: 'tue', child_id: 'a', template_id: 'read', date: '2026-10-13', schedule_type: 'weekly_times', weekly_target_times: 3, is_completed: true }
  );
  // One time left over Friday to Sunday.
  assert.deepEqual(pick(reading('2026-10-16')), { is_optional: true, week_days_left: 3, weekly_remaining_times: 1 });
});

function pick(task) {
  return { is_optional: task.is_optional, week_days_left: task.week_days_left, weekly_remaining_times: task.weekly_remaining_times };
}
