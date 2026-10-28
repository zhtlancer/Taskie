const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { SCHEMA_VERSION } = require('../src/db');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../src/utils/date');

async function fixture(t, options = {}) {
  const c = createTestApp(); t.after(() => cleanupTestApp(c)); await c.app.ready();
  const { childrenService, scheduleService, homeworkService, tasksService, classStatsService } = c.app.services;
  const child = childrenService.createChild({ name: '自动作业孩子' });
  const other = childrenService.createChild({ name: '另一个孩子' });
  const today = getTodayDate(), day = n => shiftDate(today, n);
  const cls = scheduleService.createClass({ title: '钢琴课', start_date: today, days_of_week: [getDayOfWeek(today)],
    start_time: '16:00', end_time: '17:00', total_lessons: 5, auto_homework: true, ...options });
  const call = (method, url, payload) => c.app.inject({ method, url, payload });
  const attendance = (date = today, status = 'attended', who = child) => call('PUT', `/api/outside-classes/${cls.id}/attendance`, { child_id: who.id, lesson_date: date, status });
  const list = (who = child) => homeworkService.list(who.id);
  const childHeaders = who => ({ authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: who.id, epoch: c.app.sessionEpoch() })}` });
  return { c, child, other, cls, today, day, scheduleService, homeworkService, tasksService, classStatsService, call, attendance, list, childHeaders };
}

test('opt-in is independent of check-ins; manual attendance creates a normal homework and task with course defaults', async t => {
  const f = await fixture(t, { auto_homework: false });
  const { c, child, other, cls, today, day, call, attendance, list, scheduleService, homeworkService } = f;
  assert.equal(scheduleService.getClass(cls.id).auto_homework, false);
  await attendance(); assert.equal(list().length, 0);
  await call('PUT', `/api/outside-classes/${cls.id}`, { auto_homework: true });
  assert.equal(list().length, 0, 'enabling never scans or generates past attendance');
  homeworkService.setCoursePoints(`class:${cls.id}`, 17);
  // Re-saving attendance confirmed before opting in (a charge or note edit) is not a new confirmation.
  const resaved = await call('PUT', `/api/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: today, status: 'attended', charged: false, note: '只改消课' });
  assert.equal(resaved.statusCode, 200, resaved.body);
  assert.equal(resaved.json().auto_homework, null);
  assert.equal(list().length, 0, 'editing an attended lesson never backfills homework');
  await attendance(today, 'pending');
  const result = await attendance();
  assert.equal(result.statusCode, 200, result.body);
  assert.equal(result.json().auto_homework.created, true);
  assert.equal(scheduleService.getClass(cls.id).create_task, false, 'attendance works without check-in tasks');
  const [record] = list();
  assert.equal(record.content, `${Number(today.slice(5, 7))}月${Number(today.slice(8))}日“钢琴课”作业`);
  assert.deepEqual([record.assigned_date, record.due_date, record.auto_lesson_date, record.points, record.priority], [today, day(7), today, 17, 1]);
  const task = c.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(record.daily_task_id);
  assert.deepEqual([task.date, task.due_date, task.points, task.track_time, task.is_course_homework], [today, day(7), 17, 0, 1]);
  assert.equal(list(other).length, 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM point_logs').get().n, 0, 'creating homework awards no points');
  assert.equal((await call('GET', `/api/children/${child.id}/schedule?from=${today}&to=${today}`)).json()[0].outside[0].homework.record_id, record.id);
  const details = (await call('GET', `/api/outside-classes/${cls.id}/stats?child_id=${child.id}`)).json();
  assert.equal(details.lessons.find(l => l.lesson_date === today).homework.record_id, record.id);
});

