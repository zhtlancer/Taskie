import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, lessonHappens, lessonNote, mondayOf, presetSlots } from '../src/utils/schedule.js';

test('weeks start on Monday', () => {
  assert.equal(mondayOf('2026-10-16'), '2026-10-12');
  assert.equal(mondayOf('2026-10-18'), '2026-10-12');
  assert.equal(mondayOf('2026-10-12'), '2026-10-12');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('the preset school day has seven 40-minute lessons with 课间操 and 午休, never overlapping', () => {
  let n = 0;
  const slots = presetSlots(() => `id${n++}`);
  assert.deepEqual(slots.map(s => s.label), ['第1节', '第2节', '课间操', '第3节', '第4节', '午休', '第5节', '第6节', '第7节']);
  assert.deepEqual([slots[0].start_time, slots[0].end_time, slots[1].start_time], ['08:00', '08:40', '08:50']);
  assert.deepEqual([slots[5].start_time, slots[5].end_time, slots.at(-1).end_time], ['11:30', '13:30', '15:50']);
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i].start_time >= slots[i - 1].end_time);
});

test('lessons on leave or moved away say so', () => {
  assert.equal(lessonHappens({ status: 'leave' }), false);
  assert.equal(lessonHappens({ status: 'moved_in' }), true);
  assert.equal(lessonNote({ status: 'leave', exception_note: '发烧' }), '请假：发烧');
  assert.equal(lessonNote({ status: 'moved_out', moved_to: { date: '2026-10-17', start_time: '09:00', end_time: '10:00' } }), '调到 10/17 09:00–10:00');
  assert.equal(lessonNote({ status: 'moved_in', moved_from: '2026-10-14' }), '从 10/14 调来');
});

test('deadlines read as the day carried from and the last day to finish', async () => {
  const { deadlineText } = await import('../src/utils/schedule.js');
  const today = '2026-10-17'; // a Saturday
  assert.equal(deadlineText({ date: '2026-10-16', carried_from: '2026-10-16', due_date: '2026-10-18' }, today), '周五的作业 · 周日前完成');
  assert.equal(deadlineText({ date: '2026-10-16', carried_from: '2026-10-16', due_date: '2026-10-17' }, today), '周五的作业 · 今天要完成');
  assert.equal(deadlineText({ date: '2026-10-17', due_date: '2026-10-18' }, today), '周日前完成即可');
  assert.equal(deadlineText({ date: '2026-09-30', carried_from: '2026-09-30', due_date: '2026-10-07' }, '2026-10-01'), '周三的作业 · 周三前完成');
  assert.equal(deadlineText({ date: '2026-09-30', carried_from: '2026-09-30', due_date: '2026-10-08' }, '2026-10-01'), '周三的作业 · 周四 10/8前完成');
  assert.equal(deadlineText({ date: today, due_date: null }, today), '');
});
