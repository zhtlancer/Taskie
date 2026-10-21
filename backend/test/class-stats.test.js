const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');
const { initDb } = require('../src/db');

async function fixture(t, overrides = {}) {
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const parent = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const child = (await parent('POST', '/api/children', { name: '出勤孩子' })).json();
  const other = (await parent('POST', '/api/children', { name: '另一个孩子' })).json();
  const today = getTodayDate(), day = n => shiftDate(today, n);
  const cls = (await parent('POST', '/api/outside-classes', { title: '钢琴统计', start_date: day(-5), days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00', total_lessons: 12, ...overrides })).json();
  const service = ctx.app.services.classStatsService;
  service.now = () => ({ today, clock: '00:00' });
  const stats = async (who = child) => (await parent('GET', `/api/outside-classes/${cls.id}/stats?child_id=${who.id}`)).json();
  const attendance = (n, body, who = child) => parent('PUT', `/api/outside-classes/${cls.id}/attendance`, { child_id: who.id, lesson_date: day(n), ...body });
  const fee = amount => parent('PUT', `/api/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: amount });
  return { ctx, parent, child, other, cls, today, day, service, stats, attendance, fee };
}

test('attendance stays unknown until confirmed; moves, leave, fees and each child count independently', async t => {
  const { parent, ctx, cls, child, other, day, stats, attendance, fee } = await fixture(t);
  assert.deepEqual([(await stats()).summary.attended, (await stats()).summary.pending], [0, 5]);
  await parent('PUT', `/api/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: day(-4), kind: 'moved', new_date: day(8), new_start_time: '10:00', new_end_time: '11:30' });
  await parent('PUT', `/api/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: day(-3), kind: 'leave' });
  assert.equal((await attendance(-5, { status: 'attended' })).statusCode, 200);
  assert.equal((await attendance(-2, { status: 'absent', charged: true, note: '机构扣课' })).statusCode, 200);
  assert.equal((await fee(10001)).statusCode, 200);
  let { summary, lessons } = await stats();
  assert.deepEqual([summary.attended, summary.absent, summary.leave, summary.pending, summary.charged_lessons, summary.remaining_credits, summary.attendance_rate], [1, 1, 1, 1, 2, 10, 50]);
  assert.deepEqual([summary.attended_minutes, summary.consumed_cents, summary.remaining_cents, summary.estimated_end_date], [60, 1667, 8334, day(8)]);
  assert.equal(lessons.filter(l => l.lesson_date === day(-4)).length, 1);
  assert.deepEqual([lessons.find(l => l.lesson_date === day(-4)).actual_date, lessons.find(l => l.lesson_date === day(-4)).lesson_number], [day(8), 2]);
  assert.deepEqual([(await stats(other)).summary.attended, (await stats(other)).summary.total_fee_cents], [0, null]);
  await attendance(-5, { status: 'attended' });
  assert.equal((await stats()).summary.charged_lessons, 2, 'retry does not consume twice');
  assert.equal((await parent('PUT', `/api/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: day(-5), kind: 'leave' })).statusCode, 409);
  await attendance(-2, { status: 'absent', charged: false });
  assert.equal((await stats()).summary.consumed_cents, 833);
  await attendance(-5, { status: 'pending' });
  assert.equal((await stats()).summary.pending, 2);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM point_logs').get().n, 0, 'attendance never awards points');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks WHERE is_completed = 1').get().n, 0);
});

test('check-ins sync once, undo atomically, and never overwrite a parent attendance correction', async t => {
  const { ctx, parent, child, cls, attendance, stats } = await fixture(t, { start_date: getTodayDate(), create_task: true });
  const rows = (await parent('GET', `/api/daily-tasks?child_id=${child.id}`)).json();
  const task = rows.find(row => row.class_id === cls.id);
  const complete = () => parent('POST', `/api/daily-tasks/${task.id}/complete`);
  assert.equal((await complete()).statusCode, 200);
  await complete();
  assert.deepEqual([(await stats()).summary.attended, (await stats()).summary.charged_lessons, (await stats()).summary.attended_minutes], [1, 1, 60]);
  ctx.db.exec("CREATE TRIGGER fail_class_undo BEFORE DELETE ON point_logs BEGIN SELECT RAISE(ABORT, 'rollback'); END");
  assert.equal((await parent('POST', `/api/daily-tasks/${task.id}/uncomplete`)).statusCode, 500);
  assert.equal((await stats()).summary.attended, 1);
  ctx.db.exec('DROP TRIGGER fail_class_undo');
  assert.equal((await parent('POST', `/api/daily-tasks/${task.id}/uncomplete`)).statusCode, 200);
  assert.equal((await stats()).summary.attended, 0);
  await attendance(0, { status: 'absent', charged: false, note: '家长核实' });
  await complete();
  assert.deepEqual([(await stats()).summary.attended, (await stats()).summary.absent, (await stats()).summary.charged_lessons], [0, 1, 0]);
  await parent('POST', `/api/daily-tasks/${task.id}/uncomplete`);
  assert.equal((await stats()).summary.absent, 1, 'undo only removes attendance sourced from that check-in');
});

