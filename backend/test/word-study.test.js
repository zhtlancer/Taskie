const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { gzipSync, gunzipSync } = require('node:zlib');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-12T04:00:00Z') });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, charactersService: book, wordStudyService: study, tasksService: tasks, rewardsService: rewards, statsService: stats } = ctx.app.services;
  const child = childrenService.createChild({ name: '字词计划同学' });
  let sequence = 0;
  const add = (char, data = {}) => {
    const entry = book.createCharacter({ child_id: child.id, char, ...data });
    ctx.db.prepare('UPDATE characters SET created_at = ? WHERE id = ?').run(`2026-10-01T04:00:${String(sequence++).padStart(2, '0')}Z`, entry.id);
    return entry;
  };
  const plan = (data = {}, skill = 'recognize') => study.savePlan(child.id, skill, { new_target: 1, review_target: 1, ...data });
  const advance = date => t.mock.timers.setTime(new Date(`${date}T04:00:00Z`).getTime());
  const request = () => `request-${++sequence}-study`;
  const grade = (item, result = 'good', request_id = request()) => study.grade(item.id, { result, request_id }, 'child');
  const finish = (day, result = 'good', batchIndex = 0) => {
    let response;
    for (const item of day.batches[batchIndex].items) response = grade(item, result);
    return response;
  };
  const today = () => study.today(child.id).days;
  return { ...ctx, book, study, tasks, rewards, stats, child, add, plan, advance, request, grade, finish, today };
}

test('automatic selection respects categories, mastery, priority and frozen daily lists', async t => {
  const ctx = await fixture(t);
  const first = ctx.add('山', { categories: ['recognize'] });
  const priority = ctx.add('水', { categories: ['recognize', 'error_prone'] });
  const mastered = ctx.add('风', { categories: ['recognize'] });
  ctx.book.markMastered(mastered.id, true);
  ctx.add('云', { categories: ['write'] });
  ctx.plan({ new_target: 2, categories: ['recognize'] });
  const day = ctx.today()[0];
  assert.deepEqual(day.batches[0].items.map(item => item.character_id), [priority.id, first.id]);
  assert.equal(day.base_total, 2, 'does not pad a review target with extra new words');
  const addedLater = ctx.book.createCharacter({ child_id: ctx.child.id, char: '花', categories: ['recognize'] });
  ctx.db.prepare('UPDATE characters SET created_at = ? WHERE id = ?').run('2026-10-12T04:00:01Z', addedLater.id);
  assert.deepEqual(ctx.today()[0].batches[0].items.map(item => item.id), day.batches[0].items.map(item => item.id));
  ctx.finish(day);
  assert.equal(ctx.study.extra(day.id, ctx.request()).batches.length, 1, 'words added after today’s list wait for another day');
  ctx.advance('2026-10-13');
  assert.ok(ctx.today()[0].batches[0].items.some(item => item.character_id === addedLater.id));
});

test('independent recall advances 1, 3, 7, 14, 30 days and same-day repetitions never skip stages', async t => {
  const ctx = await fixture(t);
  const word = ctx.add('山'); ctx.plan();
  const state = () => ctx.db.prepare('SELECT * FROM word_study_states WHERE character_id = ?').get(word.id);
  const intervals = [1, 3, 7, 14, 30, 30];
  for (const [index, interval] of intervals.entries()) {
    const day = ctx.today()[0];
    assert.equal(day.batches[0].items[0].kind, index ? 'review' : 'new');
    const item = day.batches[0].items[0];
    const requestId = ctx.request();
    assert.equal(ctx.grade(item, 'good', requestId).points_earned, 10);
    const before = state();
    assert.equal(before.next_due_date, shiftDate(getTodayDate(), interval));
    assert.equal(ctx.grade(item, 'good', requestId).points_earned, 0);
    assert.equal(ctx.grade(item).points_earned, 0);
    assert.deepEqual(state(), before);
    ctx.advance(before.next_due_date);
    // Some due dates land on weekends: learning happens on the next chosen learning day.
    while ([0, 6].includes(new Date(`${getTodayDate()}T00:00:00Z`).getUTCDay())) ctx.advance(shiftDate(getTodayDate(), 1));
  }
});

