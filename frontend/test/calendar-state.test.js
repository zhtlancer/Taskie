import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarState } from '../src/utils/calendarState.js';

test('calendar has no zone before loading; concurrent and later consumers share one request', async () => {
  let resolve, requests = 0;
  const calendar = createCalendarState(() => { requests++; return new Promise(done => { resolve = done; }); });
  assert.equal(calendar.timeZone.value, null);
  assert.equal(calendar.ready.value, false);
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
  assert.equal(calendar.ready.value, true);
});
for (const response of [new Error('offline'), {}, { time_zone: 'invalid/zone' }]) {
  test(`calendar failure uses explicit UTC fallback (${JSON.stringify(response)})`, async () => {
    const calendar = createCalendarState(async () => { if (response instanceof Error) throw response; return response; });
    await calendar.load();
    assert.equal(calendar.timeZone.value, 'UTC');
    assert.equal(calendar.ready.value, false);
    assert.match(calendar.error.value, /暂按 UTC/);
    assert.equal(calendar.loading.value, false);
  });
}


test('retry bypasses cached failure, deduplicates callers and clears the write block', async () => {
  let count = 0, resolve;
  const calendar = createCalendarState(() => {
    count++;
    if (count === 1) return Promise.reject(new Error('offline'));
    return new Promise(done => { resolve = done; });
  }, { clock: () => Date.parse('2026-10-22T02:30:00Z') });
  await calendar.load();
  assert.equal(calendar.ready.value, false);
  assert.equal(calendar.today.value, '2026-10-22'); // Only display fallback.
  const retry = calendar.load({ force: true });
  const duplicate = calendar.load({ force: true });
  assert.equal(calendar.ready.value, false);
  resolve({ time_zone: 'America/New_York' });
  await Promise.all([retry, duplicate]);
  assert.equal(count, 2);
  assert.equal(calendar.ready.value, true);
  assert.equal(calendar.today.value, '2026-10-21');
  assert.equal(calendar.error.value, '');
});

for (const [zone, before] of [
  ['America/New_York', '2026-10-22T03:59:00Z'],
  ['Asia/Shanghai', '2026-10-21T15:59:00Z'],
  ['Pacific/Kiritimati', '2026-10-21T09:59:00Z'],
  ['Pacific/Pago_Pago', '2026-10-22T10:59:00Z']
]) test(`shared day updates by interval and on resume in ${zone}, and stops with its scope`, async t => {
  let now = Date.parse(before);
  const calendar = createCalendarState(async () => ({ time_zone: zone }), { clock: () => now });
  const doc = new EventTarget(), win = new EventTarget();
  doc.hidden = false;
  for (const [name, target] of [['document', doc], ['window', win]]) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: target });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  t.mock.timers.enable({ apis: ['setInterval'] });
  await calendar.load();
  calendar.start(); calendar.start();
  assert.equal(calendar.today.value, '2026-10-21');
  now += 120000;
  t.mock.timers.tick(1000);
  assert.equal(calendar.today.value, '2026-10-22');
  now += 86400000;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calendar.today.value, '2026-10-23');
  now += 86400000;
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(calendar.today.value, '2026-10-24');
  calendar.stop();
  now += 86400000;
  t.mock.timers.tick(60000);
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pageshow'));
  assert.equal(calendar.today.value, '2026-10-24');
});
