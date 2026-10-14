import { test } from 'node:test';
import assert from 'node:assert/strict';

const { getPendingRedemptions } = await import('../src/api/redemptions.js');

// A paginated source shaped like GET /redemptions?status=pending&limit&offset.
const pagedSource = (records, calls = []) => async ({ status, limit, offset }) => {
  calls.push({ status, limit, offset });
  return records.filter(r => r.status === status).slice(offset, offset + limit);
};

test('pending requests are loaded across every page independently of newer history', async () => {
  const records = [
    ...Array.from({ length: 200 }, (_, i) => ({ id: `history-${i}`, status: 'approved' })),
    ...Array.from({ length: 201 }, (_, i) => ({ id: `pending-${i}`, status: 'pending' }))
  ];
  const calls = [];
  const pending = await getPendingRedemptions(pagedSource(records, calls));
  assert.equal(pending.length, 201);
  assert.equal(new Set(pending.map(r => r.id)).size, 201);
  assert.ok(pending.every(r => r.status === 'pending'));
  assert.deepEqual(calls.map(c => [c.status, c.offset, c.limit]), [['pending', 0, 200], ['pending', 200, 200]]);
});

test('a page of exactly the limit triggers one more request that ends the loop', async () => {
  const calls = [];
  const records = Array.from({ length: 200 }, (_, i) => ({ id: i, status: 'pending' }));
  assert.equal((await getPendingRedemptions(pagedSource(records, calls))).length, 200);
  assert.deepEqual(calls.map(c => c.offset), [0, 200]);
});

test('empty pending lists finish after one request and failed pages do not return partial results', async () => {
  let calls = 0;
  assert.deepEqual(await getPendingRedemptions(async () => { calls++; return []; }), []);
  assert.equal(calls, 1);
  await assert.rejects(() => getPendingRedemptions(async ({ offset }) => {
    if (offset) throw new Error('network failed');
    return Array.from({ length: 200 }, (_, i) => ({ id: i }));
  }), /network failed/);
});
