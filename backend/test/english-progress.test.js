const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { shiftDate } = require('../src/utils/date');

test('English progress is read-only, independently scoped by skill, child and language', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-16')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, englishWordsService: book } = ctx.app.services;
  const child = childrenService.createChild({ name: '进度归属' });
  const other = childrenService.createChild({ name: '另一位孩子' });
  const word = book.createWord({ child_id: child.id, word: 'bank', definition_zh: '银行' });
  const blank = book.createWord({ child_id: child.id, word: 'book' });
  const insert = ctx.db.prepare(`INSERT INTO word_study_states
    (id, child_id, language, english_word_id, skill, stage, next_due_date, last_review_date, failures)
    VALUES (?, ?, ?, ?, ?, 2, ?, ?, 0)`);
  insert.run('reading', child.id, 'en', word.id, 'recognize', '2026-11-15', '2026-11-12');
  insert.run('writing', child.id, 'en', word.id, 'write', '2026-11-19', '2026-11-16');
  // Read-side ownership isolation remains in place; source/language mismatches are rejected by SQLite.
  insert.run('wrong-child', other.id, 'en', blank.id, 'recognize', '2026-11-15', '2026-11-12');
  assert.throws(() => insert.run('wrong-language', child.id, 'zh', blank.id, 'write', '2026-11-15', '2026-11-12'), /CHECK constraint/);
  const baseline = ctx.db.prepare('SELECT total_changes() AS n').get().n;
  const listed = book.listWords({ child_id: child.id });
  assert.equal(ctx.db.prepare('SELECT total_changes() AS n').get().n, baseline, 'reading must not create plans, tasks, states or rewards');
  const entry = listed.find(entry => entry.id === word.id);
  assert.equal(entry.study_date, '2026-11-16');
  assert.deepEqual(entry.study_progress.recognize, { status: 'due', stage: 2, last_review_date: '2026-11-12', next_due_date: '2026-11-15' });
  assert.deepEqual(entry.study_progress.write, { status: 'learning', stage: 2, last_review_date: '2026-11-16', next_due_date: '2026-11-19' });
  assert.deepEqual(book.getWord(word.id).study_progress, entry.study_progress);
  assert.deepEqual(listed.find(entry => entry.id === blank.id).study_progress.recognize,
    { status: 'unlearned', stage: null, last_review_date: null, next_due_date: null });
  assert.equal(book.getWord(blank.id).study_progress.write.status, 'unlearned');
  const marked = book.markMastered(word.id, true);
  assert.equal(marked.is_mastered, true);
  assert.equal(marked.study_progress.recognize.status, 'due', 'manual mastery must not hide due practice');
  assert.equal(book.updateWord(word.id, { note: '教材中的意思' }).study_progress.write.status, 'learning');

  const auth = childId => ({ authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: childId, epoch: ctx.app.sessionEpoch() })}` });
  const own = await ctx.app.inject({ method: 'GET', url: `/api/english-words?child_id=${child.id}`, headers: auth(child.id) });
  assert.equal(own.statusCode, 200);
  assert.equal(own.json().find(entry => entry.id === word.id).study_progress.recognize.status, 'due');
  const foreign = await ctx.app.inject({ method: 'GET', url: `/api/english-words/${word.id}`, headers: auth(other.id) });
  assert.equal(foreign.statusCode, 403);
  assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/english-words?child_id=${child.id}`, headers: auth(other.id) })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'GET', url: `/api/english-words/${word.id}` })).statusCode, 401);
});

test('real attempts update only the corresponding skill and family midnight changes due status without scheduling', async t => {
  const today = '2026-11-16';
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant(today, '23:59:59')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const { childrenService, englishWordsService: book, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '家庭跨日进度' });
  const word = book.createWord({ child_id: child.id, word: 'bank', definition_zh: '银行' });
  for (const skill of ['recognize', 'write']) study.savePlan(child.id, skill, {
    days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 1, review_target: 1
  }, 'en');
  const days = study.today(child.id, 'en').days;
  assert.equal(book.getWord(word.id).study_progress.recognize.status, 'unlearned', 'generating an item is not learning it');
  const item = days.find(day => day.skill === 'recognize').batches[0].items[0];
  study.grade(item.id, { result: 'good', request_id: 'progress-first-good' }, 'child');
  const progress = book.getWord(word.id).study_progress;
  assert.equal(progress.recognize.status, 'learning');
  assert.equal(progress.recognize.last_review_date, today);
  assert.equal(progress.recognize.next_due_date, shiftDate(today, 1));
  assert.equal(progress.write.status, 'unlearned');
  study.grade(item.id, { result: 'good', request_id: 'progress-first-good' }, 'child');
  assert.deepEqual(book.getWord(word.id).study_progress, progress, 'idempotent retries do not advance progress');
  t.mock.timers.tick(2000);
  const baseline = ctx.db.prepare('SELECT total_changes() AS n').get().n;
  const due = book.getWord(word.id);
  assert.equal(due.study_date, '2026-11-17');
  assert.equal(due.study_progress.recognize.status, 'due');
  assert.equal(due.study_progress.write.status, 'unlearned');
  assert.equal(ctx.db.prepare('SELECT total_changes() AS n').get().n, baseline);

  const nextDay = study.today(child.id, 'en').days.find(day => day.skill === 'recognize');
  study.grade(nextDay.batches[0].items[0].id, { result: 'again', request_id: 'progress-again' }, 'child');
  const after = book.getWord(word.id);
  assert.equal(after.study_progress.recognize.status, 'learning');
  assert.equal(after.study_progress.recognize.last_review_date, '2026-11-17');
  assert.equal(after.study_progress.recognize.next_due_date, '2026-11-18');
  assert.equal(after.is_mastered, false);
  // Match the existing scheduler's same-day deduplication, even for an old due date.
  ctx.db.prepare('UPDATE word_study_states SET next_due_date = ? WHERE english_word_id = ?').run('2026-11-16', word.id);
  assert.equal(book.getWord(word.id).study_progress.recognize.status, 'learning');
});
