const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { initDb } = require('../src/db');

async function fixture(t, course = false) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-20', '12:00:00')) });
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
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  await c.correct(600, 0);
  await backup.restore(archive);
  assert.equal(c.service.details(c.id).legacy_seconds, 0);
  assert.equal(c.service.details(c.id).legacy_corrections.length, 1);
  const packed = JSON.parse(gunzipSync(archive));
  const old = new Database(Buffer.from(packed.database, 'base64'));
  old.exec('DROP TABLE study_legacy_corrections');
  const pack = () => gzipSync(JSON.stringify({ ...packed, database: old.serialize().toString('base64') }));
  await assert.rejects(() => backup.restore(pack()), /旧累计更正记录/);
  assert.equal(c.service.details(c.id).legacy_corrections.length, 1);
  old.pragma('user_version = 23');
  await backup.restore(pack());
  old.close();
  assert.equal(c.db.pragma('user_version', { simple: true }), 30);
  assert.equal(c.service.details(c.id).legacy_seconds, 0);
  assert.deepEqual(c.service.details(c.id).legacy_corrections, []);
});

test('deleting a course record keeps corrected legacy statistics and cannot resurrect its mirrored old duration', async t => {
  const c = await fixture(t, true);
  c.db.prepare("UPDATE daily_tasks SET is_completed = 1, duration_seconds = 900, completed_at = ? WHERE id = ?").run(familyInstant('2026-10-20', '12:00:00'), c.task.id);
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
  c.db.prepare("UPDATE daily_tasks SET is_completed = 1, completed_at = ?, finish_on_actual_date = 0 WHERE id = ?").run(familyInstant('2026-10-21', '01:30:00'), c.task.id);
  c.db.exec('DROP TABLE study_legacy_corrections; ALTER TABLE daily_tasks DROP COLUMN finish_on_actual_date');
  c.db.pragma('user_version = 22');
  initDb(c.db);
  const finishes = () => c.timeStatsService.finishTimes(c.child.id, '2026-10-20', '2026-10-21');
  assert.deepEqual([...finishes()], [['2026-10-20', 25 * 60 + 30]]);
  const row = c.db.prepare('SELECT date, finish_on_actual_date FROM daily_tasks WHERE id = ?').get(c.task.id);
  assert.deepEqual(row, { date: '2026-10-20', finish_on_actual_date: 1 });
  c.homeworkService.delete(c.record.id, { delete_task: false }, 'parent');
  assert.deepEqual([...finishes()], [['2026-10-20', 1530]]);
  c.db.prepare("UPDATE daily_tasks SET completed_at = ? WHERE id = ?").run(familyInstant('2026-10-21', '19:06:00'), c.task.id);
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

test('a zeroed old aggregate of an ordinary task counts as missing time, not as 0 seconds learned', async t => {
  const c = await fixture(t);
  c.db.prepare("UPDATE daily_tasks SET is_completed = 1, completed_at = ?, expected_minutes = 20 WHERE id = ?").run(familyInstant('2026-10-20', '12:00:00'), c.task.id);
  const stats = () => c.timeStatsService.stats(c.child.id, '2026-10-20', '2026-10-20');
  assert.equal(stats().summary.recorded_seconds, 900);
  await c.correct(0);
  assert.deepEqual(stats().summary, { ...stats().summary, recorded_seconds: 0, missing: 1, sessions: 1 });
  assert.deepEqual(stats().tasks.map(task => [task.sessions, task.recorded, task.average_seconds]), [[1, 0, null]]);
  await c.correct(300, 0);
  assert.equal(stats().summary.recorded_seconds, 300);
  assert.equal(stats().summary.missing, 0);
  c.service.manual(c.id, { request_id: 'zeroed_with_session', duration_seconds: 120 }, 'parent');
  await c.correct(0, 300);
  assert.deepEqual([stats().summary.recorded_seconds, stats().summary.missing], [120, 0], 'real sessions still count once the old aggregate is zeroed');
});

// Course homework only counts study sessions, whether or not its task records time.
for (const trackTime of [0, 1]) {
  test(`zeroed course homework (track_time ${trackTime}) leaves statistics, also after deleting its record`, async t => {
    const c = await fixture(t, true);
    c.db.prepare('UPDATE daily_tasks SET track_time = ?, expected_minutes = 20 WHERE id = ?').run(trackTime, c.task.id);
    c.service.complete(c.id, 'parent');
    // v21 kept the old duration mirrored next to the legacy aggregate.
    c.db.prepare('UPDATE daily_tasks SET duration_seconds = 900 WHERE id = ?').run(c.task.id);
    const stats = () => c.timeStatsService.stats(c.child.id, '2026-10-20', '2026-10-20');
    const shape = () => [stats().summary.recorded_seconds, stats().summary.missing, stats().summary.sessions, stats().tasks.length];
    assert.deepEqual(shape(), [900, 0, 1, 1]);
    await c.correct(0);
    assert.deepEqual(shape(), [0, 0, 0, 0]);
    const before = stats();
    c.homeworkService.delete(c.record.id, { delete_task: false }, 'parent');
    const after = stats();
    assert.deepEqual([after.summary, after.days, after.subjects, after.tasks], [before.summary, before.days, before.subjects, before.tasks]);
    const url = `/api/daily-tasks/${c.task.id}/study/legacy`;
    assert.equal((await c.app.inject({ method: 'PUT', url, payload: { duration_seconds: 300, expected_old_seconds: 0, reason: '核实' } })).statusCode, 200);
    assert.deepEqual(shape(), [300, 0, 1, 1]);
  });
}

for (const completeFirst of [false, true]) {
  test(`course provenance survives zeroing, deletion and completion (complete first: ${completeFirst})`, async t => {
    const c = await fixture(t, true);
    c.db.prepare('UPDATE daily_tasks SET track_time = 1 WHERE id = ?').run(c.task.id);
    await c.correct(0);
    if (completeFirst) c.service.complete(c.id, 'parent');
    c.homeworkService.delete(c.record.id, { delete_task: false }, 'parent');
    if (!completeFirst) c.taskStudyService.complete(c.task.id, 'parent');
    const check = () => {
      const stats = c.timeStatsService.stats(c.child.id, '2026-10-20', '2026-10-20');
      assert.deepEqual([stats.summary.missing, stats.summary.sessions, stats.summary.recorded_seconds], [0, 0, 0]);
      assert.equal(c.db.prepare('SELECT is_course_homework FROM daily_tasks WHERE id = ?').get(c.task.id).is_course_homework, 1);
    };
    check();
    c.tasksService.uncompleteDailyTask(c.task.id);
    c.taskStudyService.complete(c.task.id, 'parent');
    check();
    assert.equal(c.rewardsService.getTotalPoints(c.child.id), 10);
  });
}

test('v25 migration backfills course provenance from records or completion evidence; backups preserve it', async t => {
  const c = await fixture(t, true);
  const previous = c.tasksService.createAdhocTask(c.child.id, { title: '已删除的作业', subject: '数学', track_time: true });
  c.db.prepare('UPDATE daily_tasks SET finish_on_actual_date = 1 WHERE id = ?').run(previous.id);
  const ordinary = c.tasksService.createAdhocTask(c.child.id, { title: '普通任务', subject: '数学', track_time: true });
  c.db.exec('ALTER TABLE daily_tasks DROP COLUMN is_course_homework');
  c.db.pragma('user_version = 24');
  initDb(c.db);
  const provenance = id => c.db.prepare('SELECT is_course_homework FROM daily_tasks WHERE id = ?').get(id).is_course_homework;
  assert.deepEqual([provenance(c.task.id), provenance(previous.id), provenance(ordinary.id)], [1, 1, 0]);
  c.homeworkService.delete(c.record.id, { delete_task: false }, 'parent');
  const backup = c.app.backupService;
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  c.db.prepare('UPDATE daily_tasks SET is_course_homework = 0').run();
  await backup.restore(archive);
  assert.equal(provenance(c.task.id), 1);
  const packed = JSON.parse(gunzipSync(archive));
  const candidate = new Database(Buffer.from(packed.database, 'base64'));
  candidate.exec('ALTER TABLE daily_tasks DROP COLUMN is_course_homework');
  const pack = () => gzipSync(JSON.stringify({ ...packed, database: candidate.serialize().toString('base64') }));
  await assert.rejects(() => backup.restore(pack()), /课程作业来源/);
  candidate.pragma('user_version = 24');
  await backup.restore(pack());
  candidate.close();
  assert.equal(c.db.pragma('user_version', { simple: true }), 30);
  assert.equal(provenance(previous.id), 1);
});