test('fee and attendance validation, child permissions, date-mode totals and retained history', async t => {
  const { parent, ctx, cls, child, other, day, attendance, stats, fee } = await fixture(t);
  for (const amount of [-1, 0.5, '100', 1000000001]) assert.equal((await fee(amount)).statusCode, 400);
  assert.equal((await fee(0)).json().total_fee_cents, 0);
  assert.equal((await fee(null)).json().total_fee_cents, null);
  for (const body of [{ status: 'wrong' }, { status: 'absent', charged: 1 }, { status: 'attended', note: 'x'.repeat(201) }]) assert.equal((await attendance(-1, body)).statusCode, 400);
  assert.equal((await attendance(1, { status: 'attended' })).statusCode, 400);
  assert.equal((await attendance(-6, { status: 'attended' })).statusCode, 400);
  await attendance(-1, { status: 'attended' });
  await parent('PUT', `/api/outside-classes/${cls.id}`, { total_lessons: null, end_date: day(10), child_ids: [other.id] });
  assert.equal((await stats()).summary.enrolled, false);
  assert.equal((await stats()).summary.attended, 1, 'assignment edits preserve confirmed history');
  await fee(12345);
  assert.equal((await stats()).summary.consumed_cents, null, 'no fee apportionment without a total lesson count');
  const token = ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() });
  for (const [method, path, payload] of [['GET', '/stats?child_id=' + child.id], ['PUT', '/fee', { child_id: child.id, total_fee_cents: 1 }], ['PUT', '/attendance', { child_id: child.id, lesson_date: day(-1), status: 'attended' }]]) {
    assert.equal((await ctx.rawInject({ method, url: `/api/outside-classes/${cls.id}${path}`, payload, headers: { authorization: `Bearer ${token}` } })).statusCode, 403);
  }
  assert.equal((await parent('GET', `/api/outside-classes/stats?child_id=${child.id}`)).json()[0].attended, 1);
  assert.equal((await parent('GET', `/api/outside-classes/${cls.id}/stats?child_id=${child.id}&from=${day(-100)}&to=${day(1)}`)).statusCode, 400);
});

test('attendance snapshots survive timetable edits; current leave suppresses a check-in and may be charged', async t => {
  const { parent, ctx, child, cls, attendance, stats, day } = await fixture(t, { create_task: true });
  await attendance(-2, { status: 'attended' });
  await parent('PUT', `/api/outside-classes/${cls.id}`, { start_time: '09:00', end_time: '09:30' });
  assert.equal((await stats()).summary.attended_minutes, 60);
  ctx.db.prepare('UPDATE outside_classes SET created_at = ? WHERE id = ?').run(`${day(-6)}T00:00:00Z`, cls.id);
  assert.equal((await attendance(0, { status: 'leave', charged: true })).statusCode, 200);
  assert.equal(ctx.app.services.scheduleService.outsideLessons(child.id)(getTodayDate())[0].status, 'leave');
  assert.equal(ctx.app.services.scheduleService.classTaskSchedule(child.id)(getTodayDate()).length, 0);
  assert.equal((await stats()).summary.charged_lessons, 2);
  assert.equal((await stats()).summary.leave, 1);
});

