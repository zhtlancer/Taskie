const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { initDb, SCHEMA_VERSION } = require('../src/db');

test('case-variant confirmation covers create, rename, stale confirmations and atomic batches', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: '大小写确认' });
  const sibling = ctx.app.services.childrenService.createChild({ name: '独立单词本' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() })}` };
  const send = (method, suffix, payload) => ctx.app.inject({ method, url: `/api/english-words${suffix}`, headers, payload: method === 'PUT' ? { expected_version: ctx.app.services.englishWordsService.getWord(suffix.slice(1))?.version, ...payload } : payload });
  const add = payload => send('POST', '', { child_id: child.id, ...payload });
  const first = await add({ word: 'May', strict_case: true, definition_zh: '五月' });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().strict_case, true);
  const blocked = await add({ word: 'may' });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().code, 'ENGLISH_CASE_CONFIRMATION_REQUIRED');
  assert.deepEqual(blocked.json().conflicts, [{ word: 'may', variants: ['May'] }]);
  assert.equal((await add({ word: 'may', confirmed_case_variants: ['May'], definition_zh: '可以' })).statusCode, 201);
  const stale = await add({ word: 'MAY', confirmed_case_variants: ['May'] });
  assert.equal(stale.statusCode, 409, 'a new case variant needs a new confirmation');
  assert.deepEqual(stale.json().conflicts[0].variants, ['May', 'may']);
  assert.equal((await add({ word: 'MAY', confirmed_case_variants: ['May', 'may'] })).statusCode, 201);
  assert.equal((await add({ word: ' May ', confirmed_case_variants: ['May', 'may', 'MAY'] })).statusCode, 409, 'exact duplicates stay duplicates');
  const ordinaryEdit = await send('PUT', `/${first.json().id}`, { note: '教材用法', strict_case: false });
  assert.equal(ordinaryEdit.statusCode, 200, 'editing fields without renaming needs no repeated confirmation');
  assert.equal(ordinaryEdit.json().strict_case, false);

  const another = await add({ word: 'June' });
  const rename = await send('PUT', `/${another.json().id}`, { word: 'mAy' });
  assert.equal(rename.statusCode, 409);
  assert.equal((await send('PUT', `/${another.json().id}`, { word: 'mAy', confirmed_case_variants: ['MAY', 'May', 'may'] })).statusCode, 200);
  const foreign = await ctx.app.inject({ method: 'PUT', url: `/api/english-words/${first.json().id}`, headers: {
    authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: sibling.id, epoch: ctx.app.sessionEpoch() })}`
  }, payload: { strict_case: true, confirmed_case_variants: ['May'] } });
  assert.equal(foreign.statusCode, 403);
  assert.equal(ctx.app.services.englishWordsService.createWord({ child_id: sibling.id, word: 'may' }).word, 'may');

  const batch = items => send('POST', '/batch', { child_id: child.id, items });
  const unconfirmed = await batch([{ word: 'desk' }, { word: 'US', strict_case: true }, { word: 'us' }]);
  assert.equal(unconfirmed.statusCode, 409);
  assert.equal(ctx.app.services.englishWordsService.listWords({ child_id: child.id }).some(word => word.word === 'desk'), false);
  assert.deepEqual(unconfirmed.json().conflicts, [{ word: 'US', variants: ['us'] }, { word: 'us', variants: ['US'] }]);
  const confirmed = await batch([{ word: 'US', strict_case: true, confirmed_case_variants: ['us'] }, { word: 'us', confirmed_case_variants: ['US'] }]);
  assert.equal(confirmed.statusCode, 201);
  assert.equal(confirmed.json().added.find(word => word.word === 'US').strict_case, true);
  assert.equal(confirmed.json().added.find(word => word.word === 'us').strict_case, false);
  assert.equal((await add({ word: 'bad', strict_case: 'false' })).statusCode, 400);
  assert.equal((await batch([{ word: 'desk' }, { word: 'chair', strict_case: 1 }])).statusCode, 400);
  assert.equal((await add({ word: 'maY', confirmed_case_variants: true })).statusCode, 400);
  assert.equal(ctx.app.services.englishWordsService.listWords({ child_id: child.id }).some(word => word.word === 'desk'), false);
});