test('check-in completion is authorized for the child, idempotent across both entry points, undo and deletion', async t => {
  const { c, child, other, cls, today, call, attendance, list, tasksService, homeworkService, childHeaders } = await fixture(t, { create_task: true });
  const task = tasksService.getDailyTasks(child.id).find(row => row.class_id === cls.id);
  const complete = () => c.rawInject({ method: 'POST', url: `/api/daily-tasks/${task.id}/complete`, headers: childHeaders(child) });
  const response = await complete(); assert.equal(response.statusCode, 200, response.body);
  const original = list()[0]; assert.equal(response.json().auto_homework.record_id, original.id);
  await complete(); await attendance(); assert.equal(list().length, 1);
  homeworkService.update(original.id, { content: '家长写好的实际作业', expected_version: original.edit_version }, 'parent');
  c.app.services.homeworkStudyService.manual(original.id, { request_id: 'auto_class_study', date: today, duration_seconds: 180 }, 'parent');
  const sessions = c.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(original.daily_task_id);
  await call('POST', `/api/daily-tasks/${task.id}/uncomplete`); await complete();
  assert.equal(list()[0].content, '家长写好的实际作业');
  assert.deepEqual(c.db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(original.daily_task_id), sessions);
  await attendance(today, 'pending'); await attendance();
  assert.equal(list().length, 1);
  homeworkService.delete(original.id, { delete_task: true }, 'parent');
  const again = await attendance(); assert.equal(again.json().auto_homework.state, 'deleted');
  assert.equal(list().length, 0);
  assert.equal(c.db.prepare('SELECT homework_id FROM outside_class_homework WHERE child_id = ?').get(child.id).homework_id, null);
  assert.equal((await c.rawInject({ method: 'PUT', url: `/api/outside-classes/${cls.id}`, headers: childHeaders(child), payload: { auto_homework: true } })).statusCode, 403);
  assert.equal((await c.rawInject({ method: 'PUT', url: `/api/outside-classes/${cls.id}/attendance`, headers: childHeaders(child), payload: { child_id: child.id, lesson_date: today, status: 'attended' } })).statusCode, 403);
  assert.equal((await c.rawInject({ method: 'POST', url: `/api/daily-tasks/${task.id}/complete`, headers: childHeaders(other) })).statusCode, 403);
});

test('check-ins only generate on a new attended transition and still report existing homework receipts', async t => {
  await t.test('enabling after parent confirmation does not backfill on check-in; a new confirmation can generate', async t => {
    const { c, child, cls, today, attendance, list, tasksService, call, childHeaders } = await fixture(t, { create_task: true, auto_homework: false });
    const task = tasksService.getDailyTasks(child.id).find(row => row.class_id === cls.id);
    const complete = () => c.rawInject({ method: 'POST', url: `/api/daily-tasks/${task.id}/complete`, headers: childHeaders(child) });
    assert.equal((await attendance()).statusCode, 200);
    assert.equal((await call('PUT', `/api/outside-classes/${cls.id}`, { auto_homework: true })).statusCode, 200);
    const late = await complete();
    assert.equal(late.statusCode, 200, late.body);
    assert.equal(late.json().auto_homework, null, 'an already-attended lesson must not generate on a later check-in');
    assert.equal(list().length, 0);
    assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_homework').get().n, 0);
    const saved = c.db.prepare('SELECT status, source FROM outside_class_attendance WHERE class_id = ? AND child_id = ? AND lesson_date = ?').get(cls.id, child.id, today);
    assert.deepEqual(saved, { status: 'attended', source: 'parent' });
    assert.equal((await call('POST', `/api/daily-tasks/${task.id}/uncomplete`)).statusCode, 200);
    assert.equal((await attendance(today, 'pending')).statusCode, 200);
    const fresh = await complete();
    assert.equal(fresh.statusCode, 200, fresh.body);
    assert.equal(fresh.json().auto_homework.created, true);
    assert.equal(list().length, 1, 'a genuine new attended transition still generates exactly once');
  });
  await t.test('a later check-in reports the existing or deleted homework without recreating it', async t => {
    const { c, child, cls, attendance, list, tasksService, homeworkService, call, childHeaders } = await fixture(t, { create_task: true });
    const task = tasksService.getDailyTasks(child.id).find(row => row.class_id === cls.id);
    const complete = () => c.rawInject({ method: 'POST', url: `/api/daily-tasks/${task.id}/complete`, headers: childHeaders(child) });
    assert.equal((await attendance()).statusCode, 200);
    const original = list()[0];
    const existing = await complete();
    assert.equal(existing.statusCode, 200, existing.body);
    assert.equal(existing.json().auto_homework.record_id, original.id);
    assert.equal(existing.json().auto_homework.created, false);
    assert.equal(list().length, 1);
    assert.equal((await call('POST', `/api/daily-tasks/${task.id}/uncomplete`)).statusCode, 200);
    homeworkService.delete(original.id, { delete_task: true }, 'parent');
    const deleted = await complete();
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.equal(deleted.json().auto_homework.state, 'deleted');
    assert.equal(list().length, 0);
    assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_homework').get().n, 1);
  });
});