test('hinted and failed recall shorten scheduling; successful same-day corrections cannot promote it', async t => {
  const ctx = await fixture(t);
  const word = ctx.add('山'); ctx.plan(); ctx.finish(ctx.today()[0]);
  ctx.advance('2026-10-13');
  let day = ctx.today()[0];
  ctx.finish(day, 'good');
  let state = ctx.db.prepare('SELECT * FROM word_study_states WHERE character_id = ?').get(word.id);
  assert.equal(state.stage, 1);
  ctx.grade(day.batches[0].items[0], 'hinted');
  state = ctx.db.prepare('SELECT * FROM word_study_states WHERE character_id = ?').get(word.id);
  assert.equal(state.stage, 1);
  assert.equal(state.next_due_date, '2026-10-14');
  ctx.advance('2026-10-14');
  day = ctx.today()[0]; ctx.finish(day, 'again');
  ctx.grade(day.batches[0].items[0], 'good');
  state = ctx.db.prepare('SELECT * FROM word_study_states WHERE character_id = ?').get(word.id);
  assert.equal(state.stage, 0);
  assert.equal(state.next_due_date, '2026-10-15');
  assert.equal(ctx.book.getCharacter(word.id).is_mastered, false);
});

test('optional early practice keeps the original interval and never creates an extra required day', async t => {
  const ctx = await fixture(t);
  const word = ctx.add('山'); ctx.plan(); ctx.finish(ctx.today()[0]);
  ctx.advance('2026-10-13'); ctx.finish(ctx.today()[0]);
  const state = () => ctx.db.prepare('SELECT * FROM word_study_states WHERE character_id = ?').get(word.id);
  const before = state();
  assert.equal(before.next_due_date, '2026-10-16');
  ctx.advance('2026-10-14');
  let day = ctx.today()[0];
  assert.equal(day.base_total, 0);
  assert.equal(day.base_done, true);
  assert.equal(day.points, 0);
  assert.equal(ctx.tasks.getDailyTasks(ctx.child.id).length, 0);
  assert.equal(day.remaining_early, 1);
  day = ctx.study.extra(day.id, ctx.request());
  assert.equal(day.batches[1].items[0].is_early, 1);
  ctx.finish(day, 'good', 1);
  assert.equal(state().stage, before.stage);
  assert.equal(state().next_due_date, before.next_due_date);
  assert.equal(ctx.rewards.getCurrentStreak(ctx.child.id), 2);
  assert.equal(ctx.rewards.getChildStats(ctx.child.id).today_total_tasks, 0);
  ctx.grade(day.batches[1].items[0], 'again');
  assert.equal(state().next_due_date, '2026-10-15');
});

test('reading and writing are independent; missed days never fabricate answers or learning progress', async t => {
  const ctx = await fixture(t);
  const word = ctx.add('山', { categories: ['fix_strokes'] });
  ctx.plan(); ctx.plan({}, 'write');
  ctx.finish(ctx.today().find(day => day.skill === 'recognize'));
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 1);
  ctx.advance('2026-10-15');
  const days = ctx.today();
  const writing = days.find(day => day.skill === 'write');
  assert.equal(writing.batches[0].items[0].kind, 'new');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 1);
  assert.equal(ctx.study.history(ctx.child.id).filter(day => day.date < getTodayDate() && day.skill === 'write').length, 3);
  assert.ok(ctx.study.history(ctx.child.id).filter(day => day.skill === 'write').every(day => day.base_completed === 0));
  ctx.finish(writing, 'hinted');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states WHERE character_id = ?').get(word.id).n, 2);
  assert.deepEqual(ctx.book.getCharacter(word.id).categories, ['fix_strokes']);
});

