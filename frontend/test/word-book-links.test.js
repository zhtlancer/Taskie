import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPendingBookLinks } from '../src/utils/wordBookSource.js';

test('createPendingBookLinks preserves receipt across 5xx/network errors and isolates stale callbacks', async () => {
  let seq = 0;
  const links = createPendingBookLinks(() => `req-${++seq}`);
  const seen = [];

  await assert.rejects(
    () => links.run('book-1', () => ({ character_id: 'c1' }), payload => {
      seen.push(payload.request_id);
      return Promise.reject(Object.assign(new Error('503'), { status: 503 }));
    }, () => true),
    { message: '503' }
  );
  await assert.rejects(
    () => links.run('book-1', () => ({ character_id: 'c1' }), payload => {
      seen.push(payload.request_id);
      return Promise.reject(Object.assign(new Error('offline'), { networkFailure: true }));
    }, () => true),
    { message: 'offline' }
  );
  await assert.rejects(
    () => links.run('book-1', () => ({ character_id: 'c1' }), payload => {
      seen.push(payload.request_id);
      return Promise.reject(Object.assign(new Error('409'), { status: 409 }));
    }, () => true),
    { message: '409' }
  );
  await links.run('book-1', () => ({ character_id: 'c1' }), payload => {
    seen.push(payload.request_id);
    return Promise.resolve('ok');
  }, () => true);

  assert.deepEqual(seen, ['req-1', 'req-1', 'req-1', 'req-2']);

  let activeEpoch = 1;
  let releaseOld;
  const oldRun = links.run('book-1', () => ({ character_id: 'c1' }), payload => {
    seen.push(payload.request_id);
    return new Promise((_, reject) => {
      releaseOld = () => reject(Object.assign(new Error('late 400'), { status: 400 }));
    });
  }, () => activeEpoch === 1);

  activeEpoch = 2;
  links.clear();
  await assert.rejects(
    () => links.run('book-1', () => ({ character_id: 'c1' }), payload => {
      seen.push(payload.request_id);
      return Promise.reject(Object.assign(new Error('new 503'), { status: 503 }));
    }, () => activeEpoch === 2),
    { message: 'new 503' }
  );

  releaseOld();
  await assert.rejects(() => oldRun, { message: 'late 400' });

  await links.run('book-1', () => ({ character_id: 'c1' }), payload => {
    seen.push(payload.request_id);
    return Promise.resolve('ok');
  }, () => activeEpoch === 2);

  assert.deepEqual(seen.slice(4), ['req-3', 'req-4', 'req-4']);
});
