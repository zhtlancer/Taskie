const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, getWeekRange, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  return ctx;
}
const createChild = async ctx => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: '测试孩子' } })).json();
const multipart = (file, pin = '1234') => ({ headers: { 'content-type': 'multipart/form-data; boundary=backup-test' }, payload: Buffer.concat([
  Buffer.from(`--backup-test\r\nContent-Disposition: form-data; name="pin"\r\n\r\n${pin}\r\n--backup-test\r\nContent-Disposition: form-data; name="file"; filename="backup.taskie.gz"\r\nContent-Type: application/gzip\r\n\r\n`), file, Buffer.from('\r\n--backup-test--\r\n')
]) });

test('unauthenticated writes and invalid/expired tokens are rejected', async t => {
  const ctx = await fixture(t);
  for (const url of ['/api/children', '/api/task-templates', '/api/backups']) {
    const res = await ctx.rawInject({ method: 'POST', url, payload: {} });
    assert.equal(res.statusCode, 401);
  }
  for (const token of ['invalid', ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() }, { expiresIn: -1 })]) {
    assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/backups', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
  }
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/parent-login', payload: { pin: '1234' } })).json();
  assert.ok(ctx.app.jwt.decode(login.token).exp);
  assert.equal((await ctx.app.inject({ method: 'PUT', url: '/api/auth/parent-pin', payload: { old_pin: '1234', new_pin: '6789' } })).statusCode, 200);
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/backups', headers: { authorization: `Bearer ${login.token}` } })).statusCode, 401);
});

test('child credentials cannot administer or access another child and photo', async t => {
  const ctx = await fixture(t), a = await createChild(ctx), b = await createChild(ctx);
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: a.id } })).json();
  const headers = { authorization: `Bearer ${login.token}` };
  for (const url of ['/api/backups', `/api/children/${b.id}/stats`, `/api/daily-tasks?child_id=${b.id}`, `/api/mistakes?child_id=${b.id}`, `/api/characters?child_id=${b.id}`]) {
    assert.equal((await ctx.rawInject({ method: 'GET', url, headers })).statusCode, 403, url);
  }
  assert.equal((await ctx.rawInject({ method: 'DELETE', url: `/api/children/${b.id}`, headers })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'POST', url: '/api/characters', headers, payload: { child_id: b.id, char: '学' } })).statusCode, 403);
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'private.jpg'), 'photo');
  ctx.app.services.mistakesService.createMistake({ child_id: b.id, subject: '数学', description: 'private', photo_path: '/uploads/private.jpg' });
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/uploads/private.jpg' })).statusCode, 401);
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/uploads/private.jpg', headers })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: 'GET', url: '/uploads/private.jpg' })).statusCode, 200);
  assert.equal((await ctx.rawInject({ method: 'POST', url: '/api/mistakes', headers, payload: { child_id: a.id, subject: '数学', description: 'cannot claim another photo', photo_path: '/uploads/private.jpg' } })).statusCode, 400);
  await ctx.app.inject({ method: 'DELETE', url: `/api/children/${b.id}` });
  assert.equal(fs.existsSync(path.join(ctx.tempUploadDir, 'private.jpg')), false);
});

