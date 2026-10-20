const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../src/utils/date');

const countTask = (response, id) => response.json().filter(task => task.id === id).length;

test('deleted classes keep distinct homework identities, filters and summary through backup restore', async t => {
  const { ctx, child, day, asParent, record } = await fixture(t);
  const schedule = ctx.app.services.scheduleService;
  const homework = ctx.app.services.homeworkService;
  const classes = [];
  // Even two classes with the same title must retain different identities.
  for (const title of ['钢琴课', '游泳课', '钢琴课']) {
    const cls = schedule.createClass({ title, days_of_week: [1], start_time: '16:00', end_time: '17:00', start_date: day(-30), child_ids: [child.id] });
    classes.push(cls);
    const created = await record({ course_kind: 'class', class_id: cls.id, content: `${title}作业`, due_date: day(1), create_task: true });
    assert.equal(created.statusCode, 201, created.body);
  }
  const summary = () => {
    const result = homework.summary(child.id);
    return { ...result, courses: result.courses.map(({ class_id, ...course }) => course) };
  };
  const before = summary();
  assert.equal(before.courses.length, 3);
  const ids = homework.list(child.id).map(row => [row.id, row.course_key, row.task.id]);
  for (const cls of classes) schedule.deleteClass(cls.id);
  assert.deepEqual(summary(), before);
  assert.deepEqual(homework.list(child.id).map(row => [row.id, row.course_key, row.task.id]), ids);
  assert.ok(homework.list(child.id).every(row => row.class_id === null));
  for (const cls of classes) {
    const filtered = await asParent('GET', `/api/children/${child.id}/homework?class_id=${cls.id}`);
    assert.equal(filtered.statusCode, 200, filtered.body);
    assert.deepEqual(filtered.json().map(row => row.course_key), [`class:${cls.id}`]);
  }
  const backup = ctx.app.backupService;
  const archive = require('node:fs').readFileSync(backup.getPath(backup.create('course-identity').name));
  ctx.db.prepare('DELETE FROM homework_records').run();
  backup.restore(archive);
  assert.deepEqual(summary(), before);
  assert.deepEqual(homework.list(child.id).map(row => [row.id, row.course_key, row.task.id]), ids);
});

test('v19 homework backups gain stable course keys; damaged v20 backups are rejected before restore', async t => {
  const { ctx, child, day, record } = await fixture(t);
  const Database = require('better-sqlite3');
  const { gzipSync, gunzipSync } = require('node:zlib');
  const schedule = ctx.app.services.scheduleService;
  const homework = ctx.app.services.homeworkService;
  const makeClass = title => schedule.createClass({ title, days_of_week: [1], start_time: '16:00', end_time: '17:00', start_date: day(-30), child_ids: [child.id] });
  const live = makeClass('钢琴课');
  const archived = makeClass('游泳课');
  for (const cls of [live, archived, archived]) {
    assert.equal((await record({ course_kind: 'class', class_id: cls.id, content: `${cls.title}作业`, due_date: day(1) })).statusCode, 201);
  }
  assert.equal((await record({ content: '科学实验报告' })).statusCode, 201);
  schedule.deleteClass(archived.id);
  const backup = ctx.app.backupService;
  const data = JSON.parse(gunzipSync(require('node:fs').readFileSync(backup.getPath(backup.create('legacy-courses').name))));
  const legacy = new Database(Buffer.from(data.database, 'base64'));
  t.after(() => legacy.close());
  legacy.exec('ALTER TABLE homework_records DROP COLUMN course_key');
  const pack = () => gzipSync(JSON.stringify({ ...data, database: legacy.serialize().toString('base64') }));
  const before = homework.list(child.id);
  assert.throws(() => backup.restore(pack()), /作业课程标识/);
  assert.deepEqual(homework.list(child.id), before);
  legacy.pragma('user_version = 19');
  backup.restore(pack());
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 24);
  assert.deepEqual(homework.summary(child.id).courses.map(row => [row.course_key, row.total]).sort(),
    [[`class:${live.id}`, 1], ['class:archived:游泳课', 2], ['school:科学', 1]].sort());
  schedule.deleteClass(live.id);
  assert.equal(homework.list(child.id).find(row => row.subject === '钢琴课').course_key, `class:${live.id}`);
});

