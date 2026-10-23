const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { splitSeconds } = require('../src/services/homework-study.service');

async function fixture(t, now = '2026-10-20T04:00:00Z', due = '2026-10-22') {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const { childrenService, homeworkService: homework, homeworkStudyService: study, tasksService: tasks, timeStatsService: stats, rewardsService: rewards } = ctx.app.services;
  const child = childrenService.createChild({ name: '分次作业' });
  const record = homework.create(child.id, { subject: '数学', content: '分几次写完练习册', due_date: due, create_task: true, points: 10 }, 'parent');
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  let childHeaders = { authorization: `Bearer ${login.token}` };
  const call = (method, suffix, payload, headers = childHeaders) => ctx.rawInject({ method, url: `/api/homework/${record.id}${suffix}`, payload, headers });
  const row = () => ctx.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(record.task.id);
  const advance = seconds => {
    t.mock.timers.setTime(Date.now() + seconds * 1000);
    childHeaders = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() })}` };
  };
  const time = date => stats.sessions(child.id, date, date).reduce((sum, row) => sum + (row.seconds || 0), 0);
  return { ...ctx, child, record, homework, study, tasks, stats, rewards, call, row, advance, time, get childHeaders() { return childHeaders; } };
}

test('multiple same-day sessions save once each, resume after pause and reward only once on completion', async t => {
  const c = await fixture(t);
  let response = await c.call('POST', '/study/start');
  assert.equal(response.statusCode, 200, response.body);
  const first = response.json().active.id;
  c.advance(600);
  await c.call('POST', `/sessions/${first}/pause`);
  c.advance(1200); // break is not counted
  await c.call('POST', '/study/start');
  c.advance(300);
  response = await c.call('POST', `/sessions/${first}/finish`, { note: '第一部分' });
  assert.equal(response.json().total_seconds, 900);
  assert.equal(c.row().is_completed, 0);
  assert.equal(c.rewards.getTotalPoints(c.child.id), 0);
  await c.call('POST', `/sessions/${first}/finish`, { note: '重复提交' });
  assert.equal(c.study.details(c.record.id).sessions.length, 1);
  const second = (await c.call('POST', '/study/start')).json().active.id;
  assert.notEqual(second, first);
  c.advance(1200);
  response = await c.call('POST', `/sessions/${second}/finish`, { note: '写完剩下部分', complete: true });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().total_seconds, 2100);
  assert.equal(c.row().is_completed, 1);
  assert.equal(c.rewards.getTotalPoints(c.child.id), 10);
  assert.equal(c.time('2026-10-20'), 2100, 'daily stats count sessions once, not task aggregate');
  await c.call('POST', `/sessions/${second}/finish`, { complete: true });
  await c.call('POST', '/complete');
  assert.equal(c.rewards.getTotalPoints(c.child.id), 10);
  c.tasks.uncompleteDailyTask(c.row().id);
  assert.equal(c.rewards.getTotalPoints(c.child.id), 0);
  assert.equal(c.time('2026-10-20'), 2100, 'undoing completion keeps time actually spent');
});

test('cross-midnight sessions allocate time by family date and child cannot correct yesterday', async t => {
  const c = await fixture(t, '2026-10-20T15:50:00Z'); // 23:50 Shanghai
  const id = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(1800);
  const result = await c.call('POST', `/sessions/${id}/finish`, { note: '跨日学习' });
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(result.json().sessions[0].days, [{ date: '2026-10-20', seconds: 600 }, { date: '2026-10-21', seconds: 1200 }]);
  assert.deepEqual([c.time('2026-10-20'), c.time('2026-10-21')], [600, 1200]);
  const stats = c.stats.stats(c.child.id, '2026-10-20', '2026-10-21');
  assert.equal(stats.summary.sessions, 1);
  assert.equal(stats.tasks[0].average_seconds, 1800);
  assert.equal(stats.tasks[0].sessions, 1);
  assert.deepEqual(stats.days.map(day => day.recorded_seconds), [600, 1200]);
  assert.equal(c.stats.stats(c.child.id, '2026-10-21', '2026-10-21').tasks[0].average_seconds, 1200);
  assert.equal((await c.call('PUT', `/sessions/${id}`, { duration_seconds: 600 })).statusCode, 403);
  const parent = await c.app.inject({ method: 'PUT', url: `/api/homework/${c.record.id}/sessions/${id}`, payload: { duration_seconds: 1200, days: [{ date: '2026-10-20', seconds: 300 }, { date: '2026-10-21', seconds: 900 }] } });
  assert.equal(parent.statusCode, 200, parent.body);
  assert.deepEqual([c.time('2026-10-20'), c.time('2026-10-21')], [300, 900]);
  assert.equal(c.row().is_completed, 0);
});

test('an overdue child can study but completion requires parent confirmation and is idempotent', async t => {
  const c = await fixture(t, '2026-10-20T04:00:00Z', '2026-10-20');
  c.advance(86400);
  const sid = (await c.call('POST', '/study/start')).json().active.id;
  c.advance(600);
  const ended = await c.call('POST', `/sessions/${sid}/finish`, { complete: true });
  assert.equal(ended.statusCode, 200, ended.body);
  assert.ok(ended.json().record.completion_requested_at);
  assert.equal(c.row().is_completed, 0);
  assert.equal(c.time('2026-10-21'), 600);
  assert.equal(c.rewards.getTotalPoints(c.child.id), 0);
  assert.equal((await c.rawInject({ method: 'GET', url: '/api/homework-completion-requests', headers: c.childHeaders })).statusCode, 403);
  assert.equal((await c.rawInject({ method: 'POST', url: `/api/daily-tasks/${c.row().id}/complete`, headers: c.childHeaders })).statusCode, 403);
  const queue = (await c.app.inject({ method: 'GET', url: '/api/homework-completion-requests' })).json();
  assert.equal(queue[0].id, c.record.id);
  assert.equal((await c.app.inject({ method: 'POST', url: `/api/homework/${c.record.id}/complete` })).statusCode, 200);
  assert.equal(c.row().completion_source, 'parent_backfill');
  assert.equal(c.rewards.getTotalPoints(c.child.id), 10);
  await c.app.inject({ method: 'POST', url: `/api/homework/${c.record.id}/complete` });
  assert.equal(c.rewards.getTotalPoints(c.child.id), 10);
  assert.equal(c.study.details(c.record.id).record.completion_requested_at, null);
});

test('timers share one running task across homework, ordinary tasks and long-term goals', async t => {
  const c = await fixture(t);
  const other = c.tasks.createAdhocTask(c.child.id, { title: '普通作业', subject: '语文', points: 5, track_time: true });
  const id = c.study.start(c.record.id).active.id;
  c.advance(60);
  c.app.services.timersService.apply('task', other.id, 'start');
  assert.equal(c.study.details(c.record.id).active.timer_started_at, null);
  assert.equal(c.study.details(c.record.id).active.duration_seconds, 60);
  c.advance(60);
  c.study.start(c.record.id);
  assert.equal(c.db.prepare('SELECT timer_started_at FROM daily_tasks WHERE id = ?').get(other.id).timer_started_at, null);
  assert.equal(c.study.details(c.record.id).active.id, id);
  assert.throws(() => c.tasks.completeDailyTask(c.row().id), error => error.status === 409);
});

test('manual recording, correction permissions, record ownership and repeat requests', async t => {
  const c = await fixture(t);
  const payload = { request_id: 'manual_session_1', date: '2026-10-20', duration_seconds: 900, note: '忘记计时，补记' };
  assert.equal((await c.call('POST', '/sessions', payload)).statusCode, 200);
  assert.equal((await c.call('POST', '/sessions', payload)).statusCode, 200);
  assert.equal(c.study.details(c.record.id).sessions.length, 1);
  assert.equal((await c.call('PUT', '/sessions/manual_session_1', { duration_seconds: 1200, note: '更正' })).statusCode, 200);
  assert.equal(c.time('2026-10-20'), 1200);
  assert.equal((await c.call('POST', '/sessions', { ...payload, request_id: 'future_session', date: '2026-10-21' })).statusCode, 400);
  c.advance(86400);
  assert.equal((await c.call('PUT', '/sessions/manual_session_1', { note: '改昨天' })).statusCode, 403);
  const other = c.app.services.childrenService.createChild({ name: '别的孩子' });
  const login = (await c.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: other.id } })).json();
  assert.equal((await c.call('GET', '/study', undefined, { authorization: `Bearer ${login.token}` })).statusCode, 403);
  assert.equal((await c.call('PUT', '/sessions/manual_session_1', { note: '越权' }, { authorization: `Bearer ${login.token}` })).statusCode, 403);
});

test('sessions and allocations survive backup; deleting only a record keeps spent time', async t => {
  const c = await fixture(t);
  const sid = c.study.start(c.record.id).active.id;
  c.advance(600);
  c.study.finish(c.record.id, sid, { note: '保留历史' }, 'child');
  const backup = c.app.backupService;
  const archive = require('node:fs').readFileSync(backup.getPath((await backup.create('study')).name));
  c.db.prepare('DELETE FROM homework_sessions').run();
  await backup.restore(archive);
  assert.equal(c.study.details(c.record.id).sessions[0].note, '保留历史');
  assert.equal(c.time('2026-10-20'), 600);
  c.homework.delete(c.record.id, {}, 'parent');
  assert.equal(c.time('2026-10-20'), 600);
  c.tasks.deleteAdhocTask(c.row().id);
  assert.equal(c.time('2026-10-20'), 0);
});

test('splitSeconds accounts exactly at the family midnight boundary', () => {
  assert.deepEqual(splitSeconds('2026-10-20T15:59:59Z', 2), [{ date: '2026-10-20', seconds: 1 }, { date: '2026-10-21', seconds: 1 }]);
  assert.deepEqual(splitSeconds('2026-10-20T16:00:00Z', 60), [{ date: '2026-10-21', seconds: 60 }]);
});

test('v20 legacy durations remain an aggregate without fabricated sessions; incomplete v21 backups fail safely', async t => {
  const c = await fixture(t);
  const Database = require('better-sqlite3');
  const { gzipSync, gunzipSync } = require('node:zlib');
  const backup = c.app.backupService;
  const packed = JSON.parse(gunzipSync(require('node:fs').readFileSync(backup.getPath((await backup.create('legacy')).name))));
  const old = new Database(Buffer.from(packed.database, 'base64'));
  t.after(() => old.close());
  old.exec('DROP TABLE homework_session_days; DROP TABLE homework_sessions; ALTER TABLE homework_records DROP COLUMN completion_requested_at; ALTER TABLE daily_tasks DROP COLUMN homework_legacy_seconds');
  old.prepare('UPDATE daily_tasks SET is_completed = 1, track_time = 1, duration_seconds = 600 WHERE id = ?').run(c.record.task.id);
  const archive = () => gzipSync(JSON.stringify({ ...packed, database: old.serialize().toString('base64') }));
  await assert.rejects(() => backup.restore(archive()), /分次学习/);
  assert.equal(c.row().is_completed, 0, 'damaged current backups leave live data untouched');
  old.pragma('user_version = 20');
  await backup.restore(archive());
  const result = c.study.details(c.record.id);
  assert.equal(result.legacy_seconds, 600);
  assert.equal(result.total_seconds, 600);
  assert.deepEqual(result.sessions, []);
  assert.equal(c.time('2026-10-20'), 600);
  c.study.manual(c.record.id, { request_id: 'legacy_extra_session', date: '2026-10-20', duration_seconds: 300, note: '补记另外一次' }, 'parent');
  assert.equal(c.time('2026-10-20'), 900);
});

test('skipping an active homework saves time already spent and stops its timer', async t => {
  const c = await fixture(t);
  c.study.start(c.record.id);
  c.advance(120);
  c.app.services.skipsService.requestSkip(c.row().id, '老师取消作业', { role: 'parent' });
  const result = c.study.details(c.record.id);
  assert.equal(result.active, null);
  assert.equal(result.total_seconds, 120);
  assert.equal(result.record.task.is_skipped, true);
  assert.equal(c.time('2026-10-20'), 120);
  assert.throws(() => c.study.start(c.record.id), error => error.status === 409);
  assert.throws(() => c.study.complete(c.record.id, 'child'), error => error.status === 409);
});

test('ordinary completion while learning cannot bypass saving a session, and correction never changes rewards', async t => {
  const c = await fixture(t);
  const id = c.study.start(c.record.id).active.id;
  const bypass = await c.rawInject({ method: 'POST', url: `/api/daily-tasks/${c.row().id}/complete`, headers: c.childHeaders });
  assert.equal(bypass.statusCode, 409);
  c.advance(120);
  c.study.finish(c.record.id, id, { complete: true }, 'child');
  c.study.edit(c.record.id, id, { duration_seconds: 60, note: '改用时' }, 'child');
  assert.equal(c.row().is_completed, 1);
  assert.equal(c.rewards.getTotalPoints(c.child.id), 10);
  assert.equal(c.time('2026-10-20'), 60);
});

test('parents may backdate learning to the actual assigned date even if the board task was created later', async t => {
  const c = await fixture(t);
  c.homework.update(c.record.id, { assigned_date: '2026-10-19' }, 'parent');
  assert.equal(c.row().date, '2026-10-20', 'older history does not acquire a backdated obligation');
  const body = { request_id: 'backdated_learning', date: '2026-10-19', duration_seconds: 600, note: '昨日实际学习' };
  assert.equal((await c.call('POST', '/sessions', body)).statusCode, 403);
  assert.equal((await c.app.inject({ method: 'POST', url: `/api/homework/${c.record.id}/sessions`, payload: body })).statusCode, 200);
  assert.equal(c.time('2026-10-19'), 600);
  assert.equal(c.row().is_completed, 0);
  assert.throws(() => c.study.manual(c.record.id, { ...body, request_id: 'too_early_learning', date: '2026-10-18' }, 'parent'), error => error.status === 400);
});
