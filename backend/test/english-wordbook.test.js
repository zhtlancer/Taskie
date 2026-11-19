const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const Database = require('better-sqlite3');

const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { SCHEMA_VERSION } = require('../src/db');
const { getTodayDate, shiftDate } = require('../src/utils/date');

const authHeader = (app, claims) => ({
  authorization: `Bearer ${app.jwt.sign({ ...claims, epoch: app.sessionEpoch() })}`
});

function createSyntheticDictDir(root) {
  const dictDir = path.join(root, 'dicts');
  fs.mkdirSync(dictDir, { recursive: true });
  const oaldText = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([
      'apple',
      '\t[m0][b]apple[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[ˈæpl\\][/c] [s]z_apple_gb.wav[/s][/m]',
      '\t[m1]{{d}}a round sweet fruit{{/d}}[/m]',
      'banana',
      '\t[m0][b]banana[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[bəˈnɑːnə\\][/c][/m]',
      '\t[m1]{{d}}a long yellow fruit{{/d}}[/m]'
    ].join('\n'), 'utf16le')
  ]);
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl.dz'), zlib.gzipSync(oaldText));
  return dictDir;
}

test('English wordbook CRUD, case variants, normalization and batch import preview', async t => {
  const tmpDictRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-en-dict-'));
  t.after(() => fs.rmSync(tmpDictRoot, { recursive: true, force: true }));
  const dictDir = createSyntheticDictDir(tmpDictRoot);
  const ctx = createTestApp({ dictDir, dictCacheDir: path.join(tmpDictRoot, 'cache') });
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();

  const parentHeaders = authHeader(ctx.app, { role: 'parent' });
  const child = ctx.app.services.childrenService.createChild({ name: '英语同学' });
  const childHeaders = authHeader(ctx.app, { role: 'child', child_id: child.id });

  // Dictionary lookup & rebuild index
  const rebuildRes = await ctx.app.inject({ method: 'POST', url: '/api/dictionary/rebuild-index', headers: parentHeaders });
  assert.equal(rebuildRes.statusCode, 200);
  const lookupRes = await ctx.app.inject({ method: 'GET', url: '/api/dictionary/lookup?word=apple', headers: childHeaders });
  assert.equal(lookupRes.statusCode, 200);
  const lookup = lookupRes.json();
  assert.equal(lookup.exact_matches[0].word, 'apple');
  assert.equal(lookup.exact_matches[0].phonetic_uk, 'ˈæpl');

  // Original dictionary article fetch
  const artRes = await ctx.app.inject({ method: 'GET', url: '/api/dictionary/article?word=apple&dict_id=all', headers: childHeaders });
  assert.equal(artRes.statusCode, 200);
  assert.equal(artRes.json().articles[0].dict_id, 'oald8');

  // Child cannot call rebuild-index
  const childRebuild = await ctx.app.inject({ method: 'POST', url: '/api/dictionary/rebuild-index', headers: childHeaders });
  assert.equal(childRebuild.statusCode, 403);

  // Add May and may (case-sensitive distinct) + don’t -> normalized don't duplicate
  const r1 = await ctx.app.inject({
    method: 'POST', url: '/api/english-words', headers: childHeaders,
    payload: { child_id: child.id, word: 'May', definition_zh: '五月', categories: ['recognize'] }
  });
  assert.equal(r1.statusCode, 201);

  const r2 = await ctx.app.inject({
    method: 'POST', url: '/api/english-words', headers: childHeaders,
    payload: { child_id: child.id, word: 'may', definition_zh: '可以', confirmed_case_variants: ['May'] }
  });
  assert.equal(r2.statusCode, 201);

  const r3 = await ctx.app.inject({
    method: 'POST', url: '/api/english-words', headers: childHeaders,
    payload: { child_id: child.id, word: "don't", definition_zh: '不要' }
  });
  assert.equal(r3.statusCode, 201);

  const dupSmartQuote = await ctx.app.inject({
    method: 'POST', url: '/api/english-words', headers: childHeaders,
    payload: { child_id: child.id, word: 'don’t', definition_zh: '重复' }
  });
  assert.equal(dupSmartQuote.statusCode, 409);

  // Categories permission: child can add, only parent can remove or delete categorized word
  const addCat = await ctx.app.inject({
    method: 'PUT', url: `/api/english-words/${r2.json().id}/categories`, headers: childHeaders,
    payload: { categories: ['write'] }
  });
  assert.equal(addCat.statusCode, 200);
  const childRemoveCat = await ctx.app.inject({
    method: 'PUT', url: `/api/english-words/${r2.json().id}/categories`, headers: childHeaders,
    payload: { categories: [] }
  });
  assert.equal(childRemoveCat.statusCode, 403);
  const childDeleteCat = await ctx.app.inject({
    method: 'DELETE', url: `/api/english-words/${r2.json().id}`, headers: childHeaders
  });
  assert.equal(childDeleteCat.statusCode, 403);

  // Batch preview & commit import
  const previewRes = await ctx.app.inject({
    method: 'POST', url: '/api/english-words/batch-preview', headers: childHeaders,
    payload: { child_id: child.id, text: 'apple\nMay\nunknownword\n1234' }
  });
  assert.equal(previewRes.statusCode, 200);
  const preview = previewRes.json().items;
  assert.equal(preview.find(i => i.word === 'apple').status, 'matched');
  assert.equal(preview.find(i => i.word === 'May').status, 'duplicate');
  assert.equal(preview.find(i => i.word === 'unknownword').status, 'manual');
  assert.equal(preview.find(i => i.word === '1234').status, 'invalid');

  const commitRes = await ctx.app.inject({
    method: 'POST', url: '/api/english-words/batch', headers: parentHeaders,
    payload: {
      child_id: child.id,
      textbook: '人教版三年级',
      unit: 'Unit 1',
      items: [
        { word: 'apple', phonetic_uk: 'ˈæpl', definition_zh: '苹果', definition_en: 'a round sweet fruit' },
        { word: 'look   after', definition_zh: '照顾' }
      ]
    }
  });
  assert.equal(commitRes.statusCode, 201);
  assert.equal(commitRes.json().added.length, 2);

  // Update word
  const editRes = await ctx.app.inject({
    method: 'PUT', url: `/api/english-words/${commitRes.json().added[0].id}`, headers: childHeaders,
    payload: { note: '记得加 s' }
  });
  assert.equal(editRes.statusCode, 200);
  assert.equal(editRes.json().note, '记得加 s');
});