test('children cannot generate or check off back-dated tasks', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 10 } });
  const login = (await ctx.rawInject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json();
  const headers = { authorization: `Bearer ${login.token}` };
  const today = getTodayDate(), yesterday = shiftDate(today, -1);

  for (const date of [yesterday, '2020-01-01', shiftDate(today, 1)]) {
    assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}&date=${date}`, headers })).statusCode, 403, date);
  }
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM daily_tasks').get().n, 0);

  const past = (await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}&date=${yesterday}` })).json()[0];
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${past.id}/complete`, headers })).statusCode, 403);
  assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${past.id}/complete` })).statusCode, 200);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${past.id}/uncomplete`, headers })).statusCode, 403);

  const current = (await ctx.rawInject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}`, headers })).json()[0];
  assert.equal(current.date, today);
  assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/daily-tasks?child_id=${child.id}&date=${today}`, headers })).statusCode, 200);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${current.id}/complete`, headers })).json().points_earned, 10);
  assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${current.id}/uncomplete`, headers })).statusCode, 200);
});

test('login failures are rate limited', async t => {
  const ctx = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await ctx.rawInject({ method: 'POST', url: '/api/auth/parent-login', payload: { pin: '9999' } })).statusCode, 401);
  const response = await ctx.rawInject({ method: 'POST', url: '/api/auth/parent-login', payload: { pin: '9999', child_id: 'cannot-bypass-parent-limit' } });
  assert.equal(response.statusCode, 429);
  assert.ok(Number(response.headers['retry-after']) > 0);
});

test('weekly targets survive reload, cap credit and reset in the next week', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const template = (await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 2, points: 10 } })).json();
  assert.equal(ctx.app.services.tasksService.getTemplate(template.id).weekly_target_times, 2);
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  const tasks = [0, 1, 2].map(day => ctx.app.services.tasksService.getDailyTasks(child.id, shiftDate(monday, day))[0]);
  ctx.app.services.tasksService.completeDailyTask(tasks[0].id);
  const second = ctx.app.services.tasksService.completeDailyTask(tasks[1].id);
  assert.equal(second.task.weekly_completed_times, 2);
  const summary = ctx.app.services.statsService.getWeeklySummary(child.id, monday);
  assert.equal(summary.current_week.total_tasks, 2);
  assert.equal(summary.current_week.completed_tasks, 2);
  assert.equal(ctx.app.services.tasksService.getDailyTasks(child.id, shiftDate(monday, 2)).length, 0);
  assert.throws(() => ctx.app.services.tasksService.completeDailyTask(tasks[2].id), error => error.status === 409);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 20);
  ctx.app.services.tasksService.uncompleteDailyTask(tasks[0].id);
  assert.equal(ctx.app.services.tasksService.getDailyTasks(child.id, shiftDate(monday, 2))[0].weekly_completed_times, 1);
  assert.equal(ctx.app.services.tasksService.getDailyTasks(child.id, shiftDate(monday, 7))[0].weekly_completed_times, 0);
});

test('same-day new templates are filled once and future tasks cannot earn points', async t => {
  const ctx = await fixture(t), child = await createChild(ctx), service = ctx.app.services.tasksService;
  for (const title of ['第一项', '第二项']) {
    service.createTemplate({ title, subject: '数学' });
    assert.equal(service.getDailyTasks(child.id).length, title === '第一项' ? 1 : 2);
  }
  assert.equal(service.getDailyTasks(child.id).length, 2);
  const future = service.getDailyTasks(child.id, shiftDate(getTodayDate(), 1))[0];
  assert.throws(() => service.completeDailyTask(future.id), error => error.status === 400);
  assert.equal(service.getDailyTasks(child.id)[0].date, getTodayDate());
});

test('family date is correct at midnight regardless of host timezone; invalid dates are bounded', async () => {
  const result = spawnSync(process.execPath, ['-e', "const D=Date;global.Date=class extends D{constructor(...a){super(...(a.length?a:['2026-10-14T00:30:00+08:00']));}};console.log(require('./src/utils/date').getTodayDate());"], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, TZ: 'UTC', TIME_ZONE: 'Asia/Shanghai' }, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '2026-10-14');
  const dates = require('../src/utils/date');
  assert.throws(() => dates.parseDate('2026-02-30'));
  assert.throws(() => dates.getDateRangeList('invalid', 'z'));
  assert.throws(() => dates.getDateRangeList('2000-01-01', '2026-01-01'));
});

test('backup restore preserves records and photos, keeps recovery snapshot and invalidates sessions', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const photo = Buffer.from('original photo');
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'backup.jpg'), photo);
  ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: 'snapshot', photo_path: '/uploads/backup.jpg' });
  const created = await ctx.app.inject({ method: 'POST', url: '/api/backups' });
  assert.equal(created.statusCode, 200, created.body);
  const name = created.json().name;
  const downloaded = await ctx.app.inject({ method: 'GET', url: `/api/backups/${name}/download` });
  assert.equal(downloaded.statusCode, 200);
  assert.ok(downloaded.rawPayload.length);
  const oldToken = ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() });
  await createChild(ctx);
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'backup.jpg'), 'changed');
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(downloaded.rawPayload) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM children').get().n, 1);
  assert.deepEqual(fs.readFileSync(path.join(ctx.tempUploadDir, 'backup.jpg')), photo);
  assert.ok(ctx.app.backupService.list().some(b => b.name === restored.json().recovery_backup));
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/backups', headers: { authorization: `Bearer ${oldToken}` } })).statusCode, 401);
  assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
});

test('backup restore keeps template assignments and accepts backups from before assignments existed', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const template = (await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { title: '口算', subject: '数学', child_ids: [child.id] } })).json();
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  await ctx.app.inject({ method: 'PUT', url: `/api/task-templates/${template.id}`, payload: { child_ids: null } });
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(archive) })).statusCode, 200);
  assert.deepEqual(ctx.app.services.tasksService.getTemplate(template.id).child_ids, [child.id]);

  const Database = require('better-sqlite3');
  const legacy = JSON.parse(gunzipSync(archive));
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec('DROP TABLE template_children; ALTER TABLE task_templates DROP COLUMN assign_all');
  db.pragma('user_version = 1');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(ctx.app.services.tasksService.getTemplate(template.id).child_ids, null);
});

test('backup restore keeps rewards and redemptions, and backups from before rewards existed still restore', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const item = ctx.app.services.redemptionsService.createItem({ title: '看动画', cost: 1 });
  ctx.db.prepare('INSERT INTO point_logs (id, child_id, points, earned_at) VALUES (?, ?, ?, ?)').run('seed-points', child.id, 5, new Date().toISOString());
  const redemption = ctx.app.services.redemptionsService.requestRedemption(child.id, item.id);
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  ctx.app.services.redemptionsService.resolveRedemption(redemption.id, 'cancelled');
  ctx.app.services.redemptionsService.deleteItem(item.id);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(archive) })).statusCode, 200);
  assert.equal(ctx.app.services.redemptionsService.getItem(item.id).title, '看动画');
  assert.equal(ctx.app.services.redemptionsService.getRedemption(redemption.id).status, 'pending');

  const Database = require('better-sqlite3');
  for (const [version, status, pattern] of [[2, 200, null], [3, 400, /备份缺少积分兑换数据/]]) {
    const damaged = JSON.parse(gunzipSync(archive));
    const db = new Database(Buffer.from(damaged.database, 'base64'));
    db.exec('DROP TABLE reward_redemptions; DROP TABLE reward_items');
    db.pragma(`user_version = ${version}`);
    damaged.database = db.serialize().toString('base64');
    db.close();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
    assert.equal(res.statusCode, status, res.body);
    if (pattern) assert.match(res.body, pattern);
  }
  // The v2 backup restored successfully and simply has no rewards yet.
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM reward_items').get().n, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM reward_redemptions').get().n, 0);
});

test('current-schema backups missing assignment data are rejected before changing live data or photos', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const service = ctx.app.services.tasksService;
  const template = service.createTemplate({ title: '阅读', subject: '语文', child_ids: [child.id] });
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'assignment.jpg'), 'snapshot');
  ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '语文', description: 'snapshot', photo_path: '/uploads/assignment.jpg' });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const second = await createChild(ctx);
  service.updateTemplate(template.id, { child_ids: [second.id] });
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'assignment.jpg'), 'current');
  const epoch = ctx.app.sessionEpoch();
  const backups = ctx.app.backupService.list();
  const Database = require('better-sqlite3');
  for (const corruption of ['DROP TABLE template_children', 'ALTER TABLE task_templates DROP COLUMN assign_all']) {
    const damaged = JSON.parse(gunzipSync(archive));
    const db = new Database(Buffer.from(damaged.database, 'base64'));
    db.exec(corruption);
    assert.equal(db.pragma('user_version', { simple: true }), 20);
    damaged.database = db.serialize().toString('base64');
    db.close();
    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
    assert.equal(res.statusCode, 400, res.body);
    assert.match(res.body, /备份缺少任务分配数据/);
    assert.deepEqual(service.getTemplate(template.id).child_ids, [second.id]);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM children').get().n, 2);
    assert.equal(fs.readFileSync(path.join(ctx.tempUploadDir, 'assignment.jpg'), 'utf8'), 'current');
    assert.equal(ctx.app.sessionEpoch(), epoch);
    assert.deepEqual(ctx.app.backupService.list(), backups);
    assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
  }
});

test('task history snapshots survive restore, migrate v3 backups and reject incomplete v4 snapshots', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const tasks = ctx.app.services.tasksService;
  const template = tasks.createTemplate({ title: '阅读', subject: '语文', schedule_type: 'weekly_times', weekly_target_times: 2 });
  const monday = getWeekRange(shiftDate(getTodayDate(), -7)).startDate;
  for (const n of [0, 1]) tasks.completeDailyTask(tasks.getDailyTasks(child.id, shiftDate(monday, n))[0].id);
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const Database = require('better-sqlite3');
  const legacy = JSON.parse(gunzipSync(archive));
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec('ALTER TABLE daily_tasks DROP COLUMN source_template_id; ALTER TABLE daily_tasks DROP COLUMN template_created_at');
  // A v4 backup claiming to contain snapshots must fail before modifying live data.
  const damaged = { ...legacy, database: db.serialize().toString('base64') };
  const epoch = ctx.app.sessionEpoch();
  const backups = ctx.app.backupService.list();
  const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /备份缺少任务历史快照/);
  assert.equal(ctx.app.sessionEpoch(), epoch);
  assert.deepEqual(ctx.app.backupService.list(), backups);
  db.pragma('user_version = 3');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  const rows = ctx.db.prepare('SELECT source_template_id, template_created_at FROM daily_tasks').all();
  assert.ok(rows.every(row => row.source_template_id === template.id && row.template_created_at === template.created_at));
  tasks.deleteTemplate(template.id);
  const deletedArchive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  ctx.db.exec('DELETE FROM daily_tasks');
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(deletedArchive) })).statusCode, 200);
  assert.equal(ctx.app.services.statsService.getWeeklySummary(child.id, monday).current_week.completion.completed_units, 2);
});

test('corrupt backups, unsafe photo paths and wrong PIN do not alter current data', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const unsafe = JSON.parse(gunzipSync(archive));
  unsafe.photos['../../escape.jpg'] = Buffer.from('unsafe').toString('base64');
  for (const [buffer, pin, status] of [[Buffer.from('broken'), '1234', 400], [archive, '0000', 403], [gzipSync(JSON.stringify(unsafe)), '1234', 400], [gzipSync(JSON.stringify({ format: 'other' })), '1234', 400]]) {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(buffer, pin) });
    assert.equal(res.statusCode, status, res.body);
    assert.equal(ctx.db.prepare('SELECT id FROM children').get().id, child.id);
  }
});

test('restore database failure rolls back both live records and photos', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'rollback.jpg'), 'snapshot');
  ctx.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: 'rollback', photo_path: '/uploads/rollback.jpg' });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  fs.writeFileSync(path.join(ctx.tempUploadDir, 'rollback.jpg'), 'current');
  const second = await createChild(ctx);
  ctx.db.exec("CREATE TRIGGER reject_restore BEFORE INSERT ON children BEGIN SELECT RAISE(ABORT, 'restore failed'); END");
  assert.throws(() => ctx.app.backupService.restore(archive), /restore failed/);
  assert.equal(ctx.db.prepare('SELECT id FROM children WHERE id = ?').get(second.id).id, second.id);
  assert.equal(fs.readFileSync(path.join(ctx.tempUploadDir, 'rollback.jpg'), 'utf8'), 'current');
  assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
});

test('backup retention keeps the most recent archives', async t => {
  const ctx = await fixture(t);
  ctx.app.backupService.retention = 2;
  ctx.app.backupService.create(); ctx.app.backupService.create();
  const newest = ctx.app.backupService.create();
  assert.equal(ctx.app.backupService.list().length, 2);
  assert.ok(ctx.app.backupService.list().some(b => b.name === newest.name));
});

test('old schema migrates without losing existing children and fixed-day templates', () => {
  const Database = require('better-sqlite3'), { initDb } = require('../src/db');
  const db = new Database(':memory:');
  try {
    db.exec(fs.readFileSync(path.join(__dirname, '../src/db/schema.sql'), 'utf8'));
    db.prepare('INSERT INTO children VALUES (?, ?, ?, ?, ?)').run('legacy', '保留账号', '🐱', null, '2026-10-01');
    db.prepare('INSERT INTO task_templates VALUES (?, ?, ?, ?, ?, ?)').run('legacy-task', '旧任务', '数学', '[1]', 10, '2026-10-01');
    initDb(db); initDb(db);
    assert.equal(db.prepare('SELECT name FROM children').get().name, '保留账号');
    assert.equal(db.prepare('SELECT schedule_type FROM task_templates').get().schedule_type, 'fixed_days');
    assert.equal(db.prepare('SELECT assign_all FROM task_templates').get().assign_all, 1);
    assert.equal(db.pragma('user_version', { simple: true }), 20);
  } finally { db.close(); }
});

test('v8 character books restore with empty categories; a v9 backup without them is rejected', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  ctx.app.services.charactersService.createCharacter({ child_id: child.id, char: '春', categories: ['write'] });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const Database = require('better-sqlite3');
  const legacy = JSON.parse(gunzipSync(archive));
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec('ALTER TABLE characters DROP COLUMN categories');
  const damaged = { ...legacy, database: db.serialize().toString('base64') };
  const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /备份缺少生字生词分类/);
  assert.deepEqual(ctx.app.services.charactersService.listCharacters({ child_id: child.id }).map(c => c.categories), [['write']]);
  db.pragma('user_version = 8');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  assert.deepEqual(ctx.app.services.charactersService.listCharacters({ child_id: child.id }).map(c => [c.char, c.categories]), [['春', []]]);
});

test('skipped tasks and their requests survive restore; v9 backups restore without skips and a v10 backup without them is rejected', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const { tasksService, skipsService } = ctx.app.services;
  tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const task = tasksService.getDailyTasks(child.id)[0];
  skipsService.requestSkip(task.id, '老师今天没布置', { role: 'parent' });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  skipsService.unskip(task.id);
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(archive) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(skipsService.listRequests().map(r => [r.status, r.reason]), [['approved', '老师今天没布置']]);
  assert.equal(tasksService.getDailyTasks(child.id)[0].is_skipped, true);

  const Database = require('better-sqlite3');
  const legacy = JSON.parse(gunzipSync(archive));
  for (const mutation of [
    'DROP TABLE task_skip_requests',
    'ALTER TABLE daily_tasks DROP COLUMN skipped_at',
    'ALTER TABLE daily_tasks DROP COLUMN skip_reason'
  ]) {
    const damagedDb = new Database(Buffer.from(legacy.database, 'base64'));
    let damaged;
    try {
      damagedDb.exec(mutation);
      damaged = { ...legacy, database: damagedDb.serialize().toString('base64') };
    } finally { damagedDb.close(); }
    const backupsBefore = ctx.app.backupService.list();
    const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
    assert.equal(invalid.statusCode, 400, `${mutation}: ${invalid.body}`);
    assert.match(invalid.body, /备份缺少跳过申请数据/);
    assert.deepEqual(ctx.app.backupService.list(), backupsBefore);
    assert.equal(tasksService.getDailyTasks(child.id)[0].skip_reason, '老师今天没布置');
    assert.deepEqual(skipsService.listRequests().map(r => [r.status, r.reason]), [['approved', '老师今天没布置']]);
  }
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec('DROP TABLE task_skip_requests; ALTER TABLE daily_tasks DROP COLUMN skipped_at; ALTER TABLE daily_tasks DROP COLUMN skip_reason');
  const damaged = { ...legacy, database: db.serialize().toString('base64') };
  const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body, /备份缺少跳过申请数据/);
  db.pragma('user_version = 9');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const older = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(older.statusCode, 200, older.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  assert.deepEqual([skipsService.listRequests().length, tasksService.getDailyTasks(child.id)[0].is_skipped], [0, false]);
});

test('task durations survive restore; v10 backups restore without timing and a v11 backup missing it is rejected', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const { tasksService } = ctx.app.services;
  tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], track_time: true, expected_minutes: 20 });
  const task = tasksService.getDailyTasks(child.id)[0];
  tasksService.completeDailyTask(task.id, { duration_seconds: 1200 });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  tasksService.setDuration(task.id, null);
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(archive) });
  assert.equal(restored.statusCode, 200, restored.body);
  const back = tasksService.getDailyTasks(child.id)[0];
  assert.deepEqual([back.track_time, back.expected_minutes, back.duration_seconds, back.duration_source], [true, 20, 1200, 'manual']);

  const Database = require('better-sqlite3');
  const { TIMING_COLUMNS } = require('../src/db');
  const legacy = JSON.parse(gunzipSync(archive));
  const dropAll = Object.entries(TIMING_COLUMNS).flatMap(([table, columns]) => Object.keys(columns).map(name => `ALTER TABLE ${table} DROP COLUMN ${name}`));
  for (const mutation of dropAll) {
    const db = new Database(Buffer.from(legacy.database, 'base64'));
    db.exec(mutation);
    const damaged = { ...legacy, database: db.serialize().toString('base64') };
    db.close();
    const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
    assert.equal(invalid.statusCode, 400, `${mutation}: ${invalid.body}`);
    assert.match(invalid.body, /备份缺少任务用时数据/);
  }
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec(dropAll.join(';'));
  db.pragma('user_version = 10');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const older = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(older.statusCode, 200, older.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  const legacyTask = tasksService.getDailyTasks(child.id)[0];
  assert.deepEqual([legacyTask.track_time, legacyTask.duration_seconds, legacyTask.timer_seconds], [false, null, 0]);
  assert.equal(tasksService.listTemplates()[0].track_time, false);
});

test('timetables and outside classes survive restore; v11 backups restore without them and a v12 backup missing them is rejected', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const { scheduleService } = ctx.app.services;
  const today = getTodayDate();
  scheduleService.createTimetable(child.id, { name: '本学期', start_date: today, end_date: shiftDate(today, 30),
    slots: [{ id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' }], lessons: [{ slot_id: 's1', weekday: 1, subject: '语文' }] });
  const piano = scheduleService.createClass({ title: '钢琴课', days_of_week: [3], start_time: '16:30', end_time: '17:30', child_ids: [child.id] });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  scheduleService.deleteClass(piano.id);
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(archive) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.deepEqual(scheduleService.listClasses().map(c => [c.title, c.child_ids]), [['钢琴课', [child.id]]]);
  assert.equal(scheduleService.listTimetables(child.id)[0].lessons[0].subject, '语文');

  const Database = require('better-sqlite3');
  const legacy = JSON.parse(gunzipSync(archive));
  const tables = ['outside_class_exceptions', 'outside_class_children', 'timetable_lessons', 'timetable_slots', 'timetables'];
  for (const mutation of [...tables.map(table => `DROP TABLE ${table}`), 'ALTER TABLE daily_tasks DROP COLUMN class_id']) {
    const db = new Database(Buffer.from(legacy.database, 'base64'));
    db.exec(mutation);
    const damaged = { ...legacy, database: db.serialize().toString('base64') };
    db.close();
    const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
    assert.equal(invalid.statusCode, 400, `${mutation}: ${invalid.body}`);
    assert.match(invalid.body, /备份缺少课程表数据/);
  }
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec([...tables, 'outside_classes'].map(table => `DROP TABLE ${table}`).join(';') + ';ALTER TABLE daily_tasks DROP COLUMN class_id');
  db.pragma('user_version = 11');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const older = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(older.statusCode, 200, older.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  assert.deepEqual([scheduleService.listClasses(), scheduleService.listTimetables(child.id)], [[], []]);
});

test('lesson identities migrate from v12 without losing check-ins; v13 backups require and preserve them', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const { scheduleService, tasksService, skipsService } = ctx.app.services;
  const today = getTodayDate(), tomorrow = shiftDate(today, 1);
  const cls = scheduleService.createClass({ title: '钢琴', days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_time: '16:00', end_time: '17:00', start_date: today, create_task: true, points: 8 });
  const regular = tasksService.getDailyTasks(child.id)[0];
  tasksService.completeDailyTask(regular.id);
  scheduleService.setException(cls.id, { child_id: child.id, date: tomorrow, kind: 'moved', new_date: today, new_start_time: '09:00', new_end_time: '10:00' });
  const movedOnly = scheduleService.createClass({ title: '绘画', days_of_week: [new Date(`${tomorrow}T00:00:00Z`).getUTCDay()],
    start_time: '16:00', end_time: '17:00', start_date: today, create_task: true });
  scheduleService.setException(movedOnly.id, { child_id: child.id, date: tomorrow, kind: 'moved', new_date: today, new_start_time: '11:00', new_end_time: '12:00' });
  const generated = tasksService.getDailyTasks(child.id);
  const moved = generated.find(row => row.class_id === movedOnly.id);
  skipsService.requestSkip(moved.id, '今天请假', { role: 'parent' });
  // v12 only generated one row per class/day, even when two piano lessons happened that day.
  ctx.db.prepare('DELETE FROM daily_tasks WHERE class_id = ? AND id != ?').run(cls.id, regular.id);
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const data = JSON.parse(gunzipSync(archive));
  const Database = require('better-sqlite3');
  const candidate = new Database(Buffer.from(data.database, 'base64'));
  let damaged, older;
  try {
    candidate.exec('ALTER TABLE daily_tasks DROP COLUMN class_lesson_date');
    damaged = gzipSync(JSON.stringify({ ...data, database: candidate.serialize().toString('base64') }));
    candidate.pragma('user_version = 12');
    older = gzipSync(JSON.stringify({ ...data, database: candidate.serialize().toString('base64') }));
  } finally { candidate.close(); }
  const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(damaged) });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.match(invalid.body, /备份缺少课次数据/);
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 8);

  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(older) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  const rows = tasksService.getDailyTasks(child.id);
  assert.equal(rows.length, 3);
  assert.deepEqual([rows.find(row => row.id === regular.id).class_lesson_date, rows.find(row => row.id === regular.id).is_completed], [today, true]);
  assert.deepEqual([rows.find(row => row.id === moved.id).class_lesson_date, rows.find(row => row.id === moved.id).is_skipped], [tomorrow, true]);
  assert.equal(rows.find(row => row.class_id === cls.id && row.class_lesson_date === tomorrow).class_lesson.start_time, '09:00');
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(child.id), 8, 'migration cannot award duplicate points');

  const current = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  const roundTrip = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(current) });
  assert.equal(roundTrip.statusCode, 200, roundTrip.body);
  assert.deepEqual(tasksService.getDailyTasks(child.id).map(row => [row.id, row.class_lesson_date]), rows.map(row => [row.id, row.class_lesson_date]));
});

test('carry-over, due dates and make-up days survive restore; v13 backups restore without them and a v14 backup missing them is rejected', async t => {
  const ctx = await fixture(t), child = await createChild(ctx);
  const { tasksService, periodsService } = ctx.app.services;
  const today = getTodayDate();
  const template = tasksService.createTemplate({ title: '口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], carry_over: true });
  tasksService.createAdhocTask(child.id, { title: '手抄报', subject: '其他', date: today, due_date: shiftDate(today, 3) });
  periodsService.createMakeupDay(child.id, { date: shiftDate(today, 10), acts_as: 1 });
  const archive = fs.readFileSync(ctx.app.backupService.getPath(ctx.app.backupService.create().name));
  tasksService.updateTemplate(template.id, { carry_over: false });
  const restored = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(archive) });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(tasksService.listTemplates()[0].carry_over, true);
  assert.equal(tasksService.listAdhocTasks(child.id)[0].due_date, shiftDate(today, 3));
  assert.deepEqual(periodsService.listMakeupDays(child.id).map(m => m.acts_as), [1]);

  const Database = require('better-sqlite3');
  const legacy = JSON.parse(gunzipSync(archive));
  const drops = ['DROP TABLE makeup_days', 'ALTER TABLE task_templates DROP COLUMN carry_over', 'ALTER TABLE daily_tasks DROP COLUMN carry_over', 'ALTER TABLE daily_tasks DROP COLUMN due_date'];
  for (const mutation of drops) {
    const db = new Database(Buffer.from(legacy.database, 'base64'));
    db.exec(mutation);
    const damaged = { ...legacy, database: db.serialize().toString('base64') };
    db.close();
    const invalid = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(damaged))) });
    assert.equal(invalid.statusCode, 400, `${mutation}: ${invalid.body}`);
    assert.match(invalid.body, /备份缺少顺延和调休数据/);
  }
  const db = new Database(Buffer.from(legacy.database, 'base64'));
  db.exec(drops.join(';'));
  db.pragma('user_version = 13');
  legacy.database = db.serialize().toString('base64');
  db.close();
  const older = await ctx.app.inject({ method: 'POST', url: '/api/backups/restore', ...multipart(gzipSync(JSON.stringify(legacy))) });
  assert.equal(older.statusCode, 200, older.body);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 20);
  assert.deepEqual([tasksService.listTemplates()[0].carry_over, tasksService.listAdhocTasks(child.id)[0].due_date, periodsService.listMakeupDays(child.id)], [false, null, []]);
});
