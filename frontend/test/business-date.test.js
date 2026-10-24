import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDate, businessClock, businessDayLabel } from '../src/utils/businessDate.js';

test('business midnight follows the family time zone rather than UTC or device time', () => {
  const before = Date.parse('2026-10-20T15:59:59Z'), after = before + 1000;
  assert.equal(businessDate(before, 'Asia/Shanghai'), '2026-10-20');
  assert.equal(businessDate(after, 'Asia/Shanghai'), '2026-10-21');
  assert.equal(businessDate(after, 'UTC'), '2026-10-20');
  assert.equal(businessClock(after, 'Asia/Shanghai'), '00:00');
  assert.equal(businessDayLabel(businessDate(after, 'Asia/Shanghai')), '周三 · 10月21日');
});

test('business dates cover year changes and daylight saving time', () => {
  assert.equal(businessDate(Date.parse('2026-12-31T16:00:00Z'), 'Asia/Shanghai'), '2027-01-01');
  assert.equal(businessDayLabel('2027-01-01'), '周五 · 1月1日');
  assert.equal(businessClock(Date.parse('2026-03-08T06:59:59Z'), 'America/New_York'), '01:59');
  assert.equal(businessClock(Date.parse('2026-03-08T07:00:00Z'), 'America/New_York'), '03:00');
});

test('an unknown family zone never guesses a date or clock', () => {
  assert.equal(businessDate(Date.parse('2026-10-21T05:30:00Z')), '');
  assert.equal(businessClock(Date.parse('2026-10-21T05:30:00Z'), null), '');
});