test('English textbooks and units are parent-only across create, edit and batch requests', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: '教材权限' });
  const parent = authHeader(ctx.app, { role: 'parent' });
  const student = authHeader(ctx.app, { role: 'child', child_id: child.id });
  const send = (method, url, payload, headers = student) => ctx.app.inject({ method, url: `/api/english-words${url}`, payload, headers });
  for (const key of ['textbook', 'unit']) {
    const blocked = await send('POST', '', { child_id: child.id, word: 'blocked', [key]: 'U1' });
    assert.equal(blocked.statusCode, 403);
    assert.match(blocked.json().error, /只有家长/);
  }
  const created = await send('POST', '', { child_id: child.id, word: 'apple', textbook: ' PEP ', unit: ' U1 ', definition_zh: '苹果' }, parent);
  assert.equal(created.statusCode, 201);
  const entry = created.json();
  const edited = await send('PUT', `/${entry.id}`, { textbook: 'PEP', unit: ' U1 ', definition_zh: '孩子修改释义' });
  assert.equal(edited.statusCode, 200, 'child may submit unchanged metadata while editing ordinary fields');
  for (const payload of [{ textbook: 'other' }, { unit: 'U2' }, { textbook: '' }, { unit: null }]) {
    assert.equal((await send('PUT', `/${entry.id}`, payload)).statusCode, 403);
  }
  for (const payload of [
    { textbook: 'PEP', items: [{ word: 'book' }] },
    { unit: 'U1', items: [{ word: 'book' }] },
    { items: [{ word: 'book' }, { word: 'desk', textbook: 'PEP' }] },
    { items: [{ word: 'book' }, { word: 'desk', unit: 'U1' }] }
  ]) {
    assert.equal((await send('POST', '/batch', { child_id: child.id, ...payload })).statusCode, 403);
    assert.equal(ctx.app.services.englishWordsService.listWords({ child_id: child.id }).length, 1, 'batch rejection leaves no partial inserts');
  }
  const own = await send('POST', '', { child_id: child.id, word: 'plain', textbook: '', unit: null, note: '自己收录' });
  assert.equal(own.statusCode, 201);
  assert.equal((await send('PUT', `/${own.json().id}`, { unit: 'U1' })).statusCode, 403);
  assert.equal((await send('POST', '/batch', { child_id: child.id, items: [{ word: 'book', definition_zh: '书' }] })).statusCode, 201);
  assert.equal((await send('PUT', `/${entry.id}`, { textbook: null, unit: 'U2' }, parent)).statusCode, 200);
  const batch = await send('POST', '/batch', { child_id: child.id, textbook: 'PEP', unit: 'U2', items: [{ word: 'desk', unit: 'U3' }] }, parent);
  assert.equal(batch.statusCode, 201);
  assert.equal(batch.json().added[0].unit, 'U3');
});

