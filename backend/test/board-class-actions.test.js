const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const parent = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const child = (await parent('POST', '/api/children', { name: '看板孩子' })).json();
  const sibling = (await parent('POST', '/api/children', { name: '另一个孩子' })).json();
  const login = await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } });
  const asChild = (method, url, payload) => ctx.rawInject({ method, url, payload,
    headers: { authorization: `Bearer ${login.json().token}` } });
  const today = getTodayDate(), tomorrow = shiftDate(today, 1);
  const cls = (await parent('POST', '/api/outside-classes', {
    title: '看板钢琴', start_date: shiftDate(today, -7), days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_time: '16:00', end_time: '17:00', create_task: true
  })).json();
  const schedule = async (date = today, who = child, read = parent) => {
    const response = await read('GET', `/api/children/${who.id}/schedule?from=${date}`);
    assert.equal(response.statusCode, 200, response.body);
    return response.json()[0].outside;
  };
  const stats = async () => (await parent('GET', `/api/outside-classes/${cls.id}/stats?child_id=${child.id}`)).json();
  const attendance = body => parent('PUT', `/api/outside-classes/${cls.id}/attendance`, {
    child_id: child.id, lesson_date: today, ...body
  });
  const exception = body => parent('PUT', `/api/outside-classes/${cls.id}/exceptions`, {
    child_id: child.id, date: today, kind: 'leave', ...body
  });
  const move = { kind: 'moved', new_date: tomorrow, new_start_time: '09:00', new_end_time: '10:00' };
  return { ctx, parent, child, sibling, asChild, today, tomorrow, cls, schedule, stats, attendance, exception, move };
}

test('board schedule exposes original dates and null attendance without a confirmation', async t => {
  const { schedule, today, tomorrow, exception } = await fixture(t);
  for (const date of [today, tomorrow]) {
    const [lesson] = await schedule(date);
    assert.equal(lesson.source_date, date);
    assert.equal(lesson.attendance, null);
  }
  assert.equal((await exception({ expected_exception_id: null })).statusCode, 200);
  const [leave] = await schedule();
  assert.equal(leave.status, 'leave');
  assert.equal(leave.attendance, null, 'an exception is not an attendance confirmation');
});

test('board attendance status and revision match statistics and support optimistic writes', async t => {
  const { ctx, cls, child, sibling, schedule, today, attendance, stats } = await fixture(t);
  let expected_revision = null;
  for (const status of ['attended', 'absent', 'leave']) {
    assert.equal((await attendance({ status, expected_revision })).statusCode, 200);
    const [lesson] = await schedule();
    const detail = (await stats()).lessons.find(l => l.lesson_date === today);
    assert.deepEqual(lesson.attendance, {
      status: detail.status, charged: detail.charged, source: 'parent', revision: detail.revision
    });
    assert.equal(lesson.attendance.revision, ctx.app.services.classStatsService.revision(cls.id, child.id, 'attendance', today));
    assert.ok(lesson.attendance.revision);
    assert.notEqual(lesson.attendance.revision, expected_revision);
    assert.equal((await attendance({ status: 'absent', expected_revision })).statusCode, 409);
    expected_revision = lesson.attendance.revision;
    assert.equal((await schedule(today, sibling))[0].attendance, null);
  }
  assert.equal((await attendance({ status: 'pending', expected_revision })).statusCode, 200);
  assert.equal((await schedule())[0].attendance, null);
});

test('moved-in and moved-out lessons share original attendance while same-day lessons stay independent', async t => {
  const { child, sibling, schedule, today, tomorrow, attendance, exception, stats, move } = await fixture(t);
  // Tomorrow's original lesson is brought forward, alongside today's ordinary lesson.
  assert.equal((await exception({ ...move, date: tomorrow, new_date: today })).statusCode, 200);
  assert.equal((await attendance({ lesson_date: tomorrow, status: 'attended', expected_revision: null })).statusCode, 200);
  const lessons = await schedule();
  const moved = lessons.find(l => l.status === 'moved_in');
  const regular = lessons.find(l => l.status === 'scheduled');
  assert.equal(moved.moved_from, tomorrow);
  assert.equal(moved.source_date, tomorrow);
  assert.equal(regular.source_date, today);
  assert.equal(regular.attendance, null);
  const detail = (await stats()).lessons.find(l => l.lesson_date === tomorrow);
  assert.equal(detail.actual_date, today);
  assert.deepEqual(moved.attendance, { status: 'attended', charged: true, source: 'parent', revision: detail.revision });
  const [out] = await schedule(tomorrow);
  assert.equal(out.status, 'moved_out');
  assert.equal(out.source_date, tomorrow);
  assert.deepEqual(out.attendance, moved.attendance);
  assert.equal((await schedule(today, sibling)).length, 1);
  assert.equal((await schedule(today, child))[0].attendance.status, 'attended');
});

