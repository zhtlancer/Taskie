const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { initDb, SCHEMA_VERSION } = require('../src/db');
const { extractDslSummary } = require('../src/services/dictionary/dsl-parser');

const senses = () => [
  { id: 'finance', pos: 'n.', definition_zh: '银行', definition_en: 'a financial institution', example: 'I went to the bank.',
    source: { dict_id: 'bgl', name: '英汉词典', headword: 'bank' } },
  { id: 'river', pos: 'n.', definition_zh: '河岸', example: 'We sat on the river bank.' }
];

test('structured senses, legacy edits, primary-only selection, search and authorization stay consistent', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, englishWordsService: book } = ctx.app.services;
  const child = childrenService.createChild({ name: '多义项' });
  const other = childrenService.createChild({ name: '其他孩子' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() })}` };
  const send = (method, suffix, payload) => ctx.app.inject({ method, url: `/api/english-words${suffix}`, headers, payload: method === 'PUT' ? { expected_version: ctx.app.services.englishWordsService.getWord(suffix.slice(1))?.version, ...payload } : payload });
  const created = await send('POST', '', { child_id: child.id, word: 'bank', senses: senses(), primary_sense_id: 'finance' });
  assert.equal(created.statusCode, 201);
  const first = created.json();
  assert.equal(first.definition_zh, '银行');
  assert.equal(first.senses[0].example, 'I went to the bank.');
  assert.equal(first.senses[0].source.name, '英汉词典');
  assert.equal(book.listWords({ child_id: child.id, search: '河岸' })[0].id, first.id);
  const selected = await send('PUT', `/${first.id}`, { primary_sense_id: 'river' });
  assert.equal(selected.json().definition_zh, '河岸');
  assert.equal(selected.json().definition_en, null);
  const edited = await send('PUT', `/${first.id}`, { definition_zh: '河边', note: '学校教材' });
  assert.equal(edited.statusCode, 200);
  assert.equal(edited.json().senses[1].definition_zh, '河边', 'old clients update only the current primary sense');
  assert.equal(edited.json().senses[0].definition_zh, '银行');
  assert.equal(edited.json().senses[1].example, 'We sat on the river bank.');
  const legacy = await send('POST', '', { child_id: child.id, word: 'book', definition_zh: '书' });
  assert.equal(legacy.json().senses.length, 1);
  assert.equal(legacy.json().senses[0].definition_zh, '书');

  for (const invalid of [
    { senses: [] }, { senses: {} }, { senses: Array.from({ length: 31 }, (_, i) => ({ id: `s${i}` })) },
    { senses: [{ id: 'repeat' }, { id: 'repeat' }] }, { senses: [{ id: 'bad id' }] },
    { senses: [{ definition_zh: 42 }] }, { senses: [{ definition_zh: 'x'.repeat(401) }] },
    { senses: [{ source: 'bgl' }] }, { primary_sense_id: 'missing' },
    { senses: [{ id: 'only' }], primary_sense_id: 'finance' }
  ]) {
    assert.equal((await send('PUT', `/${first.id}`, invalid)).statusCode, 400, JSON.stringify(invalid));
    assert.equal(book.getWord(first.id).definition_zh, '河边');
  }
  const foreign = await ctx.app.inject({ method: 'PUT', url: `/api/english-words/${first.id}`, headers: {
    authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: other.id, epoch: ctx.app.sessionEpoch() })}`
  }, payload: { senses: senses(), primary_sense_id: 'finance' } });
  assert.equal(foreign.statusCode, 403);
  const invalidBatch = await send('POST', '/batch', { child_id: child.id, items: [
    { word: 'apple', senses: senses() }, { word: 'tree', senses: [] }
  ] });
  assert.equal(invalidBatch.statusCode, 400);
  assert.equal(book.listWords({ child_id: child.id }).length, 2);
  const batch = await send('POST', '/batch', { child_id: child.id, items: [
    { word: 'tree', senses: senses(), primary_sense_id: 'river' }, { word: 'bank', definition_zh: '不能覆盖' }
  ] });
  assert.equal(batch.statusCode, 201);
  assert.equal(batch.json().added[0].definition_zh, '河岸');
  assert.deepEqual(batch.json().skipped, ['bank']);
  assert.equal(book.getWord(first.id).definition_zh, '河边');
});

test('both skills snapshot the selected sense; later days use the new sense', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-16', '12:00:00')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const { childrenService, englishWordsService: book, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '学习释义快照' });
  const word = book.createWord({ child_id: child.id, word: 'bank', senses: senses(), primary_sense_id: 'finance' });
  for (const skill of ['recognize', 'write']) study.savePlan(child.id, skill, { days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 1, review_target: 1 }, 'en');
  const days = study.today(child.id, 'en').days;
  book.updateWord(word.id, { expected_version: book.getWord(word.id).version, primary_sense_id: 'river' });
  for (const day of days) {
    const item = study.describeDay(day.id).batches[0].items[0];
    assert.equal(item.meaning_zh, '银行');
    assert.equal(item.meaning_en, 'a financial institution');
    study.grade(item.id, { result: 'good', request_id: `sense-${item.id}` }, 'child');
  }
  t.mock.timers.tick(86400000);
  for (const day of study.today(child.id, 'en').days) {
    const item = day.batches[0].items[0];
    assert.equal(item.meaning_zh, '河岸');
    assert.equal(item.meaning_en, null);
  }
});