test('new English plans default to three words without overwriting parent targets', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: '每日目标' });
  const parent = authHeader(ctx.app, { role: 'parent' });
  const student = authHeader(ctx.app, { role: 'child', child_id: child.id });
  for (const skill of ['recognize', 'write']) {
    const url = `/api/children/${child.id}/word-study/en/plans/${skill}`;
    const save = (payload, headers = parent) => ctx.app.inject({ method: 'PUT', url, payload, headers });
    assert.equal((await save({}, student)).statusCode, 403);
    assert.equal((await save({})).statusCode, 200);
    const plan = () => ctx.app.services.wordStudyService.plans(child.id, 'en').find(p => p.skill === skill);
    assert.equal(plan().new_target, 3);
    assert.equal((await save({ new_target: 5 })).statusCode, 200);
    assert.equal((await save({ points: 12 })).statusCode, 200);
    assert.equal(plan().new_target, 5);
    assert.equal((await save({ new_target: 0, review_target: 10 })).statusCode, 200);
    assert.equal((await save({ new_target: 0, review_target: 0 })).statusCode, 400);
  }
});

test('English wordbook enforces cross-child ownership', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();

  const childA = ctx.app.services.childrenService.createChild({ name: 'A' });
  const childB = ctx.app.services.childrenService.createChild({ name: 'B' });
  const aHeaders = authHeader(ctx.app, { role: 'child', child_id: childA.id });
  const bHeaders = authHeader(ctx.app, { role: 'child', child_id: childB.id });

  const created = ctx.app.services.englishWordsService.createWord({
    child_id: childA.id, word: 'peach', definition_zh: '桃子'
  });

  for (const req of [
    { method: 'GET', url: `/api/english-words?child_id=${childA.id}`, headers: bHeaders },
    { method: 'GET', url: `/api/english-words/taxonomy?child_id=${childA.id}`, headers: bHeaders },
    { method: 'POST', url: '/api/english-words', headers: bHeaders, payload: { child_id: childA.id, word: 'pear' } },
    { method: 'POST', url: '/api/english-words/batch-preview', headers: bHeaders, payload: { child_id: childA.id, text: 'pear' } },
    { method: 'PUT', url: `/api/english-words/${created.id}`, headers: bHeaders, payload: { note: 'hack' } },
    { method: 'DELETE', url: `/api/english-words/${created.id}`, headers: bHeaders },
    { method: 'GET', url: `/api/children/${childA.id}/word-study?language=en`, headers: bHeaders },
    { method: 'PUT', url: `/api/children/${childA.id}/word-study/fr/plans/recognize`, headers: aHeaders, payload: { enabled: true } }
  ]) {
    const res = await ctx.app.inject(req);
    assert.equal(res.statusCode, 403, `${req.method} ${req.url} should forbid unauthorized actor`);
  }

  const ok = await ctx.app.inject({ method: 'GET', url: `/api/english-words?child_id=${childA.id}`, headers: aHeaders });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().length, 1);
});

