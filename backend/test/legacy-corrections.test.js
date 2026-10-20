const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { initDb } = require('../src/db');

async function fixture(t, course = false) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T04:00:00Z') });
  const c = createTestApp(); t.after(() => cleanupTestApp(c)); await c.app.ready();
  const services = c.app.services;
  const child = services.childrenService.createChild({ name: '旧累计验收' });
  const record = course ? services.homeworkService.create(child.id, { subject: '数学', content: '练习', due_date: '2026-10-22', create_task: true, points: 10 }, 'parent') : null;
  const task = record?.task || services.tasksService.createAdhocTask(child.id, { title: '普通练习', subject: '数学', track_time: true, points: 10 });
  const service = course ? services.homeworkStudyService : services.taskStudyService;
  const id = record?.id || task.id;
  const url = `/api/${course ? 'homework' : 'daily-tasks'}/${id}/study/legacy`;
  c.db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = 900 WHERE id = ?').run(task.id);
  const headers = childId => ({ authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: childId || child.id, epoch: c.app.sessionEpoch() })}` });
  const correct = (seconds, expected = 900, reason = '核对计时后更正') => c.app.inject({ method: 'PUT', url, payload: { duration_seconds: seconds, expected_old_seconds: expected, reason } });
  return { ...c, ...services, child, task, record, service, id, url, headers, correct };
}

for (const course of [false, true]) {
  test(`${course ? 'homework' : 'ordinary'} legacy corrections retain sessions, points and completion; 900 -> 600 -> 0 is audited`, async t => {
    const c = await fixture(t, course);
    c.service.manual(c.id, { request_id: 'legacy_correction_session', duration_seconds: 300 }, 'parent');
    c.service.complete(c.id, 'parent');
    const row = () => c.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(c.task.id);
    const before = row(), sessions = c.service.details(c.id).sessions;
    let response = await c.correct(600);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().total_seconds, 900);
    assert.deepEqual(response.json().sessions, sessions);
    response = await c.correct(0, 600, '确认旧累计应归零');
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().total_seconds, 300);
    assert.equal(response.json().legacy_available, true);
    assert.deepEqual(response.json().legacy_corrections.map(e => [e.old_seconds, e.new_seconds, e.actor]), [[600, 0, 'parent'], [900, 600, 'parent']]);
    assert.deepEqual(row(), { ...before, homework_legacy_seconds: 0 });
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
    assert.equal(c.timeStatsService.stats(c.child.id, '2026-10-20', '2026-10-20').summary.recorded_seconds, 300);
    assert.equal((await c.correct(0, 0)).statusCode, 200);
    assert.equal(c.service.details(c.id).legacy_corrections.length, 2, 'same-value writes do not add audit noise');
    assert.equal((await c.correct(120, 900)).statusCode, 409, 'stale writes cannot overwrite a correction');
    assert.equal(c.service.details(c.id).total_seconds, 300);
  });

  test(`${course ? 'homework' : 'ordinary'} legacy correction requires a parent and validates all inputs`, async t => {
    const c = await fixture(t, course);
    const payload = { duration_seconds: 600, expected_old_seconds: 900, reason: '核实' };
    const sibling = c.childrenService.createChild({ name: '其他孩子' });
    for (const headers of [c.headers(), c.headers(sibling.id)]) {
      const denied = await c.rawInject({ method: 'PUT', url: c.url, payload, headers });
      assert.equal(denied.statusCode, 403);
    }
    assert.equal((await c.rawInject({ method: 'PUT', url: c.url, payload })).statusCode, 401);
    assert.throws(() => c.service.correctLegacy(c.id, payload, 'child'), e => e.status === 403);
    for (const body of [null, {}, { ...payload, reason: '' }, { ...payload, reason: ' '.repeat(4) }, { ...payload, reason: 'x'.repeat(501) },
      { ...payload, duration_seconds: -1 }, { ...payload, duration_seconds: 43201 }, { ...payload, duration_seconds: '600' },
      { ...payload, duration_seconds: 1.2 }, { ...payload, expected_old_seconds: null }]) {
      const invalid = await c.app.inject({ method: 'PUT', url: c.url, payload: body });
      assert.equal(invalid.statusCode, 400, JSON.stringify(body));
    }
    assert.equal(c.service.details(c.id).legacy_seconds, 900);
    assert.equal(c.service.details(c.id).legacy_corrections.length, 0);
  });
}

test('a failed audit insert rolls back the correction and legacy conversion', async t => {
  const c = await fixture(t);
  c.db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = NULL, timer_elapsed_seconds = 900 WHERE id = ?').run(c.task.id);
  c.db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON study_legacy_corrections BEGIN SELECT RAISE(ABORT, 'audit failure'); END");
  assert.equal((await c.correct(600)).statusCode, 500);
  assert.deepEqual(c.db.prepare('SELECT homework_legacy_seconds, timer_elapsed_seconds FROM daily_tasks WHERE id = ?').get(c.task.id), { homework_legacy_seconds: null, timer_elapsed_seconds: 900 });
});

test('legacy corrections and zero totals survive restore; v23 backups upgrade; incomplete v24 backups are rejected', async t => {
  const c = await fixture(t);
  await c.correct(0);
  const backup = c.app.backupService;
  const archive = fs.readFileSync(backup.getPath(backup.create().name));
  await c.correct(600, 0);
  backup.restore(archive);
  assert.equal(c.service.details(c.id).legacy_seconds, 0);
  assert.equal(c.service.details(c.id).legacy_corrections.length, 1);
  const packed = JSON.parse(gunzipSync(archive));
  const old = new Database(Buffer.from(packed.database, 'base64'));
  old.exec('DROP TABLE study_legacy_corrections');
  const pack = () => gzipSync(JSON.stringify({ ...packed, database: old.serialize().toString('base64') }));
  assert.throws(() => backup.restore(pack()), /旧累计更正记录/);
  assert.equal(c.service.details(c.id).legacy_corrections.length, 1);
  old.pragma('user_version = 23');
  backup.restore(pack());
  old.close();
  assert.equal(c.db.pragma('user_version', { simple: true }), 24);
  assert.equal(c.service.details(c.id).legacy_seconds, 0);
  assert.deepEqual(c.service.details(c.id).legacy_corrections, []);
});

test('deleting a course record keeps corrected legacy statistics and cannot resurrect its mirrored old duration', async t => {
  const c = await fixture(t, true);
  c.db.prepare("UPDATE daily_tasks SET is_completed = 1, duration_seconds = 900, completed_at = '2026-10-20T04:00:00Z' WHERE id = ?").run(c.task.id);
  const seconds = () => c.timeStatsService.stats(c.child.id, '2026-10-20', '2026-10-20').summary.recorded_seconds;
  c.homeworkService.delete(c.record.id, { delete_task: false }, 'parent');
  assert.equal(seconds(), 900, 'a mirrored aggregate is counted once after deleting the record');
  await c.app.inject({ method: 'PUT', url: `/api/daily-tasks/${c.task.id}/study/legacy`, payload: { duration_seconds: 600, expected_old_seconds: 900, reason: '更正' } });
  assert.equal(seconds(), 600);
  await c.app.inject({ method: 'PUT', url: `/api/daily-tasks/${c.task.id}/study/legacy`, payload: { duration_seconds: 0, expected_old_seconds: 600, reason: '归零' } });
  assert.equal(seconds(), 0);
});

test('v22 upgrades attribute course homework to its actual evening, retain task dates and exclude parent backfills', async t => {
  const c = await fixture(t, true);
  c.db.prepare("UPDATE daily_tasks SET is_completed = 1, completed_at = '2026-10-20T17:30:00Z', finish_on_actual_date = 0 WHERE id = ?").run(c.task.id);
  c.db.exec('DROP TABLE study_legacy_corrections; ALTER TABLE daily_tasks DROP COLUMN finish_on_actual_date');
  c.db.pragma('user_version = 22');
  initDb(c.db);
  const finishes = () => c.timeStatsService.finishTimes(c.child.id, '2026-10-20', '2026-10-21');
  assert.deepEqual([...finishes()], [['2026-10-20', 25 * 60 + 30]]);
  const row = c.db.prepare('SELECT date, finish_on_actual_date FROM daily_tasks WHERE id = ?').get(c.task.id);
  assert.deepEqual(row, { date: '2026-10-20', finish_on_actual_date: 1 });
  c.homeworkService.delete(c.record.id, { delete_task: false }, 'parent');
  assert.deepEqual([...finishes()], [['2026-10-20', 1530]]);
  c.db.prepare("UPDATE daily_tasks SET completed_at = '2026-10-21T11:06:00Z' WHERE id = ?").run(c.task.id);
  assert.deepEqual([...finishes()], [['2026-10-21', 19 * 60 + 6]]);
  c.db.prepare("UPDATE daily_tasks SET completion_source = 'parent_backfill' WHERE id = ?").run(c.task.id);
  assert.equal(finishes().size, 0);
});


test('new tasks without an old aggregate use manual sessions, not legacy corrections', async t => {
  const c = await fixture(t);
  c.db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = 0 WHERE id = ?').run(c.task.id);
  assert.equal(c.service.details(c.id).legacy_available, false);
  assert.equal((await c.correct(600, 0)).statusCode, 409);
  const missing = await c.app.inject({ method: 'PUT', url: '/api/daily-tasks/missing/study/legacy', payload: { duration_seconds: 600, expected_old_seconds: 900, reason: '核实' } });
  assert.equal(missing.statusCode, 404);
});


test('revoking a task after zeroing its old aggregate preserves the correction audit', async t => {
  const c = await fixture(t);
  await c.correct(0);
  c.tasksService.revokeTask(c.task);
  assert.ok(c.db.prepare('SELECT revoked_at FROM daily_tasks WHERE id = ?').get(c.task.id).revoked_at);
  assert.equal(c.service.details(c.id).legacy_corrections.length, 1);
});
