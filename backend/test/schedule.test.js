const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getDayOfWeek, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
  const child = await createChild('小明');
  const loginAs = async who => ({ authorization: `Bearer ${(await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: who.id } })).json().token}` });
  const headers = await loginAs(child);
  const asChild = (method, url, payload, h = headers) => ctx.rawInject({ method, url, headers: h, payload });
  const asParent = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const today = getTodayDate();
  const monday = getWeekRange(today).startDate;
  const day = n => shiftDate(monday, n); // n days after this week's Monday
  const schedule = async (from, to = from, who = child) => (await asParent('GET', `/api/children/${who.id}/schedule?from=${from}&to=${to}`)).json();
  return { ctx, child, createChild, loginAs, headers, asChild, asParent, today, monday, day, schedule };
}

// A small school day: two lessons around a break, plus lunch after them.
const slots = [
  { id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' },
  { id: 'b1', kind: 'break', label: '课间操', start_time: '08:40', end_time: '09:10' },
  { id: 's2', kind: 'class', label: '第2节', start_time: '09:10', end_time: '09:50' },
  { id: 'lunch', kind: 'break', label: '午休', start_time: '11:30', end_time: '13:30' },
  { id: 's3', kind: 'class', label: '第3节', start_time: '13:30', end_time: '14:10' }
];

test('a term timetable keeps its periods and lessons, with alternating weeks', async t => {
  const { child, asChild, asParent, today, monday, day, schedule } = await fixture(t);
  const create = payload => asParent('POST', `/api/children/${child.id}/timetables`, {
    name: '四年级上学期', start_date: shiftDate(today, -30), end_date: shiftDate(today, 90), slots, lessons: [], ...payload
  });
  const lessons = [
    { slot_id: 's1', weekday: 1, subject: '语文', teacher: '王老师', room: '402' },
    { slot_id: 's2', weekday: 1, week: 'A', subject: '美术', bring: '水彩笔' },
    { slot_id: 's2', weekday: 1, week: 'B', subject: '书法', bring: '毛笔' }
  ];
  for (const [payload, why] of [
    [{ lessons }, 'A/B lessons need alternating weeks'],
    [{ slots: [...slots, { id: 'x', kind: 'class', label: '第4节', start_time: '09:30', end_time: '10:10' }] }, 'overlapping periods'],
    [{ lessons: [{ slot_id: 'b1', weekday: 1, subject: '语文' }] }, 'a lesson in a break'],
    [{ ab_weeks: true, ab_anchor_date: monday, lessons: [...lessons, { slot_id: 's2', weekday: 1, subject: '音乐' }] }, 'a lesson every week where A and B ones are'],
    [{ slots: [] }, 'no periods'],
    [{ name: '' }, 'no name']
  ]) assert.equal((await create(payload)).statusCode, 400, why);

  const created = await create({ ab_weeks: true, ab_anchor_date: monday, lessons });
  assert.equal(created.statusCode, 201, created.body);
  const timetable = created.json();
  assert.deepEqual(timetable.slots.map(s => s.label), ['第1节', '课间操', '第2节', '午休', '第3节']);
  assert.equal(timetable.lessons.length, 3);
  assert.equal((await create({ name: '重叠的' })).statusCode, 409);

  // This week is an A week, next week a B week; lunch after the last lesson is not shown.
  const [thisMonday] = await schedule(day(0));
  assert.deepEqual([thisMonday.week, thisMonday.timetable_name], ['A', '四年级上学期']);
  assert.deepEqual(thisMonday.school.map(s => [s.label, s.subject ?? null]), [['第1节', '语文'], ['课间操', null], ['第2节', '美术']]);
  assert.deepEqual(thisMonday.bring, [{ for: '美术', items: '水彩笔' }]);
  const [nextMonday] = await schedule(day(7));
  assert.deepEqual([nextMonday.week, nextMonday.school.at(-1).subject], ['B', '书法']);
  assert.deepEqual((await schedule(day(1)))[0].school, []);

  // Saving again replaces the lessons.
  const updated = await asParent('PUT', `/api/timetables/${timetable.id}`, { ...timetable, ab_weeks: false, lessons: [{ slot_id: timetable.slots[4].id, weekday: 1, subject: '科学' }] });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.deepEqual((await schedule(day(0)))[0].school.map(s => s.subject), ['科学']);

  // Children see their timetables and days but cannot change them.
  assert.equal((await asChild('GET', `/api/children/${child.id}/timetables`)).statusCode, 200);
  assert.equal((await asChild('GET', `/api/children/${child.id}/schedule?from=${today}`)).statusCode, 200);
  assert.equal((await asChild('POST', `/api/children/${child.id}/timetables`, { name: 'x' })).statusCode, 403);
  assert.equal((await asChild('PUT', `/api/timetables/${timetable.id}`, {})).statusCode, 403);
  assert.equal((await asParent('GET', `/api/children/${child.id}/schedule?from=${today}&to=${shiftDate(today, 42)}`)).statusCode, 400);
});

test('holidays have no school lessons; outside classes go on', async t => {
  const { child, asParent, day, schedule } = await fixture(t);
  await asParent('POST', `/api/children/${child.id}/timetables`, {
    name: '本学期', start_date: day(-7), end_date: day(30), slots, lessons: [{ slot_id: 's1', weekday: 2, subject: '数学' }]
  });
  await asParent('POST', '/api/outside-classes', { title: '游泳', location: '体育馆', days_of_week: [2], start_time: '16:00', end_time: '17:00', start_date: day(-7), bring: '泳衣' });
  await asParent('POST', `/api/children/${child.id}/periods`, { name: '运动会', start_date: day(1), end_date: day(1) });
  const [tuesday] = await schedule(day(1));
  assert.deepEqual([tuesday.holiday, tuesday.school, tuesday.outside.map(l => l.title)], ['运动会', [], ['游泳']]);
  assert.deepEqual(tuesday.bring, [{ for: '游泳', items: '泳衣' }]);
});

test('outside classes are shared by children, with leave and moved lessons per child', async t => {
  const { child, createChild, loginAs, asChild, asParent, day, schedule } = await fixture(t);
  const sister = await createChild('小红');
  const outsider = await createChild('小刚');
  for (const payload of [{ title: '钢琴' }, { title: '钢琴', days_of_week: [3], start_time: '18:00', end_time: '17:00' }, { title: '', days_of_week: [3], start_time: '16:00', end_time: '17:00' }]) {
    assert.equal((await asParent('POST', '/api/outside-classes', payload)).statusCode, 400, JSON.stringify(payload));
  }
  const created = await asParent('POST', '/api/outside-classes', {
    title: '钢琴课', institution: '少年宫', location: '少年宫 3 楼', teacher: '李老师', days_of_week: [3],
    start_time: '16:30', end_time: '17:30', start_date: day(-7), child_ids: [child.id, sister.id]
  });
  assert.equal(created.statusCode, 201, created.body);
  const piano = created.json();
  assert.deepEqual(piano.child_ids, [child.id, sister.id]);

  const wednesday = day(2);
  const setException = payload => asParent('PUT', `/api/outside-classes/${piano.id}/exceptions`, { child_id: child.id, date: wednesday, ...payload });
  assert.equal((await setException({ kind: 'leave', date: day(1) })).statusCode, 400, 'no lesson that day');
  assert.equal((await setException({ kind: 'leave', child_id: outsider.id })).statusCode, 400, 'not in the class');
  assert.equal((await setException({ kind: 'moved', new_date: day(4) })).statusCode, 400, 'a move needs times');

  assert.equal((await setException({ kind: 'leave', note: '发烧' })).statusCode, 200);
  const [mine] = await schedule(wednesday);
  const [hers] = await schedule(wednesday, wednesday, sister);
  assert.deepEqual([mine.outside[0].status, mine.outside[0].exception_note, hers.outside[0].status], ['leave', '发烧', 'scheduled']);
  assert.deepEqual((await schedule(wednesday, wednesday, outsider))[0].outside, []);

  // Changing the leave into a move: off Wednesday, on Saturday morning.
  const moved = (await setException({ kind: 'moved', new_date: day(5), new_start_time: '09:00', new_end_time: '10:00' })).json();
  assert.equal(moved.exceptions.length, 1);
  const [wed, , , sat] = await schedule(wednesday, day(5));
  assert.deepEqual([wed.outside[0].status, wed.outside[0].moved_to], ['moved_out', { date: day(5), start_time: '09:00', end_time: '10:00' }]);
  assert.deepEqual([sat.outside[0].status, sat.outside[0].start_time, sat.outside[0].moved_from, sat.outside[0].location], ['moved_in', '09:00', wednesday, '少年宫 3 楼']);

  const restored = await asParent('DELETE', `/api/outside-class-exceptions/${moved.exceptions[0].id}`);
  assert.deepEqual([restored.statusCode, restored.json().exceptions], [200, []]);
  assert.equal((await schedule(wednesday))[0].outside[0].status, 'scheduled');

  // Only parents manage classes; children see their own days only.
  const headers = await loginAs(sister);
  assert.equal((await asChild('GET', '/api/outside-classes', undefined, headers)).statusCode, 403);
  assert.equal((await asChild('POST', '/api/outside-classes', { title: 'x' }, headers)).statusCode, 403);
  assert.equal((await asChild('GET', `/api/children/${child.id}/schedule?from=${wednesday}`, undefined, headers)).statusCode, 403);
  assert.equal((await asChild('PUT', `/api/outside-classes/${piano.id}/exceptions`, { child_id: sister.id, date: wednesday, kind: 'leave' }, headers)).statusCode, 403);
});

test("a class's lessons can be check-in tasks: on the board when they happen, gone on leave, kept once done", async t => {
  const { child, asChild, asParent, today } = await fixture(t);
  const piano = (await asParent('POST', '/api/outside-classes', {
    title: '钢琴课', location: '少年宫', days_of_week: [getDayOfWeek(today)], start_time: '16:30', end_time: '17:30',
    start_date: today, create_task: true, points: 8
  })).json();
  const tasks = async () => (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json();
  const stats = async () => (await asParent('GET', `/api/children/${child.id}/stats`)).json();

  const [task] = await tasks();
  assert.deepEqual([task.title, task.origin, task.class_id, task.points, task.subject], ['钢琴课', 'class', piano.id, 8, '其他']);
  assert.deepEqual(task.class_lesson, { start_time: '16:30', end_time: '17:30', location: '少年宫', institution: null });
  assert.equal((await tasks()).length, 1, 'never duplicated');

  // On leave the check-in goes; back to normal it returns.
  const leave = (await asParent('PUT', `/api/outside-classes/${piano.id}/exceptions`, { child_id: child.id, date: today, kind: 'leave' })).json();
  assert.deepEqual([await tasks(), (await stats()).today_total_tasks], [[], 0]);
  await asParent('DELETE', `/api/outside-class-exceptions/${leave.exceptions[0].id}`);
  const [again] = await tasks();
  assert.equal((await asChild('POST', `/api/daily-tasks/${again.id}/complete`)).json().points_earned, 8);
  assert.deepEqual([(await stats()).today_completed_tasks, (await stats()).today_total_tasks], [1, 1]);

  // A done check-in stays even when the class changes or goes.
  await asParent('PUT', `/api/outside-classes/${piano.id}`, { create_task: false });
  assert.equal((await tasks()).length, 1);
  await asParent('DELETE', `/api/outside-classes/${piano.id}`);
  const [kept] = await tasks();
  assert.deepEqual([kept.title, kept.is_completed, kept.class_id], ['钢琴课', true, null]);
});

test('check-in tasks of outside classes are owed on days the board was never opened', async t => {
  const { ctx, child, asParent } = await fixture(t);
  const { rewardsService, statsService, tasksService } = ctx.app.services;
  const lastMonday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const day = n => shiftDate(lastMonday, n);
  ctx.db.prepare('UPDATE children SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  await asParent('POST', '/api/task-templates', { title: '口算', subject: '数学', days_of_week: [1, 3] });
  const piano = (await asParent('POST', '/api/outside-classes', {
    title: '钢琴课', days_of_week: [2], start_time: '16:30', end_time: '17:30', start_date: day(-30), create_task: true
  })).json();
  ctx.db.prepare('UPDATE task_templates SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);
  ctx.db.prepare('UPDATE outside_classes SET created_at = ?').run(`${day(-30)}T04:00:00.000Z`);

  // Monday and Wednesday done; Tuesday's piano lesson was never checked in (nor the board opened).
  for (const n of [0, 2]) tasksService.completeDailyTask(tasksService.getDailyTasks(child.id, day(n))[0].id);
  assert.equal(rewardsService.getCurrentStreak(child.id, day(2)), 1);
  const completion = statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6));
  assert.deepEqual(completion.items.map(i => [i.title, i.completed, i.total]), [['口算', 2, 2], ['钢琴课', 0, 1]]);

  // On leave that Tuesday, nothing was owed and the streak holds.
  await asParent('PUT', `/api/outside-classes/${piano.id}/exceptions`, { child_id: child.id, date: day(1), kind: 'leave' });
  assert.equal(rewardsService.getCurrentStreak(child.id, day(2)), 2);
  assert.deepEqual(statsService.getWeeklyCompletion(child.id, day(0), day(6), day(6)).items.map(i => i.title), ['口算']);
});