test('current sense backups round-trip, v38 definitions migrate, corrupt v39 data is rejected atomically', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, englishWordsService: book } = ctx.app.services;
  const child = childrenService.createChild({ name: '备份义项' });
  const word = book.createWord({ child_id: child.id, word: 'bank', senses: senses(), primary_sense_id: 'river' });
  const backup = await ctx.app.backupService.create('manual');
  const archive = fs.readFileSync(path.join(ctx.app.backupService.backupDir, backup.name));
  const parsed = JSON.parse(zlib.gunzipSync(archive));
  const candidate = mutate => {
    const db = new Database(Buffer.from(parsed.database, 'base64'));
    try { mutate(db); return zlib.gzipSync(JSON.stringify({ ...parsed, database: db.serialize().toString('base64') })); }
    finally { db.close(); }
  };
  book.updateWord(word.id, { expected_version: book.getWord(word.id).version, primary_sense_id: 'finance' });
  await ctx.app.backupService.restore(archive);
  assert.deepEqual(book.getWord(word.id).senses, word.senses);
  assert.equal(book.getWord(word.id).primary_sense_id, 'river');
  for (const mutate of [
    db => db.exec('ALTER TABLE english_words DROP COLUMN senses'),
    db => db.exec('ALTER TABLE english_words DROP COLUMN primary_sense_id'),
    db => db.prepare('UPDATE english_words SET senses = ?').run('invalid json'),
    db => db.prepare('UPDATE english_words SET senses = ?').run('[]'),
    db => db.prepare('UPDATE english_words SET primary_sense_id = ?').run('missing'),
    db => db.prepare('UPDATE english_words SET definition_zh = ?').run('不一致'),
    db => db.prepare('UPDATE english_words SET senses = ?').run(JSON.stringify([{ ...word.senses[0], id: undefined }]))
  ]) {
    await assert.rejects(() => ctx.app.backupService.restore(candidate(mutate)), /英语义项/);
    assert.equal(book.getWord(word.id).definition_zh, '河岸');
  }
  await ctx.app.backupService.restore(candidate(db => {
    db.exec('ALTER TABLE english_words DROP COLUMN senses; ALTER TABLE english_words DROP COLUMN primary_sense_id');
    db.pragma('user_version = 38');
  }));
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(book.getWord(word.id).senses.length, 1);
  assert.equal(book.getWord(word.id).senses[0].definition_zh, '河岸');
  assert.equal(book.getWord(word.id).senses[0].source, null, 'do not invent legacy dictionary provenance');
});

test('v39 migration rolls back columns and version on failure and can retry', t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  ctx.db.exec('ALTER TABLE english_words DROP COLUMN senses; ALTER TABLE english_words DROP COLUMN primary_sense_id');
  ctx.db.pragma('user_version = 38');
  const broken = new Proxy(ctx.db, { get(target, key) {
    if (key === 'exec') return sql => {
      if (sql.includes('ADD COLUMN primary_sense_id')) throw new Error('injected v39 failure');
      return target.exec(sql);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.throws(() => initDb(broken), /injected v39/);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 38);
  assert.equal(ctx.db.pragma('table_info(english_words)').some(column => column.name === 'senses'), false);
  initDb(ctx.db);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
});

test('dictionary extraction exposes individual definitions while keeping the short summary stable', () => {
  const result = extractDslSummary('[m0][c orange] noun[/c][/m]\n[m1]{{d}}a financial institution{{/d}}[/m]\n[m1]{{d}}the side of a river{{/d}}[/m]\n[m1]{{d}}a store of something{{/d}}[/m]', 'oald8');
  assert.deepEqual(result.definitions, ['a financial institution', 'the side of a river', 'a store of something']);
  assert.equal(result.short_en, 'a financial institution; the side of a river');
  const mw = extractDslSummary('[trn]:one[/trn]\n[trn]:two[/trn]\n[trn]:three[/trn]', 'mw11');
  assert.deepEqual(mw.definitions, ['one', 'two', 'three']);
});

test('valid multi-sense batches larger than the default JSON body limit can be imported', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: '批量义项容量' });
  const items = Array.from({ length: 10 }, (_, n) => ({ word: `volume${n}`, senses: Array.from({ length: 30 }, (_, i) => ({
    id: `s${i}`, definition_zh: '中'.repeat(400), definition_en: '文'.repeat(400), example: '例'.repeat(600)
  })) }));
  assert.ok(Buffer.byteLength(JSON.stringify({ child_id: child.id, items })) > 1024 * 1024);
  const response = await ctx.app.inject({ method: 'POST', url: '/api/english-words/batch', headers: {
    authorization: `Bearer ${ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() })}`
  }, payload: { child_id: child.id, items } });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().added.length, 10);
  assert.equal(response.json().added[0].senses.length, 30);
});
