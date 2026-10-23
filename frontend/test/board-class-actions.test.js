import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardClassActions, boardClassStatus, pendingAttendanceRevision } from '../src/utils/boardClassActions.js';

const today = '2026-10-23', tomorrow = '2026-10-24';
const scheduled = { status: 'scheduled', attendance: null };
const actions = (lesson, date = today, parent = true) => boardClassActions(lesson, date, today, parent);

test('pending revisions survive clearing without adopting unseen confirmed attendance', () => {
  const lesson = { source_date: tomorrow, attendance: null };
  assert.equal(pendingAttendanceRevision(lesson, { lessons: [{ lesson_date: tomorrow, confirmed: false, revision: 'cleared-version' }] }), 'cleared-version');
  assert.equal(pendingAttendanceRevision(lesson, { lessons: [{ lesson_date: tomorrow, confirmed: true, revision: 'unseen-version' }] }), null);
  assert.equal(pendingAttendanceRevision(lesson, { lessons: [{ lesson_date: today, confirmed: false, revision: 'another-lesson' }] }), null);
});

test('only parents get actions; today permits attendance, tomorrow only scheduling', () => {
  assert.deepEqual(actions(scheduled), ['leave', 'move', 'attended', 'absent']);
  assert.deepEqual(actions(scheduled, tomorrow), ['leave', 'move']);
  for (const status of ['scheduled', 'leave', 'moved_in', 'moved_out']) {
    for (const attendance of [null, { status: 'attended' }, { status: 'absent' }]) {
      assert.deepEqual(actions({ status, attendance }, today, false), []);
    }
  }
});

test('leave and moved-away lessons only offer their matching undo', () => {
  assert.deepEqual(actions({ status: 'leave', exception_id: 'leave-id' }), ['undoLeave']);
  assert.deepEqual(actions({ status: 'moved_out', exception_id: 'move-id' }), ['undoMove']);
  assert.deepEqual(actions({ status: 'leave' }), []);
});

test('confirmed attendance takes precedence over exceptions and can always be undone', () => {
  for (const status of ['attended', 'absent', 'leave']) {
    assert.deepEqual(actions({ status: 'leave', exception_id: 'e', attendance: { status } }), ['undoAttendance']);
    assert.deepEqual(actions({ ...scheduled, attendance: { status } }, tomorrow), ['undoAttendance']);
  }
  assert.deepEqual(actions({ ...scheduled, attendance: { status: 'pending', revision: 'tombstone' } }), ['leave', 'move', 'attended', 'absent']);
});

test('moved-in attendance follows actual day, including a future source moved into today', () => {
  const incoming = { status: 'moved_in', source_date: tomorrow, moved_from: tomorrow, exception_id: 'e' };
  assert.deepEqual(actions(incoming), ['leave', 'move', 'attended', 'absent', 'undoMove']);
  assert.deepEqual(actions({ ...incoming, source_date: today, moved_from: today }, tomorrow), ['leave', 'move', 'undoMove']);
});

test('read-only labels show scheduling and attendance independently', () => {
  assert.deepEqual(boardClassStatus(scheduled), ['未确认']);
  assert.deepEqual(boardClassStatus({ status: 'leave' }), ['已请假']);
  assert.deepEqual(boardClassStatus({ status: 'moved_out', moved_to: { date: tomorrow } }), ['已调到 10/24 日']);
  assert.deepEqual(boardClassStatus({ status: 'moved_in', moved_from: today, attendance: { status: 'attended' } }), ['从 10/23 日调来', '已上课']);
  assert.deepEqual(boardClassStatus({ ...scheduled, attendance: { status: 'absent' } }), ['缺席']);
  assert.deepEqual(boardClassStatus({ ...scheduled, attendance: { status: 'leave' } }), ['已请假']);
});
