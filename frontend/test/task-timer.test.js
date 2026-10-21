import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatClock, formatDuration, liveSeconds, needsDurationPrompt, paceLabel, timerTarget, withClock } from '../src/utils/taskTimer.js';

test('a running timer keeps counting from when it was loaded; a paused one stays put', () => {
  const loaded = withClock({ timer_running: true, timer_seconds: 100 }, 1_000_000);
  assert.equal(liveSeconds(loaded, 1_000_000 + 65_400), 165);
  assert.equal(liveSeconds({ ...loaded, timer_running: false }, 1_000_000 + 65_400), 100);
  assert.equal(liveSeconds({ timer_running: false }), 0);
});

test('clocks and durations read naturally', () => {
  assert.deepEqual([formatClock(0), formatClock(754), formatClock(3723)], ['00:00', '12:34', '1:02:03']);
  assert.deepEqual([formatDuration(20), formatDuration(1380), formatDuration(3600), formatDuration(3900)],
    ['不到 1 分钟', '23 分钟', '1 小时', '1 小时 5 分钟']);
});

test('expected minutes show the time left or how far over', () => {
  assert.equal(paceLabel(600, null), null);
  assert.deepEqual(paceLabel(600, 20), { over: false, text: '还剩 10 分钟' });
  assert.deepEqual(paceLabel(1199, 20), { over: false, text: '还剩 1 分钟' });
  assert.deepEqual(paceLabel(1381, 20), { over: true, text: '超时 4 分钟' });
});

test('finishing asks for the time when the timer barely ran or ran too long', () => {
  assert.equal(needsDurationPrompt({ timer_seconds: 0 }), true);
  assert.equal(needsDurationPrompt({ timer_seconds: 45 }), true);
  assert.equal(needsDurationPrompt({ timer_seconds: 1500 }), false);
  assert.equal(needsDurationPrompt({ timer_seconds: 4 * 3600 }), true);
});

test('the running-timer bar reopens a study session and brings other timers into view', () => {
  assert.deepEqual(timerTarget({ kind: 'session', id: 't1', record_id: null }), { study: 't1' });
  assert.deepEqual(timerTarget({ kind: 'session', id: 't1', record_id: 'r1' }), { homework: 'r1' });
  assert.deepEqual(timerTarget({ kind: 'task', id: 't2' }), { focus: 't2' });
  assert.deepEqual(timerTarget({ kind: 'goal', id: 'g1' }), { focus: 'g1' });
});
