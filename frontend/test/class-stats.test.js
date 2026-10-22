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

test('the correction history reads as before → after for fees and attendance', async () => {
  const { changeText } = await import('../src/utils/classStats.js');
  assert.equal(changeText({ kind: 'fee', old_value: 10000, new_value: 20000 }), '学费 ¥100.00 → ¥200.00');
  assert.equal(changeText({ kind: 'fee', old_value: null, new_value: 5000 }), '学费 未设置 → ¥50.00');
  assert.equal(changeText({ kind: 'attendance', lesson_date: '2026-10-20', old_value: null, new_value: { status: 'absent', charged: false, note: '' } }),
    '2026-10-20 出勤 未确认 → 缺席·未消课');
  assert.equal(changeText({ kind: 'attendance', lesson_date: '2026-10-20', old_value: { status: 'attended', charged: true, note: '打卡' }, new_value: null }),
    '2026-10-20 出勤 已上课·消课（打卡） → 未确认');
});
