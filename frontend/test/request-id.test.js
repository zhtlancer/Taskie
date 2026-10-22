import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRequestId, pendingRequests } from '../src/utils/requestId.js';

test('request ids satisfy the server format with or without crypto.randomUUID', () => {
  assert.match(newRequestId(), /^[a-zA-Z0-9_-]{8,100}$/);
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  try { assert.match(newRequestId(), /^[a-zA-Z0-9_-]{8,100}$/); }
  finally { Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true }); }
});

test('a retried action keeps its id until it succeeds; other actions get their own', () => {
  const requests = pendingRequests();
  const first = requests.idFor('goal-1:{"amount":5}');
  assert.equal(requests.idFor('goal-1:{"amount":5}'), first, 'retry after a failure reuses the id');
  assert.notEqual(requests.idFor('goal-1:{"amount":6}'), first, 'a changed amount is a new action');
  requests.done('goal-1:{"amount":5}');
  assert.notEqual(requests.idFor('goal-1:{"amount":5}'), first, 'the next entry after success is new');
});