test('English word study schedules Unit-filtered plans, skips empty definitions, creates 英语 tasks and awards points', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-12', '12:00:00')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();

  const { childrenService, englishWordsService: enBook, charactersService: zhBook, wordStudyService: study, tasksService: tasks } = ctx.app.services;
  const child = childrenService.createChild({ name: '双语学习' });
  const zhChar = zhBook.createCharacter({ child_id: child.id, char: '学', pinyin: 'xué' });
  ctx.db.prepare('UPDATE characters SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-10', '10:00:00'), zhChar.id);

  const w1 = enBook.createWord({ child_id: child.id, word: 'book', phonetic_uk: 'bʊk', definition_zh: '书', textbook: 'PEP', unit: 'Unit 1', categories: ['write'] }, { role: 'parent' });
  const w2 = enBook.createWord({ child_id: child.id, word: 'desk', definition_zh: '', definition_en: '', textbook: 'PEP', unit: 'Unit 1', categories: ['write'] }, { role: 'parent' });
  const w3 = enBook.createWord({ child_id: child.id, word: 'tree', definition_zh: '树', textbook: 'PEP', unit: 'Unit 2', categories: ['write'] }, { role: 'parent' });
  for (const id of [w1.id, w2.id, w3.id]) {
    ctx.db.prepare('UPDATE english_words SET created_at = ? WHERE id = ?').run(familyInstant('2026-10-10', '10:00:00'), id);
  }

  // Bilingual plans coexist independently on the same child!
  study.savePlan(child.id, 'recognize', { new_target: 1, review_target: 1, points: 5 }, 'zh');
  study.savePlan(child.id, 'write', {
    language: 'en',
    new_target: 5,
    review_target: 5,
    points: 12,
    textbook: 'PEP',
    units: ['Unit 1'],
    categories: ['write']
  }, 'en');

  const enToday = study.today(child.id, 'en');
  assert.equal(enToday.days.length, 1);
  assert.equal(enToday.missing_definition_count, 1);
  const enDay = enToday.days[0];
  assert.equal(enDay.language, 'en');
  assert.equal(enDay.excluded_no_definition, 1);
  // Only w1 (has definition + Unit 1); w2 excluded (no definition); w3 excluded (Unit 2)
  assert.deepEqual(enDay.batches[0].items.map(i => i.english_word_id), [w1.id]);
  assert.equal(enDay.batches[0].items[0].meaning_zh, '书');

  // Verify daily_tasks includes both 语文 and 英语 tasks
  const daily = tasks.getDailyTasks(child.id, getTodayDate());
  assert.ok(daily.some(dt => dt.subject === '语文' && dt.title === '字词认读学习'));
  assert.ok(daily.some(dt => dt.subject === '英语' && dt.title === '英语单词默写'));

  // Complete English spelling item and verify spaced repetition state + points
  const graded = study.grade(enDay.batches[0].items[0].id, { result: 'good', request_id: 'en-grade-req-1' }, 'child');
  assert.equal(graded.points_earned, 12);
  const state = ctx.db.prepare('SELECT * FROM word_study_states WHERE english_word_id = ? AND skill = ?').get(w1.id, 'write');
  assert.equal(state.stage, 0);
  assert.equal(state.next_due_date, shiftDate(getTodayDate(), 1));
  assert.equal(state.language, 'en');
});

