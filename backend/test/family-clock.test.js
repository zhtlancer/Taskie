const { test } = require('node:test');
const assert = require('node:assert/strict');
const { familyInstant } = require('./helper');

test('family clock fixtures use the date-specific offset, including DST and UTC+14', () => {
  for (const [zone, date, time, expected] of [
    ['Asia/Shanghai', '2026-10-20', '23:50:00', '2026-10-20T15:50:00.000Z'],
    ['UTC', '2026-10-20', '23:50:00', '2026-10-20T23:50:00.000Z'],
    ['Pacific/Kiritimati', '2026-10-20', '00:30:00', '2026-10-19T10:30:00.000Z'],
    ['America/New_York', '2026-01-20', '12:00:00', '2026-01-20T17:00:00.000Z'],
    ['America/New_York', '2026-07-20', '12:00:00', '2026-07-20T16:00:00.000Z'],
    ['America/New_York', '2026-03-08', '03:30:00', '2026-03-08T07:30:00.000Z'],
    ['America/New_York', '2026-11-01', '02:30:00', '2026-11-01T07:30:00.000Z'],
    ['Asia/Shanghai', '2026-10-22', '23:59:59.999', '2026-10-22T15:59:59.999Z']
  ]) assert.equal(familyInstant(date, time, zone), expected, `${zone} ${date} ${time}`);
  assert.throws(() => familyInstant('2026-03-08', '02:30:00', 'America/New_York'), /does not exist/);
});