test('daily targets are minimums; extra batches prioritize due reviews and preserve assessment and reward limits', async t => {
  const ctx = await fixture(t);
  for (const text of ['山', '水', '风', '云', '花', '草', '木', '月']) ctx.add(text);
  ctx.plan({ extra_points: 3, extra_reward_limit: 1 });
  let day = ctx.today()[0];
  assert.throws(() => ctx.study.extra(day.id, ctx.request()), error => error.status === 409);
  ctx.finish(day, 'again'); // Effort completes the daily goal even without a correct answer.
  const before = ctx.rewards.getChildStats(ctx.child.id);
  const allDone = ctx.rewards.getAllDoneDaysCount(ctx.child.id);
  const streak = ctx.rewards.getCurrentStreak(ctx.child.id);
  for (const expected of [3, 0, 0]) {
    day = ctx.study.extra(day.id, ctx.request());
    const response = ctx.finish(day, 'good', day.batches.length - 1);
    assert.equal(response.points_earned, expected);
  }
  const after = ctx.rewards.getChildStats(ctx.child.id);
  assert.deepEqual([after.today_total_tasks, after.today_completed_tasks, after.today_completion_rate], [before.today_total_tasks, before.today_completed_tasks, before.today_completion_rate]);
  assert.equal(ctx.rewards.getAllDoneDaysCount(ctx.child.id), allDone);
  assert.equal(ctx.rewards.getCurrentStreak(ctx.child.id), streak);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 13);
  assert.equal(ctx.study.extra(day.id, ctx.request()).batches.length, 4);
  ctx.advance('2026-10-13');
  day = ctx.today()[0];
  assert.equal(day.batches[0].items.filter(item => item.kind === 'review').length, 1);
  assert.equal(day.remaining_due, 7);
  ctx.finish(day);
  assert.ok(ctx.study.extra(day.id, ctx.request()).batches[1].items.every(item => item.kind === 'review'));
});

test('plan edits apply to later lists, including extra selection and frozen actual awards', async t => {
  const ctx = await fixture(t);
  ctx.add('山', { categories: ['recognize'] }); ctx.add('水', { categories: ['recognize'] });
  ctx.add('风', { categories: ['write'] });
  ctx.plan({ categories: ['recognize'], extra_points: 2, extra_reward_limit: 1 });
  let day = ctx.today()[0]; ctx.finish(day);
  ctx.plan({ categories: ['write'], points: 50, extra_points: 99, extra_reward_limit: 0 });
  day = ctx.study.extra(day.id, ctx.request());
  assert.deepEqual(day.batches[1].items.map(item => item.text), ['水']);
  assert.equal(ctx.finish(day, 'good', 1).points_earned, 2);
  assert.equal(ctx.today()[0].batches[0].points, 10);
  ctx.advance('2026-10-13');
  assert.deepEqual(ctx.today()[0].batches[0].items.map(item => item.text), ['风']);
  assert.equal(ctx.today()[0].points, 50);
});

test('removing source words preserves existing lists, history and rewards without future enrollment', async t => {
  const ctx = await fixture(t);
  const word = ctx.add('山'); ctx.plan();
  const day = ctx.today()[0];
  ctx.book.deleteCharacter(word.id, { role: 'parent' });
  assert.equal(ctx.today()[0].batches[0].items[0].text, '山');
  ctx.finish(day);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 10);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 0);
  ctx.advance('2026-10-13');
  assert.deepEqual(ctx.today(), []);
  assert.equal(ctx.study.history(ctx.child.id)[0].base_completed, 1);
});

