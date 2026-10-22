import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REST_MINUTES, clearRest, readRest, restSecondsLeft, saveRest, restTarget, sameRestTarget } from '../src/utils/rest.js';

const memoryStorage = () => {
  const data = new Map();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), data };
};

test('a rest offers the fixed lengths and counts down to its end', () => {
  assert.deepEqual(REST_MINUTES, [5, 10, 15]);
  const storage = memoryStorage();
  const start = Date.parse('2026-10-22T12:00:00Z');
  const rest = saveRest('c1', 10, start, storage);
  assert.deepEqual(rest, { minutes: 10, ends_at: start + 600000 });
  assert.equal(restSecondsLeft(rest, start), 600);
  assert.equal(restSecondsLeft(rest, start + 599_001), 1, 'the last partial second still shows');
  assert.equal(restSecondsLeft(rest, start + 700_000), 0);
  assert.throws(() => saveRest('c1', 7, start, storage));
});

test('a rest retains the paused target across reload and distinguishes task kind, id and session', () => {
  const storage = memoryStorage(), now = Date.now();
  const timer = { kind: 'session', id: 'task-a', session_id: 'session-a', title: 'A' };
  saveRest('c', 5, now, storage, timer);
  timer.id = 'task-b';
  const target = readRest('c', now, storage).target;
  assert.deepEqual(target, { kind: 'session', id: 'task-a', session_id: 'session-a' });
  assert.ok(sameRestTarget(target, restTarget({ ...target, title: 'new title' })));
  for (const changed of [{ kind: 'goal' }, { id: 'task-b' }, { session_id: 'session-b' }]) assert.equal(sameRestTarget(target, { ...target, ...changed }), false);
  assert.equal(sameRestTarget(undefined, target), false, 'old rests with unknown targets require confirmation');
});

test('a rest survives a reload on this device, per child, until cleared or long over', () => {
  const storage = memoryStorage();
  const start = Date.parse('2026-10-22T12:00:00Z');
  saveRest('c1', 5, start, storage);
  assert.deepEqual(readRest('c1', start + 1000, storage), { minutes: 5, ends_at: start + 300000 });
  assert.equal(readRest('c2', start, storage), null, 'another child has no rest');
  assert.ok(readRest('c1', start + 300000 + 30 * 60000, storage), 'a recently ended rest is still announced');
  assert.equal(readRest('c1', start + 300000 + 61 * 60000, storage), null, 'a rest that ended over an hour ago is dropped');
  assert.equal(storage.data.size, 0);
  saveRest('c1', 15, start, storage);
  clearRest('c1', storage);
  assert.equal(readRest('c1', start, storage), null);
  storage.setItem('taskie_rest_c1', '{broken');
  assert.equal(readRest('c1', start, storage), null);
  storage.setItem('taskie_rest_c1', JSON.stringify({ minutes: 60, ends_at: start }));
  assert.equal(readRest('c1', start, storage), null, 'only the offered lengths are accepted');
});
