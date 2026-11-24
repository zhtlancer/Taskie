const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../src/utils/date');
const { SCHEMA_VERSION } = require('../src/db');

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-25', '23:30:00')) });
  const c = createTestApp(); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const s = c.app.services, today = getTodayDate();
  const child = s.childrenService.createChild({ name: '待补充作业' });
  const other = s.childrenService.createChild({ name: '另一个孩子' });
  const cls = s.scheduleService.createClass({ title: '钢琴', child_ids: [child.id], start_date: today,
    days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00', total_lessons: 3, auto_homework: true });
  const receipt = s.classStatsService.setAttendance(cls.id, child.id, today, { status: 'attended' }).auto_homework;
  const record = () => s.homeworkService.get(receipt.record_id);
  const call = (method, url, payload, headers) => c.app.inject({ method, url, payload, headers });
  const list = async () => { const r = await call('GET', '/api/homework-content-requests'); assert.equal(r.statusCode, 200, r.body); return r.json(); };
  const keep = (version = record().edit_version, headers) => call('POST', `/api/homework/${receipt.record_id}/confirm-content`, { expected_version: version }, headers);
  return { ...c, ...s, today, child, other, cls, receipt, record, call, list, keep };
}

test('new class and recurring homework are explicitly pending; manual lookalikes are not', async t => {
  const c = await fixture(t);
  assert.equal(c.record().content_pending, true);
  const manual = c.homeworkService.create(c.child.id, { subject: '语文', content: c.record().content, content_pending: true,
    due_date: c.today, create_task: false }, 'parent');
  assert.equal(manual.content_pending, false);
  c.recurringHomeworkService.create(c.other.id, { subject: '英语', weekday: getDayOfWeek(c.today), start_date: c.today, points: 5 });
  const rows = await c.list();
  assert.equal(rows.length, 2);
  assert.ok(rows.some(row => row.child_id === c.other.id && row.recurring_title && row.content === '' && row.content_pending));
  assert.ok(rows.every(row => row.child_name && row.edit_version));
});

test('content edits clear reminders; date/point edits and task completion do not', async t => {
  const c = await fixture(t), r = c.record();
  c.homeworkService.update(r.id, { points: 15, due_date: shiftDate(c.today, 2), content: r.content, expected_version: r.edit_version }, 'parent');
  assert.equal(c.record().content_pending, true);
  c.homeworkStudyService.manual(r.id, { request_id: 'content-study-record', date: c.today, duration_seconds: 120 }, 'parent');
  const done = await c.call('POST', `/api/homework/${r.id}/complete`, {});
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(c.record().content_pending, true);
  const points = c.rewardsService.getTotalPoints(c.child.id);
  const duration = c.homeworkStudyService.details(r.id).total_seconds;
  c.homeworkService.update(r.id, { content: '练习第一首曲子三遍', expected_version: c.record().edit_version }, 'parent');
  assert.equal(c.record().content_pending, false);
  assert.equal(c.record().task.is_completed, true);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), points);
  assert.equal(c.homeworkStudyService.details(r.id).total_seconds, duration);
  assert.equal((await c.list()).length, 0);
});

test('keeping current content requires the current version and survives retries/generation changes', async t => {
  const c = await fixture(t), old = c.record();
  assert.equal((await c.keep(old.edit_version, { 'X-Taskie-Data-Generation': 'stale' })).statusCode, 409);
  assert.equal(c.record().content_pending, true);
  c.homeworkService.update(old.id, { points: 11 }, 'parent');
  assert.equal((await c.keep(old.edit_version)).statusCode, 409);
  assert.equal((await c.call('POST', `/api/homework/${old.id}/confirm-content`, {})).statusCode, 400);
  assert.equal((await c.keep()).statusCode, 200);
  assert.equal(c.record().content_pending, false);
  assert.equal(c.record().content, old.content);
  assert.equal(c.record().task.is_completed, false);
  assert.equal(c.rewardsService.getTotalPoints(c.child.id), 0);
  c.classStatsService.setAttendance(c.cls.id, c.child.id, c.today, { status: 'attended' });
  c.classHomeworkService.ensure(c.cls.id, c.child.id, c.today);
  assert.equal(c.record().content_pending, false, 'repeated automatic generation does not re-open content review');
  assert.equal((await c.keep()).statusCode, 200);
});

test('children cannot read the parent queue, confirm content, or edit other children’s records', async t => {
  const c = await fixture(t);
  for (const child of [c.child, c.other]) {
    const headers = { authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: child.id, epoch: c.app.sessionEpoch() })}` };
    assert.equal((await c.call('GET', '/api/homework-content-requests', undefined, headers)).statusCode, 403);
    assert.equal((await c.keep(c.record().edit_version, headers)).statusCode, 403);
    assert.equal((await c.call('PUT', `/api/homework/${c.record().id}`, { content: '孩子不能替家长核对' }, headers)).statusCode, 403);
  }
  assert.equal(c.record().content_pending, true);
});

test('v47 backups upgrade without inventing pending history; current backups retain flags and damaged ones are rejected', async t => {
  const c = await fixture(t);
  const backup = await c.app.backupService.create('content-test');
  const archive = fs.readFileSync(c.app.backupService.getPath(backup.name));
  const packed = JSON.parse(gunzipSync(archive));
  const altered = mutate => {
    const db = new Database(Buffer.from(packed.database, 'base64'));
    try { mutate(db); return gzipSync(JSON.stringify({ ...packed, database: db.serialize().toString('base64') })); }
    finally { db.close(); }
  };
  await c.keep();
  await c.app.backupService.restore(archive);
  assert.equal(c.record().content_pending, true);
  const strip = db => db.exec('DROP INDEX idx_homework_content_pending; ALTER TABLE homework_records DROP COLUMN content_pending');
  await assert.rejects(c.app.backupService.restore(altered(strip)), /待补充/);
  assert.equal(c.record().content_pending, true);
  await assert.rejects(c.app.backupService.restore(altered(db => {
    db.pragma('ignore_check_constraints = ON'); db.exec('UPDATE homework_records SET content_pending = 2');
  })));
  assert.equal(c.record().content_pending, true);
  await c.app.backupService.restore(altered(db => { strip(db); db.pragma('user_version = 47'); }));
  assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(c.record().content_pending, false);
  assert.equal((await c.list()).length, 0);
});
