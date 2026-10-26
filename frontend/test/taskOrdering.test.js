import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTasks, sortGoals } from '../src/utils/taskOrdering.js';

test('required, optional, and settled groups precede deadline then priority ordering', () => {
  const tasks = [
    { id: 'completed', is_completed: true, date: '2026-10-20', priority: 2 },
    { id: 'optional-high', is_optional: true, due_date: '2026-10-30', priority: 2 },
    { id: 'normal', date: '2026-10-26' },
    { id: 'high', date: '2026-10-26', priority: 2 },
    { id: 'low', date: '2026-10-26', priority: 0 },
    { id: 'optional-sooner', is_optional: true, due_date: '2026-10-28', priority: 0 },
    { id: 'skipped', is_skipped: true, date: '2026-10-20', priority: 1 }
  ];
  const before = structuredClone(tasks);
  assert.deepEqual(sortTasks(tasks).map(t => t.id), ['high', 'normal', 'low', 'optional-sooner', 'optional-high', 'completed', 'skipped']);
  assert.deepEqual(tasks, before, 'sorting does not mutate reactive API results');
});

test('normalized weekly deadlines override the row date and stable ties retain API order', () => {
  const tasks = [
    { id: 'weekly', is_optional: true, date: '2026-10-26', sort_due_date: '2026-10-30' },
    { id: 'homework', is_optional: true, date: '2026-10-26', due_date: '2026-10-28' },
    { id: 'tie', is_optional: true, date: '2026-10-27', sort_due_date: '2026-10-28' }
  ];
  assert.deepEqual(sortTasks(tasks).map(t => t.id), ['homework', 'tie', 'weekly']);
});

test('goals without a deadline follow dated goals; logged and skipped daily obligations move to the end', () => {
  const goals = [
    { id: 'open', priority: 2, daily_required: true },
    { id: 'dated', priority: 0, daily_required: true, end_date: '2026-10-30' },
    { id: 'skipped', daily_required: true, end_date: '2026-10-26' },
    { id: 'logged', daily_required: true, today_logged: true },
    { id: 'optional', priority: 2, daily_required: false, end_date: '2026-10-26' }
  ];
  const rows = { skipped: { is_skipped: true }, open: { date: '2026-10-26', due_date: '2026-10-26', priority: 1 } };
  assert.deepEqual(sortGoals(goals, rows).map(t => t.id), ['dated', 'open', 'optional', 'skipped', 'logged']);
});
