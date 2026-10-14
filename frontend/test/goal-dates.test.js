import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalChartDates } from '../src/utils/goalDates.js';

test('multi-year goals plot the recent 90 days through today rather than an old or future window', () => {
  const dates = goalChartDates({ start_date: '2023-01-01', end_date: '2028-01-01' }, '2026-10-14');
  assert.equal(dates.length, 90);
  assert.equal(dates[0], '2026-07-17');
  assert.equal(dates.at(-1), '2026-10-14');
});

test('backfilled completion ends the chart on the performed date and retains short ranges', () => {
  assert.deepEqual(goalChartDates({ start_date: '2026-10-05', end_date: '2027-01-01', completed_on: '2026-10-07' }, '2026-10-14'),
    ['2026-10-05', '2026-10-06', '2026-10-07']);
});

test('ended goals stop at their deadline and future goals have no actual progress dates', () => {
  assert.deepEqual(goalChartDates({ start_date: '2026-10-05', end_date: '2026-10-07' }, '2026-10-14'),
    ['2026-10-05', '2026-10-06', '2026-10-07']);
  assert.deepEqual(goalChartDates({ start_date: '2026-10-15', end_date: null }, '2026-10-14'), []);
});
