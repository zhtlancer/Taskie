import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarState } from '../src/utils/calendarState.js';

test('calendar has no zone before loading; concurrent and later consumers share one request', async () => {
  let resolve, requests = 0;
  const calendar = createCalendarState(() => { requests++; return new Promise(done => { resolve = done; }); });
  assert.equal(calendar.timeZone.value, null);
  const first = calendar.load(), second = calendar.load();
  assert.equal(calendar.loading.value, true);
  assert.equal(calendar.timeZone.value, null);
  resolve({ time_zone: 'America/New_York' });
  await Promise.all([first, second]);
  await calendar.load();
  assert.equal(requests, 1);
  assert.equal(calendar.timeZone.value, 'America/New_York');
  assert.equal(calendar.loading.value, false);
  assert.equal(calendar.error.value, '');
});
for (const response of [new Error('offline'), {}, { time_zone: 'invalid/zone' }]) {
  test(`calendar failure uses explicit UTC fallback (${JSON.stringify(response)})`, async () => {
    const calendar = createCalendarState(async () => { if (response instanceof Error) throw response; return response; });
    await calendar.load();
    assert.equal(calendar.timeZone.value, 'UTC');
    assert.match(calendar.error.value, /暂按 UTC/);
    assert.equal(calendar.loading.value, false);
  });
}
