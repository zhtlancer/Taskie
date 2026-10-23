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
    assert.equal(lesson.attendance_revision, null);
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
    assert.equal(lesson.attendance_revision, detail.revision);
    assert.notEqual(lesson.attendance.revision, expected_revision);
    assert.equal((await attendance({ status: 'absent', expected_revision })).statusCode, 409);
    expected_revision = lesson.attendance.revision;
    assert.equal((await schedule(today, sibling))[0].attendance, null);
  }
  assert.equal((await attendance({ status: 'pending', expected_revision })).statusCode, 200);
  const [undone] = await schedule();
  assert.equal(undone.attendance, null);
  assert.ok(undone.attendance_revision, 'undo retains its new revision');
  assert.notEqual(undone.attendance_revision, expected_revision);
  assert.equal(undone.attendance_revision, (await stats()).lessons.find(l => l.lesson_date === today).revision);
  assert.equal((await attendance({ status: 'attended', expected_revision: null })).statusCode, 409);
  assert.equal((await attendance({ status: 'attended', expected_revision: undone.attendance_revision })).statusCode, 200);
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
  assert.equal(moved.attendance_revision, detail.revision);
  assert.equal(out.attendance_revision, moved.attendance_revision);
  assert.equal(regular.attendance_revision, null);
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
  assert.equal(lesson.attendance_revision, detail.revision);
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
  const [undone] = await schedule(today, child, asChild);
  assert.equal(undone.attendance, null);
  assert.ok(undone.attendance_revision);
  assert.notEqual(undone.attendance_revision, detail.revision);
  assert.equal(undone.attendance_revision, (await stats()).lessons.find(l => l.lesson_date === today).revision);
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
  assert.notEqual(changed.json().exceptions[0].id, first.id);
  const legacy = await exception({ note: '旧版管理页' });
  assert.equal(legacy.statusCode, 200);
  const current = legacy.json().exceptions[0];
  assert.notEqual(current.id, changed.json().exceptions[0].id);
  assert.equal((await schedule())[0].status, 'leave');
  assert.equal((await parent('DELETE', `/api/outside-class-exceptions/${current.id}`)).statusCode, 200);
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

function snapshot(db) {
  return ['outside_class_exceptions', 'daily_tasks', 'outside_class_attendance', 'outside_class_revisions', 'outside_class_changes']
    .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
}

test('an old exception ID cannot overwrite an updated lesson and rejection has no side effects', async t => {
  const { ctx, exception, move, schedule, parent, child } = await fixture(t);
  await parent('GET', `/api/daily-tasks?child_id=${child.id}`);
  const first = (await exception({ expected_exception_id: null })).json().exceptions[0];
  assert.equal((await exception({ ...move, expected_exception_id: first.id })).statusCode, 200);
  const before = snapshot(ctx.db), lessons = await schedule();
  const stale = await exception({ expected_exception_id: first.id, note: '旧页面修改' });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.deepEqual(stale.json(), { error: '这节课的请假或调课刚被修改过，请刷新后再操作' });
  assert.deepEqual(snapshot(ctx.db), before);
  assert.deepEqual(await schedule(), lessons);
});

test('an old or already deleted exception ID cannot undo a newer arrangement', async t => {
  const { ctx, exception, move, schedule, parent } = await fixture(t);
  const first = (await exception({ expected_exception_id: null })).json().exceptions[0];
  const changed = (await exception({ ...move, expected_exception_id: first.id })).json().exceptions[0];
  const before = snapshot(ctx.db), lessons = await schedule();
  const stale = await parent('DELETE', `/api/outside-class-exceptions/${first.id}`);
  assert.equal(stale.statusCode, 404, stale.body);
  assert.deepEqual(stale.json(), { error: '这节课的请假或调课已被修改或撤销，请刷新后再操作' });
  assert.deepEqual(snapshot(ctx.db), before);
  assert.deepEqual(await schedule(), lessons);
  assert.equal((await parent('DELETE', `/api/outside-class-exceptions/${changed.id}`)).statusCode, 200);
  const deleted = snapshot(ctx.db);
  const repeated = await parent('DELETE', `/api/outside-class-exceptions/${changed.id}`);
  assert.equal(repeated.statusCode, 404);
  assert.deepEqual(repeated.json(), stale.json());
  assert.deepEqual(snapshot(ctx.db), deleted);
});

