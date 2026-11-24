const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-25', '08:00:00')) });
  const c = createTestApp(); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const s = c.app.services, today = getTodayDate(), day = n => shiftDate(today, n);
  const child = s.childrenService.createChild({ name: '课外课孩子' });
  const other = s.childrenService.createChild({ name: '另一位孩子' });
  const cls = s.scheduleService.createClass({ title: '钢琴', start_date: day(-4), days_of_week: [0,1,2,3,4,5,6],
    start_time: '16:00', end_time: '17:00', total_lessons: 10, child_ids: [child.id], auto_homework: true });
  c.db.prepare('UPDATE children SET created_at = ?').run(familyInstant(day(-10)));
  c.db.prepare('UPDATE outside_classes SET created_at = ?').run(familyInstant(day(-10)));
  c.db.prepare("UPDATE settings SET value = ? WHERE key = 'class_attendance_since'").run(day(-10));
  const read = async query => {
    const r = await c.app.inject({ method: 'GET', url: '/api/outside-classes/pending-attendance' + (query || '') });
    assert.equal(r.statusCode, 200, r.body); return r.json();
  };
  const save = (lesson, data = {}, headers) => c.app.inject({ method: 'PUT', url: `/api/outside-classes/${cls.id}/attendance`,
    payload: { child_id: child.id, lesson_date: lesson.lesson_date, status: 'attended', charged: true,
      expected_revision: lesson.revision, expected_lesson: { actual_date: lesson.actual_date, start_time: lesson.start_time, end_time: lesson.end_time }, ...data }, headers });
  return { ...c, ...s, today, day, child, other, cls, read, save };
}

test('homepage pending lessons include today, use moved dates and exclude confirmed or excused lessons', async t => {
  const c = await fixture(t);
  c.scheduleService.setException(c.cls.id, { child_id: c.child.id, date: c.day(-4), kind: 'moved', new_date: c.day(2), new_start_time: '16:00', new_end_time: '17:00' });
  c.scheduleService.setException(c.cls.id, { child_id: c.child.id, date: c.day(1), kind: 'moved', new_date: c.day(-1), new_start_time: '18:00', new_end_time: '19:00' });
  c.scheduleService.setException(c.cls.id, { child_id: c.child.id, date: c.day(-3), kind: 'leave' });
  c.classStatsService.setAttendance(c.cls.id, c.child.id, c.day(-2), { status: 'absent', charged: false });
  let pending = await c.read();
  assert.equal(pending.total, 3);
  assert.deepEqual(pending.items.map(row => [row.lesson_date, row.actual_date]), [[c.day(-1), c.day(-1)], [c.day(1), c.day(-1)], [c.today, c.today]]);
  assert.ok(pending.items.every(row => row.child_id === c.child.id));
  assert.equal(pending.items.at(-1).ended, false);
  assert.equal(pending.items.at(-1).child_name, c.child.name);
  assert.equal((await c.save(pending.items[0])).statusCode, 200);
  pending = await c.read();
  assert.equal(pending.total, 2);
  const leave = await c.save(pending.items[0], { status: 'leave', charged: false, note: '请假不扣课' });
  assert.equal(leave.statusCode, 200, leave.body);
  assert.equal((await c.read()).total, 1);
  const summary = c.classStatsService.list(c.child.id)[0];
  assert.equal(summary.charged_lessons, 1);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM point_logs').get().n, 0);
});

test('pending attendance respects tracking start, child assignment and bounded oldest-first results', async t => {
  const c = await fixture(t);
  c.db.prepare("UPDATE settings SET value = ? WHERE key = 'class_attendance_since'").run(c.day(-2));
  let pending = await c.read('?limit=2');
  assert.equal(pending.total, 3);
  assert.deepEqual(pending.items.map(row => row.lesson_date), [c.day(-2), c.day(-1)]);
  await c.save(pending.items[0]);
  pending = await c.read('?limit=2');
  assert.equal(pending.total, 2);
  assert.deepEqual(pending.items.map(row => row.lesson_date), [c.day(-1), c.today]);
  c.scheduleService.updateClass(c.cls.id, { child_ids: [c.other.id] });
  pending = await c.read();
  assert.ok(pending.items.every(row => row.child_id === c.other.id));
  for (const limit of ['0', '201', '1.5', 'bad']) {
    const r = await c.app.inject({ method: 'GET', url: `/api/outside-classes/pending-attendance?limit=${limit}` });
    assert.equal(r.statusCode, 400);
  }
});

test('pending confirmation rejects stale attendance, moved schedules and restored data without overwriting', async t => {
  const c = await fixture(t);
  const lesson = (await c.read()).items[0];
  let response = await c.save(lesson);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().auto_homework.state, 'record');
  assert.equal((await c.save(lesson, { status: 'leave' })).statusCode, 409);
  assert.equal(c.classStatsService.list(c.child.id)[0].charged_lessons, 1);
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM outside_class_homework').get().n, 1);
  const next = (await c.read()).items[0];
  c.scheduleService.setException(c.cls.id, { child_id: c.child.id, date: next.lesson_date, kind: 'moved', new_date: c.today,
    new_start_time: '10:00', new_end_time: '11:00' });
  response = await c.save(next);
  assert.equal(response.statusCode, 409, response.body);
  assert.match(response.json().error, /安排或出勤已变化/);
  const fresh = (await c.read()).items.find(row => row.lesson_date === next.lesson_date);
  assert.equal((await c.save(fresh, {}, { 'X-Taskie-Data-Generation': 'stale' })).statusCode, 409);
  assert.equal(c.classStatsService.list(c.child.id)[0].charged_lessons, 1);
});

test('only parents can read and process the shared pending attendance queue', async t => {
  const c = await fixture(t), lesson = (await c.read()).items[0];
  const headers = { authorization: `Bearer ${c.app.jwt.sign({ role: 'child', child_id: c.child.id, epoch: c.app.sessionEpoch() })}` };
  assert.equal((await c.rawInject({ method: 'GET', url: '/api/outside-classes/pending-attendance', headers })).statusCode, 403);
  assert.equal((await c.save(lesson, {}, headers)).statusCode, 403);
});
