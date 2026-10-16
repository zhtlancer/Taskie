import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMinutes, formatPerUnit, improvements, minutesDelta, rangePresets, subjectOf } from '../src/utils/timeStats.js';

test('minutes read naturally, and deltas compare with the period before', () => {
  assert.deepEqual([formatMinutes(null), formatMinutes(0), formatMinutes(20), formatMinutes(2100), formatMinutes(3600), formatMinutes(4800)],
    [null, '0 分', '不到 1 分', '35 分', '1 小时', '1 小时 20 分']);
  assert.deepEqual([minutesDelta(3600, 0), minutesDelta(3600, 2400), minutesDelta(1800, 3000), minutesDelta(1810, 1800)],
    [null, '多 20 分', '少 20 分', '持平']);
  assert.deepEqual([formatPerUnit(150), formatPerUnit(900)], ['2.5 分钟', '15 分钟']);
  assert.deepEqual([subjectOf('数学'), subjectOf('科学')], ['数学', '其他']);
});

test('ranges are the last 7 and 30 days, plus the current term when a timetable covers today', () => {
  const today = '2026-10-16';
  assert.deepEqual(rangePresets([], today).map(r => [r.key, r.from, r.to]), [['7', '2026-10-10', today], ['30', '2026-09-17', today]]);
  const terms = [{ name: '上学期', start_date: '2026-02-20', end_date: '2026-07-01' }, { name: '四年级上', start_date: '2026-09-01', end_date: '2027-01-20' }];
  assert.deepEqual(rangePresets(terms, today).at(-1), { key: 'term', label: '本学期（四年级上）', from: '2026-09-01', to: today });
});

test('children only see gains: faster tasks and faster reading', () => {
  const stats = {
    tasks: [
      { key: 'a', title: '口算', average_seconds: 600, previous_average_seconds: 720 },
      { key: 'b', title: '听写', average_seconds: 900, previous_average_seconds: 600 },
      { key: 'c', title: '阅读', average_seconds: 600, previous_average_seconds: 630 },
      { key: 'd', title: '练字', average_seconds: 600, previous_average_seconds: null }
    ],
    goals: [{ id: 'g', title: '西游记', unit: '页', seconds_per_unit: 120, previous_seconds_per_unit: 180 }]
  };
  assert.deepEqual(improvements(stats).map(i => i.text), ['口算 平均比之前快了 2 分钟', '西游记 每页用时从 3 分钟 缩短到 2 分钟']);
});