// 科学 is taught once a week, on the weekday three days from today, so homework set today is due in
// two days; 数学 is taught on every other day of the week.
async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const today = getTodayDate();
  const day = n => shiftDate(today, n);
  const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
  const child = await createChild('小明');
  const loginAs = async who => ({ authorization: `Bearer ${(await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: who.id } })).json().token}` });
  const headers = await loginAs(child);
  const asParent = (method, url, payload) => ctx.app.inject({ method, url, payload });
  const asChild = (method, url, payload, h = headers) => ctx.rawInject({ method, url, headers: h, payload });
  const scienceDay = getDayOfWeek(day(3));
  const timetable = await asParent('POST', `/api/children/${child.id}/timetables`, {
    name: '本学期', start_date: day(-60), end_date: day(90),
    slots: [
      { id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' },
      { id: 's2', kind: 'class', label: '第2节', start_time: '08:50', end_time: '09:30' }
    ],
    lessons: [
      { slot_id: 's1', weekday: scienceDay, subject: '科学' },
      ...[0, 1, 2, 3, 4, 5, 6].filter(d => d !== scienceDay).map(weekday => ({ slot_id: 's2', weekday, subject: '数学' }))
    ]
  });
  assert.equal(timetable.statusCode, 201, timetable.body);
  const record = (payload, who = child) => asParent('POST', `/api/children/${who.id}/homework`, { course_kind: 'school', subject: '科学', content: '完成实验报告', ...payload });
  const board = async () => (await asChild('GET', `/api/daily-tasks?child_id=${child.id}`)).json();
  return { ctx, today, day, child, createChild, loginAs, headers, asParent, asChild, record, board };
}

test('homework is due the day before the next lesson, and its task starts on the board today', async t => {
  const { today, day, child, asParent, record, board } = await fixture(t);
  const courses = (await asParent('GET', `/api/children/${child.id}/homework/courses`)).json();
  // 数学 has more lessons a week, so it comes first; the defaults are for the latest lesson.
  assert.deepEqual(courses.map(c => c.subject), ['数学', '科学']);
  const science = courses.find(c => c.subject === '科学');
  assert.deepEqual([science.course_key, science.points, science.last_lesson_date, science.next_lesson_date, science.due_date],
    ['school:科学', 10, day(-4), day(3), day(2)]);

  const created = await record({ create_task: true });
  assert.equal(created.statusCode, 201, created.body);
  const homework = created.json();
  assert.deepEqual([homework.assigned_date, homework.due_date, homework.points, homework.created_by, homework.task_state], [today, day(2), 10, 'parent', 'open']);
  assert.deepEqual([homework.task.date, homework.task.due_date], [today, day(2)]);

  // On the board it is optional until its due date, filed under 其他, and shows the homework.
  const task = (await board()).find(item => item.id === homework.task.id);
  assert.deepEqual([task.title, task.subject, task.origin, task.is_optional, task.due_date], ['科学：完成实验报告', '其他', 'adhoc', true, day(2)]);
  assert.equal(task.homework.content, '完成实验报告');

  // Homework set in the last lesson (four days ago) is still due before the next one, and its task
  // starts today, leaving that day's history alone.
  const earlier = (await record({ assigned_date: day(-4), content: '预习第3课', create_task: true })).json();
  assert.deepEqual([earlier.due_date, earlier.task.date], [day(2), today]);
  assert.equal(countTask(await asParent('GET', `/api/daily-tasks?child_id=${child.id}&date=${day(-4)}`), earlier.task.id), 0);
});

test('past-due homework is only recorded; a missing next lesson means no due date', async t => {
  const { day, child, asParent, record } = await fixture(t);
  // Set two lessons ago: due five days ago.
  const late = await record({ assigned_date: day(-11), create_task: true });
  assert.equal(late.statusCode, 400);
  const kept = (await record({ assigned_date: day(-11) })).json();
  assert.deepEqual([kept.due_date, kept.task, kept.task_state, kept.can_create_task], [day(-5), null, 'none', false]);
  assert.equal((await asParent('POST', `/api/homework/${kept.id}/task`)).statusCode, 409);

  // A subject not in the timetable has no default due date, so no task unless one is chosen.
  assert.equal((await record({ subject: '书法', create_task: true })).statusCode, 400);
  const free = (await record({ subject: '书法' })).json();
  assert.equal(free.due_date, null);
  const chosen = (await record({ subject: '书法', due_date: day(1), create_task: true })).json();
  assert.deepEqual([chosen.due_date, chosen.task_state], [day(1), 'open']);

  for (const [payload, why] of [
    [{ content: '' }, 'no content'],
    [{ content: 'x'.repeat(501) }, 'content too long'],
    [{ assigned_date: day(1) }, 'set in the future'],
    [{ due_date: day(-1) }, 'due before it was set'],
    [{ course_kind: 'class', class_id: 'missing' }, 'not a class of the child'],
    [{ points: -1 }, 'negative points']
  ]) assert.equal((await record(payload)).statusCode, 400, why);
  assert.equal((await asParent('GET', `/api/children/${child.id}/homework`)).json().length, 3);
});