test('next actual lesson considers each child’s leave and moves; later timetable edits never overwrite homework', async t => {
  const { c, child, other, cls, day, attendance, list, scheduleService } = await fixture(t);
  scheduleService.setException(cls.id, { child_id: child.id, date: day(7), kind: 'leave' });
  scheduleService.setException(cls.id, { child_id: child.id, date: day(14), kind: 'moved', new_date: day(13), new_start_time: '10:00', new_end_time: '11:00' });
  await attendance(); await attendance(undefined, undefined, other);
  assert.equal(list()[0].due_date, day(13)); assert.equal(list(other)[0].due_date, day(7));
  scheduleService.setException(cls.id, { child_id: child.id, date: day(14), kind: 'moved', new_date: day(12), new_start_time: '10:00', new_end_time: '11:00' });
  await attendance(); assert.equal(list()[0].due_date, day(13));
  scheduleService.updateClass(cls.id, { auto_homework: false });
  assert.equal(list().length, 1); assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_homework').get().n, 2);
});

test('moved lesson uses its actual date and original identity, including a second lesson later the same day', async t => {
  const { child, cls, today, day, attendance, list, scheduleService } = await fixture(t, { start_date: shiftDate(getTodayDate(), -7) });
  scheduleService.setException(cls.id, { child_id: child.id, date: day(-7), kind: 'moved', new_date: today, new_start_time: '09:00', new_end_time: '10:00' });
  const response = await attendance(day(-7)); assert.equal(response.statusCode, 200, response.body);
  const [record] = list();
  assert.deepEqual([record.assigned_date, record.auto_lesson_date, record.auto_lesson_actual_date, record.due_date], [today, day(-7), today, today]);
  await attendance(day(-7), 'pending');
  scheduleService.setException(cls.id, { child_id: child.id, date: day(-7), kind: 'moved', new_date: today, new_start_time: '08:00', new_end_time: '09:00' });
  await attendance(day(-7)); assert.equal(list().length, 1); assert.equal(list()[0].id, record.id);
});

test('last lesson and expired historical homework are records only; a parent may add a deadline and task later', async t => {
  const { child, today, day, attendance, list, homeworkService, scheduleService, classStatsService } = await fixture(t, { total_lessons: 1 });
  await attendance(); const record = list()[0];
  assert.deepEqual([record.due_date, record.daily_task_id], [null, null]);
  homeworkService.update(record.id, { due_date: day(7), expected_version: record.edit_version }, 'parent');
  const task = homeworkService.createTask(record.id); assert.ok(task.daily_task_id);
  const old = scheduleService.createClass({ title: '旧课', days_of_week: [getDayOfWeek(today)], start_date: day(-21), total_lessons: 4,
    start_time: '16:00', end_time: '17:00', auto_homework: true, child_ids: [child.id] });
  // The next lesson after the backfilled one already passed, so do not burden today's board.
  classStatsService.setAttendance(old.id, child.id, day(-21), { status: 'attended' });
  const historical = list().find(r => r.class_id === old.id);
  assert.deepEqual([historical.assigned_date, historical.due_date, historical.daily_task_id], [day(-21), day(-14), null]);
});

test('parent leave/absence override check-ins; invalid settings, future dates and stale generations cannot generate', async t => {
  const { c, child, cls, today, day, attendance, list, tasksService, call } = await fixture(t, { create_task: true });
  await attendance(today, 'absent');
  const task = tasksService.getDailyTasks(child.id).find(r => r.class_id === cls.id);
  const done = await call('POST', `/api/daily-tasks/${task.id}/complete`); assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().auto_homework, null); assert.equal(list().length, 0);
  await attendance(today, 'leave'); assert.equal(list().length, 0);
  assert.equal((await attendance(day(7))).statusCode, 400);
  for (const value of [1, 'true', {}, []]) assert.equal((await call('PUT', `/api/outside-classes/${cls.id}`, { auto_homework: value })).statusCode, 400);
  const stale = await c.app.inject({ method: 'PUT', url: `/api/outside-classes/${cls.id}/attendance`,
    headers: { 'x-taskie-data-generation': 'before-restore' }, payload: { child_id: child.id, lesson_date: today, status: 'attended' } });
  assert.equal(stale.statusCode, 409); assert.equal(list().length, 0);
});

