const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, msUntilFamilyMidnight, MIDNIGHT_GUARD_MS } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

// Moves the clock so TIME_ZONE midnight is `ms` away; real time keeps flowing.
function clockBeforeMidnight(t, ms) {
  const NativeDate = Date, shift = msUntilFamilyMidnight() - ms;
  global.Date = class extends NativeDate {
    constructor(...args) { if (args.length) super(...args); else super(NativeDate.now() + shift); }
    static now() { return NativeDate.now() + shift; }
  };
  t.after(() => { global.Date = NativeDate; });
}

test('a test that starts just before family midnight runs entirely on the next day', t => {
  clockBeforeMidnight(t, 300);
  const before = getTodayDate();
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx));
  assert.equal(getTodayDate(), shiftDate(before, 1));
  assert.ok(msUntilFamilyMidnight() > 86_400_000 - MIDNIGHT_GUARD_MS);
});

test('a test away from midnight starts on the same day without waiting', t => {
  clockBeforeMidnight(t, MIDNIGHT_GUARD_MS + 60_000);
  const before = getTodayDate(), left = msUntilFamilyMidnight();
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx));
  assert.equal(getTodayDate(), before);
  assert.ok(left - msUntilFamilyMidnight() < MIDNIGHT_GUARD_MS);
});
