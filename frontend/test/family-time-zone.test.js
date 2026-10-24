import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as dates from '../src/utils/businessDate.js';

// Exercise the display functions used by the components, in isolated device clocks.
const source = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
function displayFunction(file, name, deviceZone, familyZone, now) {
  const previous = process.env.TZ;
  process.env.TZ = deviceZone;
  const code = source(file).match(new RegExp(`function ${name}\\([^]*?\\n}`))[0];
  const RealDate = Date;
  const Clock = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return RealDate.parse(now); }
  };
  const fn = runInNewContext(`(${code})`, {
    ...dates, Date: Clock, calendar: { timeZone: familyZone }, timeZone: { value: familyZone }
  });
  return { call: (...args) => fn(...args), restore: () => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; } };
}
for (const device of ['America/Los_Angeles', 'Asia/Tokyo']) {
  test(`history pure dates retain day and weekday on ${device}`, () => {
    const format = displayFunction('views/HistoryView.vue', 'formatDate', device);
    try {
      assert.equal(format.call('2026-10-21'), '10月21日 (周三)');
      assert.equal(format.call('2027-01-01'), '1月1日 (周五)');
    } finally { format.restore(); }
  });
  test(`weekly chart uses the date's weekday on ${device}`, () => {
    const old = process.env.TZ;
    process.env.TZ = device;
    try {
      const code = source('components/WeeklyChart.vue').split('const chartData = computed(() => {')[1].split('const completionRates')[0];
      const labels = runInNewContext(`(() => { ${code}; return labels; })()`, {
        ...dates, props: { historyData: [
          { date: '2026-10-21', total_tasks: 1 }, { date: '2026-10-22', total_tasks: 0 },
          { date: '2027-01-01', not_opened: true }
        ] }, weekdayNames: ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
      });
      assert.deepEqual(Array.from(labels), ['10/21 (周三)', '10/22 (周四·休息)', '1/1 (周五·未打卡)']);
    } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
  });
  test(`points today and clock follow New York on ${device}`, () => {
    const format = displayFunction('components/PointsLog.vue', 'formatTime', device, 'America/New_York', '2026-10-21T05:30:00Z');
    try {
      assert.equal(format.call('2026-10-21T04:15:00Z'), '今天 00:15');
      assert.equal(format.call('2026-10-21T03:45:00Z'), '10月20日 23:45');
      assert.equal(format.call('2026-10-20T06:00:00Z'), '10月20日 02:00');
    } finally { format.restore(); }
  });
}