test('batch preview preserves input case and distinguishes existing and within-batch variants', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const book = ctx.app.services.englishWordsService;
  const child = ctx.app.services.childrenService.createChild({ name: '预览大小写' });
  book.createWord({ child_id: child.id, word: 'May' });
  const dictionaryService = { lookup: async () => ({ exact_matches: [{ word: 'May', definition_zh: '词典释义' }] }) };
  const preview = await book.batchPreview(child.id, 'MAY\nmay\nUS\nus', { dictionaryService });
  assert.deepEqual(preview.items.map(item => item.word), ['MAY', 'may', 'US', 'us']);
  assert.deepEqual(preview.items[0].existing_case_variants, ['May']);
  assert.deepEqual(preview.items[0].case_variants, ['May', 'may']);
  assert.deepEqual(preview.items[2].existing_case_variants, []);
  assert.deepEqual(preview.items[2].case_variants, ['us']);
});

test('spelling rules are item snapshots; v37 upgrades, current restores and damaged v38 rejection preserve data', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-16', '12:00:00')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, englishWordsService: book, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '规则快照' });
  const word = book.createWord({ child_id: child.id, word: 'May', definition_zh: '五月', strict_case: true });
  study.savePlan(child.id, 'write', { days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 1, review_target: 1 }, 'en');
  const first = study.today(child.id, 'en').days[0];
  assert.equal(first.batches[0].items[0].strict_case, true);
  book.updateWord(word.id, { expected_version: book.getWord(word.id).version, strict_case: false, definition_zh: '新的释义' });
  assert.equal(study.describeDay(first.id).batches[0].items[0].strict_case, true);
  assert.equal(study.describeDay(first.id).batches[0].items[0].meaning_zh, '五月');
  study.grade(first.batches[0].items[0].id, { result: 'good', request_id: 'strict-case-first-grade' }, 'child');
  t.mock.timers.tick(86400000);
  const next = study.today(child.id, 'en').days[0];
  assert.equal(next.batches[0].items[0].strict_case, false);
  book.updateWord(word.id, { expected_version: book.getWord(word.id).version, strict_case: true, word: 'Mayflower' });
  assert.equal(study.describeDay(next.id).batches[0].items[0].text, 'May');
  assert.equal(study.describeDay(next.id).batches[0].items[0].strict_case, false);

  const backup = await ctx.app.backupService.create('manual');
  const archive = fs.readFileSync(path.join(ctx.app.backupService.backupDir, backup.name));
  const parsed = JSON.parse(zlib.gunzipSync(archive));
  const candidate = mutate => {
    const db = new Database(Buffer.from(parsed.database, 'base64'));
    try { mutate(db); return zlib.gzipSync(JSON.stringify({ ...parsed, database: db.serialize().toString('base64') })); }
    finally { db.close(); }
  };
  ctx.db.prepare('DELETE FROM children').run();
  await ctx.app.backupService.restore(archive);
  assert.equal(book.getWord(word.id).strict_case, true);
  assert.equal(study.describeDay(first.id).batches[0].items[0].strict_case, true);
  assert.equal(study.describeDay(next.id).batches[0].items[0].strict_case, false);
  const legacy = candidate(db => {
    db.exec('ALTER TABLE english_words DROP COLUMN strict_case; ALTER TABLE word_study_items DROP COLUMN strict_case');
    db.pragma('user_version = 37');
  });
  await ctx.app.backupService.restore(legacy);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(book.getWord(word.id).strict_case, false);
  assert.equal(study.describeDay(first.id).batches[0].items[0].strict_case, false, 'legacy rules stay case-insensitive');
  for (const table of ['english_words', 'word_study_items']) {
    await assert.rejects(() => ctx.app.backupService.restore(candidate(db => db.exec(`ALTER TABLE ${table} DROP COLUMN strict_case`))), /备份缺少英语大小写规则/);
    assert.equal(book.getWord(word.id).word, 'Mayflower');
    assert.equal(book.getWord(word.id).strict_case, false);
  }
  await assert.rejects(() => ctx.app.backupService.restore(candidate(db => {
    db.pragma('ignore_check_constraints = ON');
    db.exec('UPDATE english_words SET strict_case = 2');
  })));
  assert.equal(book.getWord(word.id).strict_case, false);
});

test('v38 migration rolls back both new columns and the version if the second alteration fails', t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  ctx.db.exec('ALTER TABLE english_words DROP COLUMN strict_case; ALTER TABLE word_study_items DROP COLUMN strict_case');
  ctx.db.pragma('user_version = 37');
  const failing = new Proxy(ctx.db, { get(target, key) {
    if (key === 'exec') return sql => {
      if (sql.includes('ALTER TABLE word_study_items ADD COLUMN strict_case')) throw new Error('injected v38 failure');
      return target.exec(sql);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.throws(() => initDb(failing), /injected v38 failure/);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 37);
  for (const table of ['english_words', 'word_study_items']) assert.equal(ctx.db.pragma(`table_info(${table})`).some(column => column.name === 'strict_case'), false);
  assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
  initDb(ctx.db);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
});