test('children read task-sourced attendance and revisions but cannot write attendance or exceptions', async t => {
  const { parent, asChild, child, sibling, cls, today, schedule, stats } = await fixture(t);
  const task = (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(r => r.class_id === cls.id);
  assert.equal((await asChild('POST', `/api/daily-tasks/${task.id}/complete`)).statusCode, 200);
  const [lesson] = await schedule(today, child, asChild);
  const detail = (await stats()).lessons.find(l => l.lesson_date === today);
  assert.equal(lesson.source_date, today);
  assert.deepEqual(lesson.attendance, { status: 'attended', charged: true, source: 'task', revision: detail.revision });
  assert.deepEqual(lesson, (await schedule())[0]);
  const leave = (await parent('PUT', `/api/outside-classes/${cls.id}/exceptions`, {
    child_id: sibling.id, date: today, kind: 'leave'
  })).json().exceptions[0];
  for (const [method, url, payload] of [
    ['PUT', `/api/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: today, status: 'absent', expected_revision: detail.revision }],
    ['PUT', `/api/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: today, kind: 'leave', expected_exception_id: null }],
    ['DELETE', `/api/outside-class-exceptions/${leave.id}`],
    ['GET', `/api/children/${sibling.id}/schedule?from=${today}`]
  ]) assert.equal((await asChild(method, url, payload)).statusCode, 403);
  assert.deepEqual((await schedule())[0].attendance, lesson.attendance);
  assert.equal((await asChild('POST', `/api/daily-tasks/${task.id}/uncomplete`)).statusCode, 200);
  assert.equal((await schedule(today, child, asChild))[0].attendance, null);
});

test('expected_exception_id null creates once and rejects replacing an existing exception without side effects', async t => {
  const { ctx, exception, schedule, move } = await fixture(t);
  const first = await exception({ expected_exception_id: null });
  assert.equal(first.statusCode, 200, first.body);
  const before = await schedule();
  const snapshot = () => ctx.db.prepare('SELECT * FROM outside_class_exceptions').all();
  const rows = snapshot();
  const stale = await exception({ ...move, expected_exception_id: null });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.deepEqual(stale.json(), { error: '这节课的请假或调课刚被修改过，请刷新后再操作' });
  assert.deepEqual(snapshot(), rows);
  assert.deepEqual(await schedule(), before);
});

test('matching exception IDs allow updates; omitted IDs preserve legacy replacement and undo behavior', async t => {
  const { exception, move, parent, schedule } = await fixture(t);
  const first = (await exception({ expected_exception_id: null })).json().exceptions[0];
  const changed = await exception({ ...move, expected_exception_id: first.id });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().exceptions[0].kind, 'moved');
  assert.equal((await exception({ note: '旧版管理页' })).statusCode, 200);
  assert.equal((await schedule())[0].status, 'leave');
  assert.equal((await parent('DELETE', `/api/outside-class-exceptions/${first.id}`)).statusCode, 200);
  assert.equal((await schedule())[0].status, 'scheduled');
  assert.equal((await exception({ expected_exception_id: null })).statusCode, 200);
  assert.equal((await exception({ ...move })).statusCode, 200);
});

test('mismatched exception IDs reject both missing and existing records and cannot affect another child', async t => {
  const { child, sibling, cls, today, exception, schedule } = await fixture(t);
  assert.equal((await exception({ expected_exception_id: 'stale-id' })).statusCode, 409);
  assert.equal((await schedule())[0].exception_id, null);
  const other = (await exception({ child_id: sibling.id })).json().exceptions.find(e => e.child_id === sibling.id);
  assert.equal((await exception({ child_id: child.id, expected_exception_id: other.id })).statusCode, 409);
  const first = (await exception({ expected_exception_id: null })).json().exceptions.find(e => e.child_id === child.id);
  assert.equal((await exception({ expected_exception_id: 'stale-id', note: '不应写入' })).statusCode, 409);
  assert.equal((await schedule())[0].exception_id, first.id);
  assert.equal((await schedule())[0].exception_note, null);
  assert.equal((await schedule(today, sibling))[0].exception_id, other.id);
  assert.equal((await schedule())[0].class_id, cls.id);
});

test('confirmed attendance still blocks leave and moves; future actual dates cannot be confirmed', async t => {
  const { attendance, exception, tomorrow, move } = await fixture(t);
  assert.equal((await attendance({ lesson_date: tomorrow, status: 'attended' })).statusCode, 400);
  assert.equal((await attendance({ lesson_date: tomorrow, status: 'absent' })).statusCode, 400);
  for (const status of ['attended', 'absent', 'leave']) {
    assert.equal((await attendance({ status })).statusCode, 200);
    for (const body of [{}, move]) {
      const response = await exception(body);
      assert.equal(response.statusCode, 409, response.body);
      assert.match(response.json().error, /已确认出勤/);
    }
    assert.equal((await attendance({ status: 'pending' })).statusCode, 200);
  }
  assert.equal((await exception({ ...move, expected_exception_id: null })).statusCode, 200);
  assert.equal((await attendance({ status: 'attended' })).statusCode, 400, 'the actual date, rather than the original date, controls confirmation');
});