test('a holiday or a leave pushes the due date to the lesson after it', async t => {
  const { day, child, asParent, record } = await fixture(t);
  await asParent('POST', `/api/children/${child.id}/periods`, { name: '国庆', start_date: day(3), end_date: day(5) });
  // The 科学 lesson in three days falls in the break; the next one is ten days away.
  assert.equal((await record({})).json().due_date, day(9));

  const piano = (await asParent('POST', '/api/outside-classes', {
    title: '钢琴课', days_of_week: [getDayOfWeek(day(1))], start_time: '16:30', end_time: '17:30', start_date: day(-30), child_ids: [child.id]
  })).json();
  const course = (await asParent('GET', `/api/children/${child.id}/homework/courses`)).json().find(c => c.kind === 'class');
  assert.deepEqual([course.subject, course.course_key, course.next_lesson_date, course.due_date], ['钢琴课', `class:${piano.id}`, day(1), day(0)]);
  await asParent('PUT', `/api/outside-classes/${piano.id}/exceptions`, { child_id: child.id, date: day(1), kind: 'leave' });
  const practice = (await record({ course_kind: 'class', class_id: piano.id, subject: undefined, content: '练习小步舞曲', create_task: true })).json();
  assert.deepEqual([practice.subject, practice.class_id, practice.due_date], ['钢琴课', piano.id, day(7)]);
  const task = (await asParent('GET', `/api/daily-tasks?child_id=${child.id}`)).json().find(item => item.id === practice.task.id);
  assert.deepEqual([task.title, task.subject], ['钢琴课：练习小步舞曲', '其他']);
});

test('a child records homework; its task waits for a parent, who may change the points', async t => {
  const { ctx, day, child, createChild, loginAs, asParent, asChild, board } = await fixture(t);
  assert.equal((await asChild('PUT', '/api/homework-course-points', { course_key: 'school:科学', points: 30 })).statusCode, 403);
  assert.equal((await asParent('PUT', '/api/homework-course-points', { course_key: 'school:科学', points: 8 })).statusCode, 200);
  assert.equal((await asParent('GET', `/api/children/${child.id}/homework/courses`)).json().find(c => c.subject === '科学').points, 8);

  // A child's record takes the course's points whatever they send, and asks for its task.
  const asked = await asChild('POST', `/api/children/${child.id}/homework`, { course_kind: 'school', subject: '科学', content: '观察月相', points: 999, create_task: true });
  assert.equal(asked.statusCode, 201, asked.body);
  const homework = asked.json();
  assert.deepEqual([homework.created_by, homework.points, homework.task_requested, homework.task_state, homework.task], ['child', 8, true, 'pending', null]);
  assert.equal((await board()).some(task => task.homework), false);

  // The child may still fix their own record, but not create its task.
  assert.equal((await asChild('PUT', `/api/homework/${homework.id}`, { content: '观察月相并画图' })).json().content, '观察月相并画图');
  assert.equal((await asChild('POST', `/api/homework/${homework.id}/task`)).statusCode, 403);
  assert.equal((await asChild('GET', '/api/homework-requests')).statusCode, 403);

  // Another child can neither see nor change it.
  const sister = await createChild('小红');
  const sisterHeaders = await loginAs(sister);
  assert.equal((await asChild('GET', `/api/children/${child.id}/homework`, undefined, sisterHeaders)).statusCode, 403);
  assert.equal((await asChild('PUT', `/api/homework/${homework.id}`, { content: 'x' }, sisterHeaders)).statusCode, 403);
  assert.equal((await asChild('POST', `/api/children/${child.id}/homework`, { course_kind: 'school', subject: '科学', content: 'x' }, sisterHeaders)).statusCode, 403);

  const requests = (await asParent('GET', '/api/homework-requests')).json();
  assert.deepEqual(requests.map(r => [r.id, r.child_name]), [[homework.id, '小明']]);
  const approved = await asParent('POST', `/api/homework/${homework.id}/task`, { points: 12, track_time: true, expected_minutes: 20 });
  assert.equal(approved.statusCode, 201, approved.body);
  assert.deepEqual([approved.json().task_state, approved.json().points, approved.json().task.points], ['open', 12, 12]);
  assert.deepEqual((await asParent('GET', '/api/homework-requests')).json(), []);
  const task = (await board()).find(item => item.id === approved.json().task.id);
  assert.deepEqual([task.title, task.track_time, task.expected_minutes, task.due_date], ['科学：观察月相并画图', true, 20, day(2)]);

  // Once it has a task, the record is the parent's to change or delete.
  assert.equal((await asChild('PUT', `/api/homework/${homework.id}`, { content: 'x' })).statusCode, 403);
  assert.equal((await asChild('DELETE', `/api/homework/${homework.id}`)).statusCode, 403);

  // A request the parent turns down keeps the record, without a task.
  const second = (await asChild('POST', `/api/children/${child.id}/homework`, { course_kind: 'school', subject: '数学', content: '口算一页', create_task: true })).json();
  const rejected = (await asParent('POST', `/api/homework/${second.id}/reject-task`)).json();
  assert.deepEqual([rejected.task_state, rejected.task_requested], ['none', false]);
  assert.equal((await asChild('DELETE', `/api/homework/${second.id}`)).statusCode, 200);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM homework_records').get().n, 1);
});