test('v28 imports only explicit old check-ins with unknown durations; attendance and fees survive backup restore', async t => {
  const { parent, ctx, child, cls, day, stats, attendance, fee } = await fixture(t);
  ctx.db.prepare(`INSERT INTO daily_tasks(id, child_id, title, subject, points, date, origin, class_id, class_lesson_date, is_completed, completed_at)
    VALUES ('old-checkin', ?, '旧打卡', '其他', 0, ?, 'class', ?, ?, 1, ?)`)
    .run(child.id, day(-2), cls.id, day(-2), new Date().toISOString());
  ctx.db.exec('DROP TABLE outside_class_attendance; DROP TABLE outside_class_fees');
  ctx.db.pragma('user_version = 27'); initDb(ctx.db);
  let { summary } = await stats();
  assert.deepEqual([summary.attended, summary.attended_minutes, summary.unknown_duration_lessons, summary.pending], [1, 0, 1, 4]);
  await attendance(-1, { status: 'absent', charged: true }); await fee(12000);
  const backup = ctx.app.backupService;
  const archive = fs.readFileSync(backup.getPath(backup.create().name));
  await attendance(-1, { status: 'pending' }); await fee(null);
  backup.restore(archive);
  summary = (await stats()).summary;
  assert.deepEqual([summary.attended, summary.absent, summary.total_fee_cents, summary.charged_lessons], [1, 1, 12000, 2]);
  const packed = JSON.parse(gunzipSync(archive));
  const candidate = new Database(Buffer.from(packed.database, 'base64'));
  try {
    candidate.exec('DROP TABLE outside_class_fees');
    const pack = () => gzipSync(JSON.stringify({ ...packed, database: candidate.serialize().toString('base64') }));
    assert.throws(() => backup.restore(pack()), /出勤或学费/);
    candidate.exec('DROP TABLE outside_class_attendance'); candidate.pragma('user_version = 27');
    backup.restore(pack());
    summary = (await stats()).summary;
    assert.deepEqual([summary.attended, summary.absent, summary.total_fee_cents, summary.unknown_duration_lessons], [1, 0, null, 1]);
    assert.equal(ctx.db.pragma('user_version', { simple: true }), 28);
  } finally { candidate.close(); }
});

test('next lesson skips consecutive leave, and an unlimited old course uses bounded detail ranges', async t => {
  const { parent, ctx, child, cls, day, stats } = await fixture(t, { start_date: '1900-01-01', total_lessons: null, end_date: null });
  for (let n = 0; n < 20; n++) await parent('PUT', `/api/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: day(n), kind: 'leave' });
  const { summary, lessons } = await stats();
  assert.equal(summary.next_lesson.actual_date, day(20));
  assert.ok(summary.pending > 40000);
  assert.ok(lessons.length <= 61);
  assert.equal(summary.attended, 0);
});

test('clearing a former student’s final history or fee succeeds without leaving phantom membership', async t => {
  const { parent, ctx, cls, child, other, attendance, stats, fee } = await fixture(t);
  await attendance(-1, { status: 'attended' });
  await parent('PUT', `/api/outside-classes/${cls.id}`, { child_ids: [other.id] });
  assert.deepEqual([(await stats()).summary.next_lesson, (await stats()).summary.pending], [null, 0]);
  const cleared = await attendance(-1, { status: 'pending' });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().available, false);
  assert.deepEqual((await parent('GET', `/api/outside-classes/stats?child_id=${child.id}`)).json(), []);
  await parent('PUT', `/api/outside-classes/${cls.id}`, { child_ids: null });
  await fee(5000);
  await parent('PUT', `/api/outside-classes/${cls.id}`, { child_ids: [other.id] });
  const removedFee = await fee(null);
  assert.equal(removedFee.statusCode, 200);
  assert.equal(removedFee.json().available, false);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM outside_class_fees').get().n, 0);
});

test('legacy duplicate check-ins consume once and undo retains any still-completed evidence', async t => {
  const { parent, ctx, child, cls, stats, today, service } = await fixture(t, { start_date: getTodayDate(), create_task: true });
  const task = (await parent('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(row => row.class_id === cls.id);
  await parent('POST', `/api/daily-tasks/${task.id}/complete`);
  ctx.db.prepare(`INSERT INTO daily_tasks(id, child_id, title, subject, points, date, origin, class_id, class_lesson_date, is_completed, completed_at)
    VALUES ('duplicate-class-checkin', ?, '重复旧打卡', '其他', 0, ?, 'class', ?, ?, 1, ?)`)
    .run(child.id, today, cls.id, today, new Date().toISOString());
  service.syncCheckin(ctx.db.prepare("SELECT * FROM daily_tasks WHERE id = 'duplicate-class-checkin'").get());
  assert.equal((await stats()).summary.attended, 1);
  assert.equal((await parent('POST', '/api/daily-tasks/duplicate-class-checkin/uncomplete')).statusCode, 200);
  assert.deepEqual([(await stats()).summary.attended, (await stats()).summary.charged_lessons], [1, 1]);
  await parent('POST', `/api/daily-tasks/${task.id}/uncomplete`);
  assert.equal((await stats()).summary.attended, 0);
});
