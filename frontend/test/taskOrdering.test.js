import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortTasks, sortGoals, goalBoardTask, matchesTaskFilters, taskAttention } from '../src/utils/taskOrdering.js';

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

test('subject, unfinished and high-priority filters combine without changing completion or task order', () => {
  const tasks = [
    { id: 'pending', subject: '数学', priority: 2 },
    { id: 'normal', subject: '数学', priority: 1 },
    { id: 'other', subject: '语文', priority: 2 },
    { id: 'done', subject: '数学', priority: 2, is_completed: true },
    { id: 'skipped', subject: '数学', priority: 2, is_skipped: true },
    { id: 'extra', subject: '数学', priority: 2, is_extra: true }
  ];
  const before = structuredClone(tasks);
  assert.deepEqual(tasks.filter(t => matchesTaskFilters(t, { subject: '数学', unfinishedOnly: true, highPriorityOnly: true })).map(t => t.id), ['pending', 'extra']);
  assert.deepEqual(tasks.filter(t => matchesTaskFilters(t, { highPriorityOnly: true })).map(t => t.id), ['pending', 'other', 'done', 'skipped', 'extra']);
  assert.deepEqual(tasks.filter(t => matchesTaskFilters(t)).map(t => t.id), before.map(t => t.id));
  assert.deepEqual(tasks, before);
});

test('goal filters use today’s progress, skip state, subject and daily snapshot priority', () => {
  const goal = { id: 'goal', subject: '英语', priority: 2, daily_required: true, end_date: '2026-11-01' };
  assert.equal(matchesTaskFilters(goalBoardTask(goal, { priority: 0 }), { highPriorityOnly: true }), false);
  assert.equal(matchesTaskFilters(goalBoardTask(goal), { subject: '数学' }), false);
  assert.equal(matchesTaskFilters(goalBoardTask({ ...goal, today_logged: true }), { unfinishedOnly: true }), false);
  assert.equal(matchesTaskFilters(goalBoardTask(goal, { is_skipped: true }), { unfinishedOnly: true }), false);
  assert.equal(matchesTaskFilters(goalBoardTask(goal), { unfinishedOnly: true, highPriorityOnly: true, subject: '英语' }), true);
});

test('attention counts normalized deadlines and pending goals once, excluding settled and extra tasks', () => {
  const today = '2026-10-26';
  const tasks = [
    { date: today, priority: 0 },
    { date: today, due_date: '2026-10-27', priority: 2 },
    { date: '2026-10-23', sort_due_date: today, priority: 2 },
    { date: today, schedule_type: 'weekly_times', sort_due_date: '2026-10-30', priority: 2 },
    { date: today, priority: 2, is_completed: true },
    { date: today, priority: 2, is_skipped: true },
    { date: today, priority: 2, is_extra: true },
    { origin: 'goal', goal_id: 'snapshot-low', date: today, priority: 0 },
    { origin: 'goal', goal_id: 'skipped-goal', date: today, priority: 2, is_skipped: true }
  ];
  const goals = [
    { id: 'snapshot-low', status: 'active', priority: 2, end_date: '2026-10-30', daily_required: true },
    { id: 'dated', status: 'active', priority: 2, end_date: today },
    { id: 'no-date', status: 'active', priority: 2 },
    { id: 'logged', status: 'active', priority: 2, end_date: today, today_logged: true },
    { id: 'skipped-goal', status: 'active', priority: 2, end_date: today },
    { id: 'upcoming', status: 'upcoming', priority: 2, end_date: today },
    { id: 'ended', status: 'ended', priority: 2, end_date: today },
    { id: 'complete', status: 'completed', priority: 2, end_date: today, is_completed: true }
  ];
  const before = structuredClone([tasks, goals]);
  assert.deepEqual(taskAttention(tasks, goals, today), { due_today: 3, high_priority_pending: 5 });
  assert.deepEqual(taskAttention([], [], today), { due_today: 0, high_priority_pending: 0 });
  assert.deepEqual([tasks, goals], before);
});