test('editing a record updates its open task; deleting it may remove the task too', async t => {
  const { ctx, today, day, child, headers, asParent, record } = await fixture(t);
  const homework = (await record({ create_task: true, points: 15 })).json();
  const edited = await asParent('PUT', `/api/homework/${homework.id}`, { content: '完成实验报告\n附上照片', due_date: day(4), points: 20 });
  assert.equal(edited.statusCode, 200, edited.body);
  const task = () => ctx.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(homework.task.id);
  assert.deepEqual([task().title, task().points, task().due_date], ['科学：完成实验报告', 20, day(4)]);
  // Due today: no longer optional, no extra days.
  await asParent('PUT', `/api/homework/${homework.id}`, { due_date: today });
  assert.equal(task().due_date, null);
  assert.equal((await asParent('PUT', `/api/homework/${homework.id}`, { due_date: day(-1), assigned_date: day(-4) })).statusCode, 400);

  // A done task keeps its history: dates no longer change, points stay as earned.
  await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${homework.task.id}/complete`, headers });
  assert.equal((await asParent('PUT', `/api/homework/${homework.id}`, { due_date: day(3) })).statusCode, 409);
  assert.equal((await asParent('PUT', `/api/homework/${homework.id}`, { content: '改一下内容' })).json().task_state, 'done');
  assert.equal(task().title, '科学：完成实验报告');

  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 20);
  assert.equal((await asParent('DELETE', `/api/homework/${homework.id}?delete_task=1`)).statusCode, 200);
  assert.equal(task(), undefined);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 0);

  // Without delete_task the task stays on the board.
  const kept = (await record({ create_task: true })).json();
  await asParent('DELETE', `/api/homework/${kept.id}`);
  assert.ok(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(kept.task.id));
});

test('records can be looked up by course, date and words; suggestions flag same-subject daily tasks', async t => {
  const { day, child, asParent, record } = await fixture(t);
  await asParent('POST', '/api/task-templates', { title: '数学练习册', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const suggestion = (await asParent('GET', `/api/children/${child.id}/homework/suggest?course_kind=school&subject=${encodeURIComponent('数学')}&assigned_date=${day(-1)}`)).json();
  assert.deepEqual(suggestion.same_subject_tasks, ['数学练习册']);
  assert.equal(suggestion.assigned_date, day(-1));
  assert.ok(suggestion.next_lesson_date > day(-1));
  assert.deepEqual((await asParent('GET', `/api/children/${child.id}/homework/suggest?course_kind=school&subject=${encodeURIComponent('科学')}`)).json().same_subject_tasks, []);

  await record({ content: '实验报告 100%完成' });
  await record({ subject: '数学', content: '练习册第 12 页', assigned_date: day(-1) });
  await record({ subject: '数学', content: '口算', assigned_date: day(-8) });
  const list = async query => (await asParent('GET', `/api/children/${child.id}/homework?${new URLSearchParams(query)}`)).json().map(r => r.content);
  assert.deepEqual(await list({}), ['实验报告 100%完成', '练习册第 12 页', '口算']);
  assert.deepEqual(await list({ subject: '数学' }), ['练习册第 12 页', '口算']);
  assert.deepEqual(await list({ from: day(-7) }), ['实验报告 100%完成', '练习册第 12 页']);
  assert.deepEqual(await list({ q: '第 12' }), ['练习册第 12 页']);
  // Search words are taken literally.
  assert.deepEqual(await list({ q: '%' }), ['实验报告 100%完成']);
});

test('homework records survive a backup and restore', async t => {
  const { ctx, child, asParent, record } = await fixture(t);
  await record({ create_task: true });
  await asParent('PUT', '/api/homework-course-points', { course_key: 'school:科学', points: 6 });
  const backup = ctx.app.backupService.create('test');
  const archive = require('node:fs').readFileSync(ctx.app.backupService.getPath(backup.name));
  ctx.db.prepare('DELETE FROM homework_records').run();
  ctx.db.prepare('DELETE FROM homework_course_points').run();
  ctx.app.backupService.restore(archive);
  const restored = ctx.app.services.homeworkService.list(child.id);
  assert.deepEqual([restored.length, restored[0].task_state], [1, 'open']);
  assert.equal(ctx.app.services.homeworkService.coursePoints('school:科学'), 6);
});

test('a summary per course counts records and how their tasks went, within a date range', async t => {
  const { ctx, day, child, headers, createChild, loginAs, asParent, asChild, record } = await fixture(t);
  const done = (await record({ content: '实验报告', create_task: true })).json();
  await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${done.task.id}/complete`, headers });
  await record({ content: '观察记录', create_task: true });
  await record({ content: '旧作业', assigned_date: day(-11) });
  // A task whose last day passed undone is missed; a skipped one is left out of the rate.
  const missed = (await record({ subject: '数学', content: '口算', create_task: true })).json();
  ctx.db.prepare('UPDATE daily_tasks SET date = ?, due_date = NULL WHERE id = ?').run(day(-1), missed.task.id);
  const skipped = (await record({ subject: '数学', content: '练习册', create_task: true })).json();
  await asParent('POST', `/api/daily-tasks/${skipped.task.id}/skip`, { reason: '老师没布置' });
  await asChild('POST', `/api/children/${child.id}/homework`, { course_kind: 'school', subject: '数学', content: '订正', create_task: true });

  const summary = async query => (await asParent('GET', `/api/children/${child.id}/homework/summary?${new URLSearchParams(query)}`)).json();
  const all = await summary({});
  assert.equal(all.term.name, '本学期');
  const row = subject => all.courses.find(c => c.subject === subject);
  assert.deepEqual(all.courses.map(c => c.subject), ['数学', '科学']);
  assert.deepEqual(['total', 'done', 'missed', 'skipped', 'open', 'pending', 'none', 'completion_rate'].map(k => row('科学')[k]), [3, 1, 0, 0, 1, 0, 1, 1]);
  assert.deepEqual(['total', 'done', 'missed', 'skipped', 'open', 'pending', 'none', 'completion_rate'].map(k => row('数学')[k]), [3, 0, 1, 1, 0, 1, 0, 0]);
  assert.deepEqual([all.totals.total, all.totals.done, all.totals.missed, all.totals.completion_rate], [6, 1, 1, 0.5]);

  // Only homework set within the range counts.
  const recent = await summary({ from: day(-7) });
  assert.equal(recent.courses.find(c => c.subject === '科学').total, 2);
  assert.equal((await asParent('GET', `/api/children/${child.id}/homework/summary?from=bad`)).statusCode, 400);

  // A child sees their own summary only.
  assert.equal((await asChild('GET', `/api/children/${child.id}/homework/summary`)).statusCode, 200);
  const sister = await createChild('小红');
  assert.equal((await asChild('GET', `/api/children/${child.id}/homework/summary`, undefined, await loginAs(sister))).statusCode, 403);
});
