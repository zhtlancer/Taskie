const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { getDb, initDb } = require('../src/db');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

const revisions = db => db.prepare('SELECT * FROM outside_class_revisions ORDER BY class_id, child_id, kind, lesson_date').all();
const records = db => ['outside_class_attendance', 'outside_class_fees', 'outside_class_changes']
  .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const request = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const child = (await request('POST', '/api/children', { name: '版本修复' })).json();
  const sibling = (await request('POST', '/api/children', { name: '保留版本' })).json();
  const today = getTodayDate(), yesterday = shiftDate(today, -1);
  const cls = (await request('POST', '/api/outside-classes', {
    title: '版本修复课', start_date: shiftDate(today, -3), days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_time: '16:00', end_time: '17:00', total_lessons: 10
  })).json();
  const attendance = body => request('PUT', `/api/outside-classes/${cls.id}/attendance`, {
    child_id: child.id, lesson_date: today, ...body
  });
  const fee = body => request('PUT', `/api/outside-classes/${cls.id}/fee`, { child_id: child.id, ...body });
  for (const who of [child, sibling]) {
    assert.equal((await attendance({ child_id: who.id, status: 'attended', note: '保留记录' })).statusCode, 200);
    assert.equal((await fee({ child_id: who.id, total_fee_cents: 12345 })).statusCode, 200);
  }
  // A revision with no attendance is an undo tombstone, and must also survive repair.
  assert.equal((await attendance({ lesson_date: yesterday, status: 'attended' })).statusCode, 200);
  assert.equal((await attendance({ lesson_date: yesterday, status: 'pending' })).statusCode, 200);
  const before = records(ctx.db);
  ctx.db.prepare(`DELETE FROM outside_class_revisions WHERE class_id = ? AND child_id = ?
    AND (kind = 'fee' OR lesson_date = ?)`).run(cls.id, child.id, today);
  const kept = revisions(ctx.db);
  const stats = async () => {
    const response = await request('GET', `/api/outside-classes/${cls.id}/stats?child_id=${child.id}`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json();
  };
  const schedule = async () => {
    const response = await request('GET', `/api/children/${child.id}/schedule?from=${today}`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json()[0].outside.find(row => row.class_id === cls.id);
  };
  const repaired = (db = ctx.db) => {
    const all = revisions(db);
    assert.equal(all.length, kept.length + 2, 'attendance and fee both gain a version');
    for (const row of kept) assert.deepEqual(all.find(r => r.class_id === row.class_id && r.child_id === row.child_id && r.kind === row.kind && r.lesson_date === row.lesson_date), row);
    assert.deepEqual(records(db), before, 'repair changes neither business records nor audit history');
    const target = all.filter(r => r.class_id === cls.id && r.child_id === child.id);
    const attendanceRevision = target.find(r => r.kind === 'attendance' && r.lesson_date === today)?.revision;
    const feeRevision = target.find(r => r.kind === 'fee')?.revision;
    assert.ok(attendanceRevision);
    assert.ok(feeRevision);
    return { attendanceRevision, feeRevision };
  };
  return { ctx, child, cls, today, attendance, fee, stats, schedule, repaired };
}

async function verifyReadsAndWrites(f) {
  const board = await f.schedule();
  assert.equal(board.attendance?.status, 'attended');
  const detail = await f.stats();
  const lesson = detail.lessons.find(row => row.lesson_date === f.today);
  const { attendanceRevision, feeRevision } = f.repaired();
  assert.equal(board.attendance_revision, attendanceRevision);
  assert.equal(board.attendance.revision, attendanceRevision);
  assert.equal(lesson.revision, attendanceRevision);
  assert.equal(detail.summary.fee_revision, feeRevision);
  assert.equal(detail.summary.total_fee_cents, 12345);
  assert.equal((await f.attendance({ status: 'absent', expected_revision: null })).statusCode, 409);
  assert.equal((await f.fee({ total_fee_cents: 1, expected_revision: null })).statusCode, 409);
  f.repaired();
  assert.equal((await f.attendance({ status: 'absent', expected_revision: attendanceRevision })).statusCode, 200);
  assert.equal((await f.fee({ total_fee_cents: 20000, expected_revision: feeRevision })).statusCode, 200);
}

test('reopening a current-schema database repairs missing revisions before any read and is idempotent', async t => {
  const f = await fixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-revision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'data.sqlite');
  fs.writeFileSync(file, f.ctx.db.serialize());
  let db = getDb(file);
  try {
    f.repaired(db);
    const once = revisions(db);
    initDb(db);
    assert.deepEqual(revisions(db), once);
    db.close();
    db = getDb(file);
    assert.deepEqual(revisions(db), once, 'a second startup preserves every generated version');
    // Use the restarted database's persisted state in the API fixture, without initializing it again.
    const archive = gzipSync(JSON.stringify({ format: 'taskie-backup', version: 2,
      database: db.serialize().toString('base64'), photo_manifest: [] }));
    await f.ctx.app.backupService.restore(archive);
    await verifyReadsAndWrites(f);
  } finally { db.close(); }
});

for (const version of [1, 2]) test(`restoring a v${version} backup repairs orphan attendance and fees before API reads`, async t => {
  const f = await fixture(t);
  const archive = gzipSync(JSON.stringify({ format: 'taskie-backup', version,
    database: f.ctx.db.serialize().toString('base64'), ...(version === 1 ? { photos: {} } : { photo_manifest: [] }) }));
  await f.ctx.app.backupService.restore(archive);
  f.repaired();
  const once = revisions(f.ctx.db);
  initDb(f.ctx.db);
  assert.deepEqual(revisions(f.ctx.db), once);
  await verifyReadsAndWrites(f);
});

test('schedule repairs missing revisions during runtime and agrees with subsequent statistics', async t => {
  await verifyReadsAndWrites(await fixture(t));
});

test('statistics repairs missing revisions before schedule reads and preserves them on repeated reads', async t => {
  const f = await fixture(t);
  const detail = await f.stats();
  assert.ok(detail.lessons.find(row => row.lesson_date === f.today).revision);
  assert.ok(detail.summary.fee_revision);
  const once = revisions(f.ctx.db);
  await f.stats();
  await f.schedule();
  assert.deepEqual(revisions(f.ctx.db), once);
  await verifyReadsAndWrites(f);
});

for (const kind of ['attendance', 'fee']) test(`a null ${kind} write cannot overwrite an orphan record even without a prior read`, async t => {
  const f = await fixture(t);
  const response = kind === 'attendance'
    ? await f.attendance({ status: 'pending', expected_revision: null })
    : await f.fee({ total_fee_cents: null, expected_revision: null });
  assert.equal(response.statusCode, 409, response.body);
  f.repaired();
  await verifyReadsAndWrites(f);
});
