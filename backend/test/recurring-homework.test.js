const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { SCHEMA_VERSION } = require('../src/db');

async function fixture(t) {
  const NativeDate = Date;
  let instant = familyInstant('2026-11-18');
  global.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return NativeDate.parse(instant); }
  };
  const c = createTestApp(); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); global.Date = NativeDate; });
  const { childrenService, recurringHomeworkService: recurring, homeworkService: homework, tasksService: tasks, homeworkStudyService: study } = c.app.services;
  const child = childrenService.createChild({ name: '周期作业孩子' });
  const other = childrenService.createChild({ name: '另一孩子' });
  const body = { subject: '书法托管', weekday: 3, start_date: '2026-11-18', points: 12, track_time: true, expected_minutes: 20 };
  const url = `/api/children/${child.id}/recurring-homework`;
  const create = extra => recurring.create(child.id, { ...body, ...extra });
  const clock = date => { instant = familyInstant(date); };
  const headers = who => ({ authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: who.id, epoch: c.app.sessionEpoch() })}` });
  return { c, child, other, recurring, homework, tasks, study, body, url, create, clock, headers };
}

test('parent weekly rules create one blank-content homework and timed task; retry and child access are safe', async t => {
  const f = await fixture(t); const { c, child, other, body, url, homework, tasks, headers } = f;
  const response = await c.app.inject({ method: 'POST', url, payload: { ...body, request_id: 'weekly_template_request' } });
  assert.equal(response.statusCode, 201, response.body);
  const rule = response.json();
  assert.equal((await c.app.inject({ method: 'POST', url, payload: { ...body, request_id: 'weekly_template_request' } })).json().id, rule.id);
  tasks.generateToday(); tasks.generateToday();
  const [record] = homework.list(child.id);
  assert.equal(homework.list(child.id).length, 1);
  assert.equal(record.content, ''); assert.equal(record.recurring_title, '11月18日·书法托管作业');
  assert.deepEqual([record.assigned_date, record.due_date, record.points], ['2026-11-18', '2026-11-25', 12]);
  const task = tasks.getDailyTasks(child.id).find(row => row.id === record.daily_task_id);
  assert.equal(task.title, record.recurring_title); assert.equal(task.homework.recurring_title, record.recurring_title);
  assert.equal(task.track_time, true); assert.equal(task.expected_minutes, 20);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM point_logs').get().n, 0);
  for (const [method, path, payload] of [['GET', url], ['POST', url, body], ['PUT', `/api/recurring-homework/${rule.id}`, { enabled: false }], ['DELETE', `/api/recurring-homework/${rule.id}`], ['POST', `/api/recurring-homework/${rule.id}/skip`, {}]]) {
    assert.equal((await c.rawInject({ method, url: path, payload, headers: headers(child) })).statusCode, 403, `${method} ${path}`);
  }
  assert.equal((await c.rawInject({ method: 'GET', url: `/api/homework/${record.id}`, headers: headers(other) })).statusCode, 403);
  assert.equal((await c.rawInject({ method: 'GET', url: `/api/homework/${record.id}`, headers: headers(child) })).statusCode, 200);
  assert.equal(homework.list(other.id).length, 0);
  assert.equal((await c.app.inject({ method: 'POST', url, payload: { ...body, request_id: 'stale_generation' }, headers: { 'x-taskie-data-generation': 'old' } })).statusCode, 409);
});

test('content can be supplied later without changing sessions, state or other weekly assignments', async t => {
  const { create, child, homework, study, clock, recurring, c } = await fixture(t);
  const rule = create(); const first = homework.list(child.id)[0];
  study.manual(first.id, { request_id: 'recurring_study_original', date: '2026-11-18', duration_seconds: 125 }, 'parent');
  const sessions = c.db.prepare('SELECT * FROM homework_sessions').all();
  homework.update(first.id, { content: '练习第12页', expected_version: first.edit_version }, 'parent');
  assert.deepEqual(c.db.prepare('SELECT * FROM homework_sessions').all(), sessions);
  assert.equal(homework.get(first.id).task.is_completed, false);
  study.complete(first.id, 'parent');
  const points = c.db.prepare('SELECT * FROM point_logs').all();
  homework.update(first.id, { content: '补充老师要求' }, 'parent');
  assert.equal(homework.get(first.id).task.is_completed, true);
  assert.deepEqual(c.db.prepare('SELECT * FROM point_logs').all(), points);
  clock('2026-11-25'); recurring.ensure(child.id);
  const records = homework.list(child.id);
  assert.equal(records.length, 2); assert.equal(records.find(r => r.id !== first.id).content, '');
  recurring.remove(rule.id, { expected_version: recurring.get(rule.id).edit_version });
  assert.equal(homework.list(child.id).length, 2, 'deleting the template retains records and provenance');
  assert.equal(homework.get(first.id).recurring_title, first.recurring_title);
});

test('downtime catches up only the current occurrence, honors dates and never populates past task boards', async t => {
  const { create, child, homework, clock, recurring, c } = await fixture(t);
  const rule = create({ start_date: '2026-01-01', enabled: false });
  clock('2026-12-04'); recurring.update(rule.id, { enabled: true, expected_version: rule.edit_version });
  const [record] = homework.list(child.id);
  assert.deepEqual([record.assigned_date, record.task.date, record.due_date], ['2026-12-02', '2026-12-04', '2026-12-09']);
  assert.equal(homework.list(child.id).length, 1);
  assert.equal(c.db.prepare("SELECT COUNT(*) n FROM daily_tasks WHERE date < '2026-12-04'").get().n, 0);
  const current = recurring.get(rule.id);
  recurring.update(rule.id, { end_date: '2026-12-02', expected_version: current.edit_version });
  clock('2026-12-10'); recurring.ensure(child.id); assert.equal(homework.list(child.id).length, 1);
});

test('the end date includes its final scheduled day and retains that assignment through its own deadline', async t => {
  const { create, child, homework, clock, recurring } = await fixture(t);
  create({ end_date: '2026-11-25' });
  clock('2026-11-25'); recurring.ensure(child.id);
  const last = homework.list(child.id)[0];
  assert.deepEqual([last.assigned_date, last.due_date], ['2026-11-25', '2026-12-02']);
  assert.equal(homework.list(child.id).length, 2);
  clock('2026-12-02'); recurring.ensure(child.id);
  assert.equal(homework.list(child.id).length, 2, 'no occurrence is created after the end date');
  assert.equal(homework.get(last.id).task_state, 'open', 'the final assignment retains its own deadline');
});

test('the last assignment is caught up through its deadline after the rule ends, but never after expiry', async t => {
  const { create, child, homework, clock } = await fixture(t);
  clock('2026-12-09');
  create({ subject: '最后一期', start_date: '2026-12-02', end_date: '2026-12-03' });
  const [record] = homework.list(child.id);
  assert.deepEqual([record.assigned_date, record.task.date, record.due_date], ['2026-12-02', '2026-12-09', '2026-12-09']);
  clock('2026-12-10');
  create({ subject: '已过期课程', start_date: '2026-12-02', end_date: '2026-12-03' });
  assert.equal(homework.list(child.id).length, 1);
});

test('holiday suppression and manual skipping persist, including pre-generation and deletion tombstones', async t => {
  const { create, child, c, clock, recurring, homework } = await fixture(t);
  c.db.prepare('INSERT INTO periods(id, child_id, name, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('holiday', child.id, '假期', '2026-11-18', '2026-11-18', new Date().toISOString());
  const holiday = create({ pause_on_holidays: true });
  assert.equal(homework.list(child.id).length, 0);
  c.db.prepare('DELETE FROM periods WHERE id = ?').run('holiday'); recurring.ensure(child.id);
  assert.equal(homework.list(child.id).length, 0, 'a suppressed occurrence is never resurrected');
  const rule = create({ subject: '围棋', weekday: 4, start_date: '2026-11-19' });
  recurring.skip(rule.id, { date: '2026-11-19', expected_version: rule.edit_version });
  clock('2026-11-19'); recurring.ensure(child.id); assert.equal(homework.list(child.id).length, 0);
  clock('2026-11-26'); recurring.ensure(child.id);
  const record = homework.list(child.id).find(r => r.subject === '围棋'); assert.ok(record);
  recurring.skip(rule.id, { date: '2026-11-26', expected_version: recurring.get(rule.id).edit_version });
  assert.equal(homework.get(record.id).task.is_skipped, true);
  homework.delete(record.id, { delete_task: true }, 'parent'); recurring.ensure(child.id);
  assert.equal(homework.list(child.id).filter(r => r.subject === '围棋').length, 0);
  assert.equal(recurring.get(holiday.id).enabled, true);
});

test('a parent can skip this week in advance while last week still has outstanding homework', async t => {
  const { create, child, recurring, homework, clock } = await fixture(t);
  const rule = create(); const first = homework.list(child.id)[0];
  clock('2026-11-23');
  const current = recurring.list(child.id)[0];
  assert.equal(current.period_date, '2026-11-25');
  recurring.skip(rule.id, { date: current.period_date, expected_version: current.edit_version });
  assert.equal(homework.get(first.id).task.is_skipped, false);
  clock('2026-11-25'); recurring.ensure(child.id);
  assert.equal(homework.list(child.id).length, 1);
  clock('2026-12-02'); recurring.ensure(child.id);
  assert.equal(homework.list(child.id).length, 2);
});

test('template edits require current versions, retain current tasks and never duplicate after weekday changes', async t => {
  const { create, child, recurring, homework, clock } = await fixture(t);
  const rule = create({ start_date: '2026-10-01' }); const record = homework.list(child.id)[0];
  recurring.update(rule.id, { weekday: 4, subject: '书法新课', points: 25, expected_version: rule.edit_version });
  assert.equal(homework.list(child.id).length, 1);
  assert.equal(homework.get(record.id).points, 12); assert.equal(homework.get(record.id).subject, '书法托管');
  assert.throws(() => recurring.update(rule.id, { enabled: false, expected_version: rule.edit_version }), e => e.status === 409);
  assert.throws(() => recurring.remove(rule.id, {}), e => e.status === 400);
  clock('2026-11-19'); recurring.ensure(child.id); assert.equal(homework.list(child.id).length, 1);
  clock('2026-11-26'); recurring.ensure(child.id); assert.equal(homework.list(child.id).length, 2);
  assert.equal(homework.list(child.id)[0].points, 25);
});

test('invalid templates and generation failures roll back the rule, task and occurrence atomically', async t => {
  const { c, body, url, child, homework } = await fixture(t);
  for (const extra of [{ weekday: 7 }, { subject: '' }, { start_date: '2026-02-30' }, { end_date: '2026-11-01' }, { enabled: 'yes' }, { points: -1 }, { track_time: 'yes' }]) {
    assert.equal((await c.app.inject({ method: 'POST', url, payload: { ...body, ...extra } })).statusCode, 400);
  }
  c.db.exec("CREATE TRIGGER fail_recurring BEFORE INSERT ON recurring_homework_occurrences BEGIN SELECT RAISE(ABORT, 'fail receipt'); END");
  assert.equal((await c.app.inject({ method: 'POST', url, payload: body })).statusCode, 500);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM recurring_homework_templates').get().n, 0);
  assert.equal(homework.list(child.id).length, 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM daily_tasks').get().n, 0);
});

test('v35 backup restores templates and tombstones, rejects missing new schema, and upgrades v34', async t => {
  const { c, create, child, homework, recurring } = await fixture(t);
  const rule = create(); homework.delete(homework.list(child.id)[0].id, { delete_task: true }, 'parent');
  const backup = c.app.backupService;
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  const rewrite = mutate => {
    const data = JSON.parse(gunzipSync(archive)); const db = new Database(Buffer.from(data.database, 'base64'));
    try { mutate(db); data.database = db.serialize().toString('base64'); return gzipSync(JSON.stringify(data)); } finally { db.close(); }
  };
  recurring.remove(rule.id, { expected_version: rule.edit_version });
  await backup.restore(archive); assert.equal(recurring.list(child.id).length, 1); assert.equal(homework.list(child.id).length, 0);
  for (const sql of ['DROP TABLE recurring_homework_templates', 'DROP TABLE recurring_homework_occurrences', 'ALTER TABLE recurring_homework_templates DROP COLUMN weekday']) {
    await assert.rejects(() => backup.restore(rewrite(db => db.exec(sql))), /周期作业模板或生成凭据/);
    assert.equal(recurring.list(child.id).length, 1);
  }
  await backup.restore(rewrite(db => { db.exec('DROP TABLE recurring_homework_occurrences; DROP TABLE recurring_homework_templates'); db.pragma('user_version = 34'); }));
  assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(recurring.list(child.id).length, 0);
});