test('backup & restore upgrades v35 backups, preserves current English words & plans, and rejects corrupted files', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-21')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();

  const { childrenService, englishWordsService: enBook, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '备份测试' });
  enBook.createWord({ child_id: child.id, word: 'May', phonetic: 'meɪ', definition_zh: '五月', unit: 'U1' }, { role: 'parent' });
  // This backup fixture needs study progress even on weekends; weekday scheduling has separate tests.
  study.savePlan(child.id, 'recognize', {
    days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 2, review_target: 2, points: 8, units: ['U1']
  }, 'en');
  const enDay = study.today(child.id, 'en').days[0];
  study.grade(enDay.batches[0].items[0].id, { result: 'good', request_id: 'backup-req-1' }, 'child');

  const created = await ctx.app.backupService.create('manual');
  const archive = fs.readFileSync(path.join(ctx.app.backupService.backupDir, created.name));

  // Wiping current data and restoring v36 backup restores English word & study progress cleanly
  ctx.db.prepare('DELETE FROM children').run();
  assert.equal(enBook.listWords({ child_id: child.id }).length, 0);

  await ctx.app.backupService.restore(archive);
  const restoredWords = enBook.listWords({ child_id: child.id });
  assert.equal(restoredWords.length, 1);
  assert.equal(restoredWords[0].word, 'May');
  assert.equal(study.history(child.id, 'en').length, 1);

  // Corrupted backup must be rejected cleanly without deleting live data
  await assert.rejects(() => ctx.app.backupService.restore(Buffer.from('not-a-valid-gzip')));
  assert.equal(enBook.listWords({ child_id: child.id }).length, 1);

  // Simulate upgrading a legacy v35 JSON+gzip backup lacking english_words & language columns
  const parsed = JSON.parse(zlib.gunzipSync(archive));
  const legacyDb = new Database(Buffer.from(parsed.database, 'base64'));
  legacyDb.pragma('foreign_keys = OFF');
  legacyDb.exec(`
    DELETE FROM point_logs;
    DELETE FROM daily_tasks;
    DELETE FROM word_study_attempts;
    DELETE FROM word_study_items;
    DELETE FROM word_study_batches;
    DELETE FROM word_study_days;
    DELETE FROM word_study_states;
    DELETE FROM word_study_plans;
    DROP TABLE english_words;
    CREATE TABLE old_plans (
      id TEXT PRIMARY KEY, child_id TEXT NOT NULL, skill TEXT NOT NULL, enabled INTEGER NOT NULL,
      start_date TEXT NOT NULL, days_of_week TEXT NOT NULL, categories TEXT NOT NULL, include_mastered INTEGER NOT NULL,
      new_target INTEGER NOT NULL, review_target INTEGER NOT NULL, required INTEGER NOT NULL, points INTEGER NOT NULL,
      extra_points INTEGER NOT NULL, extra_reward_limit INTEGER NOT NULL, last_scheduled_date TEXT, created_at TEXT NOT NULL
    );
    DROP TABLE word_study_plans;
    ALTER TABLE old_plans RENAME TO word_study_plans;
    INSERT INTO word_study_plans VALUES ('p-old', '${child.id}', 'recognize', 1, '2026-01-01', '[1,2,3,4,5]', '[]', 0, 3, 10, 1, 10, 0, 0, NULL, '2026-01-01T00:00:00Z');
  `);
  legacyDb.pragma('user_version = 35');
  const v35Archive = zlib.gzipSync(JSON.stringify({ ...parsed, database: legacyDb.serialize().toString('base64') }));
  legacyDb.close();

  await ctx.app.backupService.restore(v35Archive);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(ctx.app.services.wordStudyService.plans(child.id, 'zh').length, 1);
  assert.equal(ctx.app.services.englishWordsService.listWords({ child_id: child.id }).length, 0);
});

test('English batch preview preserves TSV meanings, punctuation, phrases and existing entries', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const { childrenService, englishWordsService: book } = ctx.app.services;
  const child = childrenService.createChild({ name: '表格导入' });
  book.createWord({ child_id: child.id, word: "don't", definition_zh: '原来的释义' });
  const dictionaryService = { lookup: async word => ({ exact_matches: word === 'pear'
    ? [{ word, definition_zh: '词典释义', definition_en: 'a fruit', phonetic: 'peə' }] : [], suggestions: [] }) };
  const { items } = await book.batchPreview(child.id,
    "pear\t梨，水果；教材释义\nlook   after\t照顾,照料\ndon’t\t不要覆盖\napple,book\n\t缺英文\ncat\t猫\t多余列", { dictionaryService });
  assert.equal(items.find(i => i.word === 'pear').definition_zh, '梨，水果；教材释义');
  assert.equal(items.find(i => i.word === 'pear').phonetic, 'peə');
  assert.equal(items.find(i => i.word === 'look after').definition_zh, '照顾,照料');
  assert.equal(items.find(i => i.word === "don't").status, 'duplicate');
  assert.equal(items.filter(i => i.status === 'invalid').length, 2);
  const selected = items.filter(i => ['matched', 'manual'].includes(i.status));
  assert.deepEqual(selected.map(i => i.word), ['pear', 'look after', 'apple', 'book']);
  book.batchImport(child.id, { items: selected });
  const saved = book.listWords({ child_id: child.id });
  assert.equal(saved.find(i => i.word === 'pear').definition_zh, '梨，水果；教材释义');
  assert.equal(saved.find(i => i.word === "don't").definition_zh, '原来的释义');
});

