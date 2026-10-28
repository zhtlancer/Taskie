import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStatsRange, estimateSeconds, unestimatedCount, timeStatsCsv, timeStatsFilename } from '../src/utils/timeStatsReport.js';

// Parse RFC 4180 fields, including embedded commas, quotes and newlines.
function parseCsv(csv) {
  const rows = [], row = [];
  let field = '', quoted = false;
  const text = csv.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\r')) {
      row.push(field); field = '';
      if (c === '\r') { rows.push([...row]); row.length = 0; i++; }
    } else field += c;
  }
  return rows;
}

const stats = {
  from: '2026-10-01', to: '2026-10-02',
  days: [
    { date: '2026-10-01', recorded_seconds: 61, estimated_seconds: 181, sessions: 3, missing: 2, estimated_missing: 1, finished_at: null },
    { date: '2026-10-02', recorded_seconds: 0, estimated_seconds: 0, sessions: 0, missing: 0, estimated_missing: 0, finished_at: '00:30' }
  ],
  tasks: [{ title: '=HYPERLINK("x"),\n题目', subject: '数学', kind: 'template', recorded_seconds: 61, estimated_seconds: 181,
    sessions: 3, recorded: 1, missing: 2, estimated_missing: 1, average_seconds: 61, min_seconds: 61, max_seconds: 61,
    expected_minutes: null, judged: 0, over_expected: 0 },
  { title: '未计时', subject: '语文', kind: 'goal', recorded_seconds: 0, estimated_seconds: 0,
    sessions: 1, recorded: 0, missing: 1, estimated_missing: 0, average_seconds: null, min_seconds: null, max_seconds: null,
    expected_minutes: null, judged: 0, over_expected: 0 }]
};

test('custom ranges count both ends, validate leap dates and allow exactly 366 days in any device timezone', () => {
  for (const [from, to] of [['2026-10-01', '2026-10-01'], ['2024-02-29', '2025-02-28'], ['2025-01-01', '2026-01-01']]) assert.equal(validateStatsRange(from, to), '');
  for (const [from, to] of [['2026-02-29', '2026-03-01'], ['2026-13-01', '2026-13-02'], ['', '2026-01-01'], [undefined, null]]) assert.match(validateStatsRange(from, to), /有效/);
  assert.match(validateStatsRange('2026-10-02', '2026-10-01'), /早于/);
  assert.match(validateStatsRange('2024-01-01', '2025-01-01'), /366/);
});

test('daily CSV preserves exact seconds, known zero, unknown completion and unestimated counts', () => {
  const csv = timeStatsCsv(stats, '小明', 'Asia/Shanghai', 'daily');
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'UTF-8 BOM supports Chinese spreadsheet imports');
  const rows = parseCsv(csv);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['小明', stats.from, stats.to, 'Asia/Shanghai', '2026-10-01', '61', '120', '181', '3', '2', '1', '1', '']);
  assert.deepEqual(rows[2].slice(4), ['2026-10-02', '0', '0', '0', '0', '0', '0', '0', '00:30']);
  assert.equal(estimateSeconds(stats.days[0]), 120);
  assert.equal(unestimatedCount(stats.days[0]), 1);
});

test('task CSV quotes user text, neutralizes spreadsheet formulas and keeps unknown averages empty', () => {
  const rows = parseCsv(timeStatsCsv(stats, '\t+小明', 'Asia/Shanghai', 'tasks'));
  assert.equal(rows[1][0], "'\t+小明");
  assert.equal(rows[1][4], `'${stats.tasks[0].title}`);
  assert.deepEqual(rows[1].slice(7), ['61', '120', '181', '3', '1', '2', '1', '1', '61', '61', '61', '', '0', '0']);
  assert.deepEqual(rows[2].slice(15, 19), ['', '', '', '']);
  for (const title of [' @SUM(1)', '\r=1', '-1+2', '+1', '\uFEFF=1']) {
    const data = { ...stats, tasks: [{ ...stats.tasks[0], title }] };
    assert.equal(parseCsv(timeStatsCsv(data, '孩子', 'UTC', 'tasks'))[1][4], `'${title}`);
  }
});

test('empty CSV keeps headers; filenames identify child, loaded range and report type', () => {
  const empty = { ...stats, tasks: [], days: [] };
  assert.equal(parseCsv(timeStatsCsv(empty, '孩子', 'UTC', 'tasks')).length, 1);
  assert.equal(parseCsv(timeStatsCsv(empty, '孩子', 'UTC', 'daily')).length, 1);
  assert.equal(timeStatsFilename(stats, '小/明:*', 'daily'), '小_明__-用时统计-2026-10-01_2026-10-02-按日.csv');
  assert.throws(() => timeStatsCsv(stats, '孩子', 'UTC', 'unknown'));
});