test('request replays and parallel submissions do not duplicate batches, state updates or points', async t => {
  const ctx = await fixture(t);
  for (const text of ['山', '水', '风', '云']) ctx.add(text);
  ctx.plan({ extra_points: 2, extra_reward_limit: 1 });
  const day = ctx.today()[0], item = day.batches[0].items[0];
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: ctx.child.id, epoch: ctx.app.sessionEpoch() })}` };
  const options = { method: 'POST', url: `/api/word-study/items/${item.id}/attempts`, headers, payload: { result: 'good', request_id: ctx.request(), points: 9999 } };
  const responses = await Promise.all([ctx.rawInject(options), ctx.rawInject(options)]);
  assert.ok(responses.every(response => response.statusCode === 200));
  assert.equal(responses.reduce((sum, response) => sum + response.json().points_earned, 0), 10);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_attempts').get().n, 1);
  const sameRequest = ctx.request();
  ctx.study.extra(day.id, sameRequest); ctx.study.extra(day.id, sameRequest); ctx.study.extra(day.id, ctx.request());
  assert.equal(ctx.today()[0].batches.length, 2, 'an unfinished extra batch is resumed, not multiplied');
});

test('permissions cover own study, cross-child and encoded routes; generic check-off cannot bypass practice', async t => {
  const ctx = await fixture(t);
  ctx.add('山'); ctx.plan();
  const other = ctx.app.services.childrenService.createChild({ name: '另一个孩子' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: other.id, epoch: ctx.app.sessionEpoch() })}` };
  const day = ctx.today()[0], item = day.batches[0].items[0];
  for (const options of [
    { method: 'GET', url: `/api/children/${ctx.child.id}/word-study` },
    { method: 'GET', url: `/api/children/${ctx.child.id}/word-study/history` },
    { method: 'POST', url: `/api/word-study/days/${day.id}/extra`, payload: { request_id: ctx.request() } },
    { method: 'POST', url: `/api/%77ord-study/items/${item.id}/attempts`, payload: { result: 'good', request_id: ctx.request() } },
    { method: 'PUT', url: `/api/children/${other.id}/%77ord-study/plans/recognize`, payload: {} }
  ]) assert.equal((await ctx.rawInject({ ...options, headers })).statusCode, 403, options.url);
  const task = ctx.tasks.getDailyTasks(ctx.child.id)[0];
  for (const action of ['complete', 'uncomplete']) {
    const response = await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${task.id}/${action}` });
    assert.equal(response.statusCode, 409, response.body);
  }
  ctx.advance('2026-10-13');
  assert.throws(() => ctx.grade(item), error => error.status === 403);
  assert.throws(() => ctx.study.extra(day.id, ctx.request()), error => error.status === 403);
});

test('study days off, optional goals, empty books and input validation behave consistently', async t => {
  const ctx = await fixture(t);
  ctx.plan({ days_of_week: [2], required: false });
  ctx.add('山');
  assert.deepEqual(ctx.today(), []);
  ctx.advance('2026-10-13');
  const day = ctx.today()[0];
  assert.equal(day.required, false);
  assert.equal(ctx.rewards.getChildStats(ctx.child.id).today_total_tasks, 0);
  ctx.finish(day);
  for (const data of [{ new_target: 0, review_target: 0 }, { days_of_week: [] }, { categories: ['invalid'] }, { extra_reward_limit: 21 }, { enabled: 1 }]) {
    assert.throws(() => ctx.study.savePlan(ctx.child.id, 'recognize', data), error => error.status === 400);
  }
  ctx.advance('2026-10-14');
  assert.deepEqual(ctx.today(), []);
});

test('a failed award transaction rolls back attempts, memory, completion and points together', async t => {
  const ctx = await fixture(t); ctx.add('山'); ctx.plan();
  const day = ctx.today()[0];
  ctx.db.exec("CREATE TRIGGER fail_study_points BEFORE INSERT ON point_logs BEGIN SELECT RAISE(ABORT, 'study award failure'); END");
  assert.throws(() => ctx.finish(day), /study award failure/);
  assert.equal(ctx.today()[0].base_completed, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_attempts').get().n, 0);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 0);
});

test('study snapshots, memory, attempts and points survive backup; missing v17 data is rejected and v16 upgrades', async t => {
  const ctx = await fixture(t); ctx.add('山'); ctx.plan(); ctx.finish(ctx.today()[0]);
  const backup = ctx.app.backupService;
  const archive = fs.readFileSync(backup.getPath(backup.create().name));
  ctx.study.savePlan(ctx.child.id, 'recognize', { enabled: false });
  backup.restore(archive);
  assert.equal(ctx.study.plans(ctx.child.id)[0].enabled, true);
  assert.equal(ctx.today()[0].base_done, true);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 1);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_attempts').get().n, 1);
  assert.equal(ctx.rewards.getTotalPoints(ctx.child.id), 10);
  const data = JSON.parse(gunzipSync(archive));
  const db = new Database(Buffer.from(data.database, 'base64'));
  db.exec('DROP TABLE word_study_attempts');
  assert.throws(() => backup.restore(gzipSync(JSON.stringify({ ...data, database: db.serialize().toString('base64') }))), /字词学习/);
  db.close();
  const legacy = new Database(Buffer.from(data.database, 'base64'));
  legacy.pragma('foreign_keys = OFF');
  legacy.exec('DELETE FROM point_logs; DELETE FROM daily_tasks; DROP INDEX idx_point_logs_study_batch; DROP INDEX idx_daily_tasks_study_day; ALTER TABLE point_logs DROP COLUMN study_batch_id; ALTER TABLE daily_tasks DROP COLUMN study_day_id');
  for (const table of ['word_study_attempts', 'word_study_items', 'word_study_batches', 'word_study_days', 'word_study_states', 'word_study_plans']) legacy.exec(`DROP TABLE ${table}`);
  legacy.pragma('user_version = 16');
  backup.restore(gzipSync(JSON.stringify({ ...data, database: legacy.serialize().toString('base64') })));
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 19);
  assert.deepEqual(ctx.study.plans(ctx.child.id), []);
  legacy.close();
});

test('missed study days show on the parent backfill page and can be skipped, never backfilled', async t => {
  const ctx = await fixture(t);
  ctx.add('山');
  ctx.plan();
  ctx.advance('2026-10-14');
  // Direct entry must work without visiting the study page first.
  const response = await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks/backfill?child_id=${ctx.child.id}&date=2026-10-13` });
  assert.equal(response.statusCode, 200, response.body);
  const missed = response.json().tasks.find(task => task.origin === 'study');
  assert.ok(missed, 'a missed study day is listed for parents');
  assert.equal(missed.is_completed, false);
  const changes = ctx.db.prepare('SELECT total_changes() n').get().n;
  ctx.tasks.getBackfillTasks(ctx.child.id, '2026-10-13');
  assert.equal(ctx.db.prepare('SELECT total_changes() n').get().n, changes, 'repeat backfill reads do not reschedule');
  assert.throws(() => ctx.tasks.backfillDailyTask(missed.id), error => error.status === 409);
  assert.equal(ctx.stats.getHistory(ctx.child.id, '2026-10-13', '2026-10-13')[0].all_done, false);
  ctx.app.services.skipsService.requestSkip(missed.id, '生病请假', { role: 'parent' });
  const skipped = ctx.tasks.getBackfillTasks(ctx.child.id, '2026-10-13').tasks.find(task => task.id === missed.id);
  assert.equal(skipped.is_skipped, true);
  assert.ok(ctx.tasks.restDayChecker(ctx.child.id, '2026-10-13', '2026-10-13')('2026-10-13'), 'a skipped study day is a rest day');
  ctx.app.services.skipsService.unskip(missed.id);
  assert.equal(ctx.tasks.getBackfillTasks(ctx.child.id, '2026-10-13').tasks.find(task => task.id === missed.id).is_skipped, false);
});

test('reads that find every plan scheduled through today do not write', async t => {
  const ctx = await fixture(t);
  ctx.plan({ days_of_week: [1, 2] });
  ctx.today();
  const changes = () => ctx.db.prepare('SELECT total_changes() AS n').get().n;
  ctx.tasks.getDailyTasks(ctx.child.id); // First board visit records even an empty day.
  const before = changes();
  ctx.today();
  ctx.tasks.getDailyTasks(ctx.child.id);
  ctx.rewards.getCurrentStreak(ctx.child.id);
  ctx.stats.getWeeklySummary(ctx.child.id);
  assert.equal(changes(), before, 'no list today and no words: nothing to write');
  // A word added later the same day still gets today's list on the next read.
  ctx.add('山');
  assert.equal(ctx.today().length, 1);
  const after = changes();
  ctx.today();
  ctx.tasks.getDailyTasks(ctx.child.id);
  assert.equal(changes(), after, 'once today has its list, reads stay read-only');
});