test('every exception write, including identical and legacy writes, returns a fresh usable ID', async t => {
  const { exception, move, parent } = await fixture(t);
  const seen = new Set();
  let expected_exception_id = null;
  for (const body of [{}, {}, move, {}, { note: '旧版覆盖', expected_exception_id: undefined }]) {
    const response = await exception({ expected_exception_id, ...body });
    assert.equal(response.statusCode, 200, response.body);
    const current = response.json().exceptions[0];
    assert.ok(current.id);
    assert.equal(seen.has(current.id), false);
    seen.add(current.id);
    expected_exception_id = current.id;
  }
  assert.equal((await parent('DELETE', `/api/outside-class-exceptions/${expected_exception_id}`)).statusCode, 200);
});

test('concurrent exception creates and updates admit exactly one writer per expected ID', async t => {
  const { exception, schedule } = await fixture(t);
  let expected_exception_id = null;
  for (let round = 0; round < 3; round++) {
    const responses = await Promise.all(['设备甲', '设备乙'].map(note => exception({ expected_exception_id, note })));
    assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
    const winner = responses.find(r => r.statusCode === 200).json().exceptions[0];
    assert.notEqual(winner.id, expected_exception_id);
    assert.equal((await schedule())[0].exception_id, winner.id);
    assert.equal((await schedule())[0].exception_note, winner.note);
    expected_exception_id = winner.id;
  }
});

test('concurrent exception update and undo cannot both succeed for the same ID', async t => {
  const { exception, parent, schedule, move } = await fixture(t);
  for (const updateFirst of [true, false]) {
    const first = (await exception({})).json().exceptions[0];
    const update = () => exception({ ...move, expected_exception_id: first.id });
    const undo = () => parent('DELETE', `/api/outside-class-exceptions/${first.id}`);
    const responses = await Promise.all((updateFirst ? [update, undo] : [undo, update]).map(run => run()));
    assert.equal(responses.filter(r => r.statusCode === 200).length, 1);
    const changed = responses[updateFirst ? 0 : 1];
    if (changed.statusCode === 200) {
      assert.equal(responses[updateFirst ? 1 : 0].statusCode, 404);
      assert.equal((await schedule())[0].exception_id, changed.json().exceptions[0].id);
    } else {
      assert.equal(changed.statusCode, 409);
      assert.equal((await schedule())[0].exception_id, null);
    }
  }
});

test('task check-ins, parent corrections and repeated undo keep schedule revisions equal to statistics', async t => {
  const { asChild, child, cls, today, schedule, stats, attendance } = await fixture(t);
  const task = (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(r => r.class_id === cls.id);
  let revision = null;
  const check = async (status, changed = true) => {
    const [lesson] = await schedule(today, child, asChild);
    const detail = (await stats()).lessons.find(l => l.lesson_date === today);
    assert.ok(lesson.attendance_revision);
    assert.equal(lesson.attendance_revision, detail.revision);
    if (changed) assert.notEqual(lesson.attendance_revision, revision);
    else assert.equal(lesson.attendance_revision, revision);
    assert.equal(lesson.attendance?.status ?? null, status);
    revision = lesson.attendance_revision;
  };
  assert.equal((await asChild('POST', `/api/daily-tasks/${task.id}/complete`)).statusCode, 200);
  await check('attended');
  assert.equal((await attendance({ status: 'absent', expected_revision: revision })).statusCode, 200);
  await check('absent');
  assert.equal((await asChild('POST', `/api/daily-tasks/${task.id}/uncomplete`)).statusCode, 200);
  await check('absent', false);
  for (let i = 0; i < 2; i++) {
    assert.equal((await attendance({ status: 'pending', expected_revision: revision })).statusCode, 200);
    await check(null);
  }
});