test('English daily filter snapshots survive plan edits and backup restore; next day uses new filters', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-10-12')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, englishWordsService: book, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '范围快照' });
  for (const [word, textbook, unit] of [['apple', 'PEP', 'U1'], ['book', 'PEP', 'U1'],
    ['cat', 'PEP', 'U2'], ['dog', 'Other', 'U1']]) {
    book.createWord({ child_id: child.id, word, textbook, unit, definition_zh: `${word}释义` }, { role: 'parent' });
  }
  study.savePlan(child.id, 'recognize', { days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 1,
    review_target: 1, textbook: 'PEP', units: ['U1'] }, 'en');
  const day = study.today(child.id, 'en').days[0];
  study.grade(day.batches[0].items[0].id, { result: 'good', request_id: 'snapshot-grade-base' }, 'child');
  study.savePlan(child.id, 'recognize', { textbook: 'Other', units: ['U1'] }, 'en');
  const backup = await ctx.app.backupService.create('manual');
  await ctx.app.backupService.restore(fs.readFileSync(path.join(ctx.app.backupService.backupDir, backup.name)));
  const extra = study.extra(day.id, 'snapshot-extra-request');
  assert.equal(extra.textbook, 'PEP');
  assert.deepEqual(JSON.parse(extra.units), ['U1']);
  const remainingU1 = ['apple', 'book'].filter(word => !day.batches[0].items.some(i => i.text === word));
  assert.deepEqual(extra.batches.filter(b => b.is_extra).flatMap(b => b.items.map(i => i.text)), remainingU1);
  // Unit edits likewise affect only subsequent lists.
  study.savePlan(child.id, 'recognize', { textbook: 'PEP', units: ['U2'] }, 'en');
  assert.equal(study.describeDay(day.id).textbook, 'PEP');
  assert.deepEqual(JSON.parse(study.describeDay(day.id).units), ['U1']);
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  const next = study.today(child.id, 'en').days[0];
  assert.deepEqual(next.batches[0].items.map(i => i.text), ['cat']);
});

test('v36 restores freeze effective filters; malformed v36/v37 backups are rejected without changing live data', async t => {
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  await ctx.app.ready();
  const { childrenService, englishWordsService: book, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '备份校验' });
  const word = book.createWord({ child_id: child.id, word: 'pear', definition_zh: '梨', textbook: 'PEP', unit: 'U1' }, { role: 'parent' });
  const created = await ctx.app.backupService.create('manual');
  const parsed = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ctx.app.backupService.backupDir, created.name))));
  const makeArchive = (version, mutate) => {
    const candidate = new Database(Buffer.from(parsed.database, 'base64'));
    try {
      candidate.pragma('foreign_keys = OFF');
      mutate(candidate);
      candidate.pragma(`user_version = ${version}`);
      return zlib.gzipSync(JSON.stringify({ ...parsed, database: candidate.serialize().toString('base64') }));
    } finally { candidate.close(); }
  };
  for (const [version, sql] of [
    [36, 'DROP TABLE english_words'],
    [36, 'ALTER TABLE english_words DROP COLUMN phonetic'],
    [36, 'ALTER TABLE word_study_plans DROP COLUMN units'],
    [36, 'ALTER TABLE word_study_days DROP COLUMN language'],
    [36, 'ALTER TABLE word_study_items DROP COLUMN meaning_zh'],
    [37, 'ALTER TABLE word_study_days DROP COLUMN units']
  ]) {
    await assert.rejects(() => ctx.app.backupService.restore(makeArchive(version, db => db.exec(sql))), /备份缺少/);
    assert.equal(book.getWord(word.id).definition_zh, '梨');
    assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  }
  study.savePlan(child.id, 'recognize', { textbook: 'PEP', units: ['U1'], days_of_week: [0,1,2,3,4,5,6] }, 'en');
  const day = study.today(child.id, 'en').days[0];
  const v36 = new Database(ctx.db.serialize());
  v36.exec('ALTER TABLE word_study_days DROP COLUMN textbook; ALTER TABLE word_study_days DROP COLUMN units');
  v36.pragma('user_version = 36');
  const legacy = zlib.gzipSync(JSON.stringify({ ...parsed, database: v36.serialize().toString('base64') }));
  v36.close();
  await ctx.app.backupService.restore(legacy);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(study.describeDay(day.id).textbook, 'PEP');
  assert.deepEqual(JSON.parse(study.describeDay(day.id).units), ['U1']);
  assert.equal(book.getWord(word.id).definition_zh, '梨');
});