test('deleting a class preserves its homework, provenance, task and saved study sessions', async t => {
  const { c, child, cls, today, attendance, list, scheduleService } = await fixture(t);
  await attendance(); const record = list()[0];
  c.app.services.homeworkStudyService.manual(record.id, { request_id: 'retained_auto_class_study', date: today, duration_seconds: 180 }, 'parent');
  const before = c.app.services.homeworkStudyService.details(record.id);
  scheduleService.deleteClass(cls.id);
  const retained = list()[0];
  assert.deepEqual([retained.id, retained.class_id, retained.auto_lesson_date, retained.daily_task_id], [record.id, null, today, record.daily_task_id]);
  assert.equal(c.db.prepare('SELECT class_id FROM outside_class_homework WHERE child_id = ?').get(child.id).class_id, cls.id);
  assert.equal(c.app.services.homeworkStudyService.details(record.id).total_seconds, before.total_seconds);
  assert.deepEqual(c.db.pragma('foreign_key_check'), []);
});

test('generation failure rolls back attendance, task completion, points, homework and the receipt together', async t => {
  const { c, child, cls, today, attendance, tasksService, list, call } = await fixture(t, { create_task: true });
  c.db.exec("CREATE TRIGGER reject_auto_homework BEFORE INSERT ON outside_class_homework BEGIN SELECT RAISE(ABORT, 'fixture: fail receipt'); END");
  assert.equal((await attendance()).statusCode, 500);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_attendance').get().n, 0); assert.equal(list().length, 0);
  const task = tasksService.getDailyTasks(child.id).find(row => row.class_id === cls.id);
  assert.equal((await call('POST', `/api/daily-tasks/${task.id}/complete`)).statusCode, 500);
  assert.equal(c.db.prepare('SELECT is_completed FROM daily_tasks WHERE id = ?').get(task.id).is_completed, 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM point_logs').get().n, 0);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_attendance').get().n, 0); assert.equal(list().length, 0);
  c.db.exec('DROP TRIGGER reject_auto_homework');
  assert.equal((await attendance(today)).statusCode, 200); assert.equal(list().length, 1);
});

test('v33 backups upgrade disabled; current backups retain settings and deletion tombstones; incomplete v34 is rejected', async t => {
  const { c, child, cls, attendance, list, homeworkService } = await fixture(t);
  await attendance(); const original = list()[0];
  homeworkService.delete(original.id, { delete_task: true }, 'parent');
  const backup = c.app.backupService;
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  const rewrite = mutate => {
    const data = JSON.parse(gunzipSync(archive)); const candidate = new Database(Buffer.from(data.database, 'base64'));
    try { mutate(candidate); data.database = candidate.serialize().toString('base64'); return gzipSync(JSON.stringify(data)); } finally { candidate.close(); }
  };
  c.db.prepare('DELETE FROM outside_class_homework').run();
  c.app.services.scheduleService.updateClass(cls.id, { auto_homework: false });
  await backup.restore(archive);
  assert.equal(c.app.services.scheduleService.getClass(cls.id).auto_homework, true);
  assert.equal((await attendance()).json().auto_homework.state, 'deleted'); assert.equal(list().length, 0);
  for (const sql of ['DROP TABLE outside_class_homework', 'ALTER TABLE outside_classes DROP COLUMN auto_homework', 'ALTER TABLE outside_class_homework DROP COLUMN actual_date']) {
    await assert.rejects(() => backup.restore(rewrite(db => db.exec(sql))), /自动作业设置或生成凭据/);
    assert.equal(c.db.prepare('SELECT homework_id FROM outside_class_homework WHERE child_id = ?').get(child.id).homework_id, null);
  }
  await backup.restore(rewrite(db => { db.exec('DROP TABLE outside_class_homework; ALTER TABLE outside_classes DROP COLUMN auto_homework'); db.pragma('user_version = 33'); }));
  assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(c.app.services.scheduleService.getClass(cls.id).auto_homework, false);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_homework').get().n, 0);
  await attendance(); assert.equal(list().length, 0);
});
