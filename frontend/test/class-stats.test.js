import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFee, feeText } from '../src/utils/classStats.js';
test('optional tuition keeps zero, accepts cents exactly and rejects extra precision', () => {
  assert.equal(parseFee(''), null);
  assert.equal(parseFee('  '), null);
  assert.equal(parseFee('0'), 0);
  assert.equal(parseFee('100.01'), 10001);
  assert.equal(parseFee('0.29'), 29);
  assert.equal(feeText(0), '¥0.00');
  assert.equal(feeText(null), '—');
  for (const text of ['1.001', '-1', 'NaN', '1e3', '10000000.01']) assert.throws(() => parseFee(text));
});
