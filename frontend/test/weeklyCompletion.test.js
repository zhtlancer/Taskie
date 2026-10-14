import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
const { mockStore } = await import('../src/api/mockStore.js');

const row = (id, template_id, date, is_completed, extra = {}) => ({ id, child_id: 'a', template_id, title: template_id === 'math' ? '口算' : '阅读', date, is_completed, ...extra });
const weekly = { schedule_type: 'weekly_times', weekly_target_times: 3 };

beforeEach(() => {
  storage.clear();
  mockStore.state = {
    children: [{ id: 'a', created_at: '2026-01-01T00:00:00.000Z' }],
    task_templates: [
      { id: 'math', title: '口算', subject: '数学', days_of_week: [1, 2, 3, 4, 5], child_ids: null, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'read', title: '阅读', subject: '语文', ...weekly, child_ids: null, created_at: '2026-01-01T00:00:00.000Z' }
    ],
    // Week of Monday 2026-10-12; Wednesday was never opened.
    daily_tasks: [
      row('m1', 'math', '2026-10-12', true),
      row('m2', 'math', '2026-10-13', false),
      row('m4', 'math', '2026-10-15', true), row('r4', 'read', '2026-10-15', true, weekly),
      row('m5', 'math', '2026-10-16', true), row('r5', 'read', '2026-10-16', true, weekly),
      row('r6', 'read', '2026-10-17', true, weekly), row('r7', 'read', '2026-10-18', true, weekly)
    ],
    point_logs: [], child_badges: [], badge_definitions: []
  };
});

test('demo weekly completion counts unopened days as missed and caps weekly targets', () => {
  const result = mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-18');
  assert.deepEqual(Object.fromEntries(result.items.map(i => [i.title, [i.completed, i.total]])), { 口算: [3, 5], 阅读: [3, 3] });
  assert.deepEqual([result.completed_units, result.total_units, result.completion_rate], [6, 8, 0.75]);
});

test('demo weekly completion projects nothing before the child existed but keeps real tasks', () => {
  mockStore.state.children[0].created_at = '2026-10-20T00:00:00.000Z';
  assert.deepEqual(mockStore.getWeeklyCompletion('a', '2026-10-05', '2026-10-18'), { as_of: '2026-10-11', total_units: 0, completed_units: 0, completion_rate: null, items: [] });
  // The week of 2026-10-12 has generated tasks, which still count; the unopened Wednesday does not.
  const result = mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-18');
  assert.deepEqual(Object.fromEntries(result.items.map(i => [i.title, [i.completed, i.total]])), { 口算: [3, 4], 阅读: [3, 3] });
});

test('demo weekly completion as of a weekday owes only what was due by then', () => {
  const asOf = date => Object.fromEntries(mockStore.getWeeklyCompletion('a', '2026-10-12', date).items.map(i => [i.title, [i.completed, i.total]]));
  // Wednesday: Monday done, Tuesday missed, unopened Wednesday missed; reading not due yet.
  assert.deepEqual(asOf('2026-10-14'), { 口算: [1, 3] });
  // Friday: reading done Thursday and Friday covers the 1 time owed with 2 days left.
  assert.deepEqual(asOf('2026-10-16'), { 口算: [3, 5], 阅读: [2, 2] });
  assert.equal(mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-16').as_of, '2026-10-16');
});

test('demo changing schedules keeps fixed and weekly completions in separate items', () => {
  mockStore.state.task_templates = [];
  mockStore.state.daily_tasks = [
    row('fixed', 'math', '2026-10-12', true, { schedule_type: 'fixed_days' }),
    row('weekly', 'math', '2026-10-14', true, weekly),
    row('weekly-first', 'read', '2026-10-12', true, weekly),
    row('fixed-later', 'read', '2026-10-14', true, { schedule_type: 'fixed_days' })
  ];
  const result = mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-18');
  assert.equal(result.completed_units, 4);
  assert.equal(result.items.length, 4);
  assert.equal(new Set(result.items.map(i => i.key)).size, 4);
  assert.equal(mockStore.getWeeklyCompletedCount('a', 'math', '2026-10-14'), 1);
});

test('demo deleting same-title templates preserves separate original identities and historical completion', () => {
  mockStore.state.task_templates = [
    { id: 'one', title: '阅读', subject: '语文', ...weekly, weekly_target_times: 1, created_at: '2026-01-01T00:00:00Z' },
    { id: 'two', title: '阅读', subject: '英语', ...weekly, weekly_target_times: 1, created_at: '2026-01-01T00:00:00Z' }
  ];
  mockStore.state.daily_tasks = [row('one-day', 'one', '2026-10-12', true, { ...weekly, weekly_target_times: 1 }), row('two-day', 'two', '2026-10-12', true, { ...weekly, weekly_target_times: 1 })];
  const before = mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-18');
  mockStore.deleteTemplate('one'); mockStore.deleteTemplate('two');
  assert.deepEqual(mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-18'), before);
  assert.ok(mockStore.state.daily_tasks.every(t => t.template_id === null && t.source_template_id));
  for (const task of mockStore.state.daily_tasks) delete task.source_template_id;
  const legacy = mockStore.getWeeklyCompletion('a', '2026-10-12', '2026-10-18');
  assert.equal(legacy.completed_units, 2);
  assert.equal(legacy.items.length, 2);
});

test('demo first-week quota starts after child and template creation, while real backfilled tasks still count', () => {
  mockStore.state.task_templates = [{ id: 'read', title: '首周任务', ...weekly, weekly_target_times: 7, created_at: '2026-10-14T04:00:00Z' }];
  mockStore.state.daily_tasks = [];
  const asOf = date => mockStore.getWeeklyCompletion('a', '2026-10-12', date);
  assert.equal(asOf('2026-10-13').total_units, 0);
  assert.equal(asOf('2026-10-14').total_units, 1);
  assert.equal(asOf('2026-10-18').total_units, 5);
  mockStore.state.children[0].created_at = '2026-10-16T04:00:00Z';
  assert.equal(asOf('2026-10-16').total_units, 1);
  assert.equal(asOf('2026-10-18').total_units, 3);
  mockStore.state.daily_tasks = [row('backfilled', 'read', '2026-10-12', true, { ...weekly, weekly_target_times: 7 })];
  assert.equal(asOf('2026-10-12').completed_units, 1);
  assert.equal(asOf('2026-10-12').total_units, 1);
});
