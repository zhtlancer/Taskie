const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp, familyInstant } = require('./helper');
const { initDb, SCHEMA_VERSION } = require('../src/db');
const { STATE_SOURCE_CHECK, ITEM_SOURCE_CHECK, validateWordStudyConstraints } = require('../src/db/word-study-constraints');

// Recreate the actual v39 source rules, including SET NULL states and no source CHECK.
function downgrade(db) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const [table, check] of [['word_study_states', STATE_SOURCE_CHECK], ['word_study_items', ITEM_SOURCE_CHECK]]) {
        let sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
        sql = sql.replace(check, 'CHECK (1)').replace(`"${table}"`, `${table}_old`).replace(`CREATE TABLE ${table} (`, `CREATE TABLE ${table}_old (`);
        if (table === 'word_study_states') sql = sql
          .replace('REFERENCES characters(id) ON DELETE CASCADE', 'REFERENCES characters(id) ON DELETE SET NULL')
          .replace('REFERENCES english_words(id) ON DELETE CASCADE', 'REFERENCES english_words(id) ON DELETE SET NULL');
        db.exec(sql);
        db.exec(`INSERT INTO ${table}_old SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_old RENAME TO ${table}`);
      }
      db.exec('ALTER TABLE word_study_items DROP COLUMN audio_refs');
      db.exec('CREATE INDEX idx_word_study_due ON word_study_states(child_id, language, skill, next_due_date); CREATE INDEX idx_word_study_items_batch ON word_study_items(batch_id, position)');
      db.pragma('user_version = 39');
    })();
  } finally { db.pragma('foreign_keys = ON'); }
}

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(familyInstant('2026-11-16')) });
  const ctx = createTestApp();
  t.after(() => cleanupTestApp(ctx));
  const { childrenService, englishWordsService: book, charactersService: chars, wordStudyService: study } = ctx.app.services;
  const child = childrenService.createChild({ name: '学习来源' });
  const word = book.createWord({ child_id: child.id, word: 'May', definition_zh: '五月', strict_case: true });
  const character = chars.createCharacter({ child_id: child.id, char: '山', pinyin: 'shān' });
  for (const language of ['zh', 'en']) for (const skill of ['recognize', 'write']) study.savePlan(child.id, skill, {
    days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 1, review_target: 1, points: 10
  }, language);
  const days = ['zh', 'en'].flatMap(language => study.today(child.id, language).days);
  for (const day of days.filter(day => day.skill === 'recognize')) {
    const item = day.batches[0].items[0];
    study.grade(item.id, { result: 'good', request_id: `initial-${item.id}` }, 'child');
  }
  return { ...ctx, child, word, character, book, chars, study, days };
}

test('SQLite rejects mixed, missing and language-mismatched state sources and keeps per-skill uniqueness', t => {
  const ctx = fixture(t);
  validateWordStudyConstraints(ctx.db);
  const en = ctx.db.prepare("SELECT * FROM word_study_states WHERE language = 'en'").get();
  const update = sql => ctx.db.prepare(`UPDATE word_study_states SET ${sql} WHERE id = ?`);
  assert.throws(() => update('character_id = ?').run(ctx.character.id, en.id), /CHECK constraint/);
  assert.throws(() => update('english_word_id = NULL').run(en.id), /CHECK constraint/);
  assert.throws(() => update("language = 'zh'").run(en.id), /CHECK constraint/);
  assert.throws(() => ctx.db.prepare(`INSERT INTO word_study_states
    SELECT 'duplicate', child_id, language, character_id, english_word_id, skill, stage, next_due_date, last_review_date, failures
    FROM word_study_states WHERE id = ?`).run(en.id), /UNIQUE constraint/);
  const item = ctx.db.prepare('SELECT * FROM word_study_items WHERE english_word_id IS NOT NULL LIMIT 1').get();
  assert.throws(() => ctx.db.prepare('UPDATE word_study_items SET character_id = ? WHERE id = ?').run(ctx.character.id, item.id), /CHECK constraint/);
  assert.throws(() => ctx.db.prepare('UPDATE word_study_items SET english_word_id = ? WHERE character_id IS NOT NULL').run(ctx.word.id), /CHECK constraint/);
});

test('removing either language deletes memory only, preserves snapshots and attempts, and never resurrects memory', async t => {
  const ctx = fixture(t);
  await ctx.app.ready();
  const before = ctx.db.prepare('SELECT * FROM word_study_items ORDER BY id').all();
  const attempts = ctx.db.prepare('SELECT * FROM word_study_attempts ORDER BY id').all();
  const other = ctx.app.services.childrenService.createChild({ name: '别人' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: other.id, epoch: ctx.app.sessionEpoch() })}` };
  for (const url of [`/api/english-words/${ctx.word.id}`, `/api/characters/${ctx.character.id}`]) {
    assert.equal((await ctx.app.inject({ method: 'DELETE', url, headers })).statusCode, 403);
  }
  for (const url of [`/api/english-words/${ctx.word.id}`, `/api/characters/${ctx.character.id}`]) {
    const response = await ctx.app.inject({ method: 'DELETE', url });
    assert.equal(response.statusCode, 200, response.body);
  }
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 0);
  assert.deepEqual(ctx.db.prepare('SELECT * FROM word_study_items ORDER BY id').all(), before.map(item => ({ ...item, character_id: null, english_word_id: null })));
  assert.deepEqual(ctx.db.prepare('SELECT * FROM word_study_attempts ORDER BY id').all(), attempts);
  for (const day of ctx.days.filter(day => day.skill === 'write')) {
    const item = day.batches[0].items[0];
    const result = { result: 'good', request_id: `detached-${item.id}` };
    ctx.study.grade(item.id, result, 'child');
    ctx.study.grade(item.id, result, 'child');
  }
  assert.equal(ctx.app.services.rewardsService.getTotalPoints(ctx.child.id), 40);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 0);
  const readded = ctx.book.createWord({ child_id: ctx.child.id, word: 'May', definition_zh: '五月' });
  assert.notEqual(readded.id, ctx.word.id);
  assert.equal(readded.study_progress.recognize.status, 'unlearned');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_items WHERE english_word_id = ?').get(readded.id).n, 0);
  t.mock.timers.tick(86400000);
  for (const day of ['zh', 'en'].flatMap(language => ctx.study.today(ctx.child.id, language).days)) {
    assert.equal(day.batches[0].items.length, day.language === 'en' ? 1 : 0);
    if (day.language === 'en') assert.equal(day.batches[0].items[0].english_word_id, readded.id);
  }
  assert.deepEqual(ctx.db.pragma('foreign_key_check'), []);
});

test('v39 upgrade cleans orphan states and retains every live state, history, reward and task reference', t => {
  const ctx = fixture(t);
  downgrade(ctx.db);
  ctx.book.deleteWord(ctx.word.id, { role: 'parent' });
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states WHERE character_id IS NULL AND english_word_id IS NULL').get().n, 1);
  const history = Object.fromEntries(['word_study_states', 'word_study_items', 'word_study_attempts', 'word_study_days', 'word_study_batches', 'daily_tasks', 'point_logs'].map(table => [table, ctx.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
  initDb(ctx.db);
  validateWordStudyConstraints(ctx.db);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  for (const [table, rows] of Object.entries(history)) assert.deepEqual(ctx.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), table === 'word_study_states' ? rows.filter(row => row.character_id || row.english_word_id)
    : table === 'word_study_items' ? rows.map(row => ({ ...row, audio_refs: null })) : rows, table);
  assert.deepEqual(ctx.db.pragma('foreign_key_check'), []);
  ctx.chars.deleteCharacter(ctx.character.id, { role: 'parent' });
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_attempts').get().n, 2);
});

test('v40 rebuild rolls back both tables, orphan cleanup and version after failure, then retries', t => {
  const ctx = fixture(t);
  downgrade(ctx.db);
  ctx.book.deleteWord(ctx.word.id, { role: 'parent' });
  const before = ctx.db.serialize();
  const broken = new Proxy(ctx.db, { get(target, key) {
    if (key === 'pragma') return (...args) => {
      if (args[0] === 'foreign_key_check') throw new Error('injected v40 failure');
      return target.pragma(...args);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.throws(() => initDb(broken), /injected v40 failure/);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 39);
  assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 2);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%_v40'").get().n, 0);
  const old = new Database(before);
  try {
    for (const table of ['word_study_states', 'word_study_items', 'word_study_attempts']) {
      assert.deepEqual(ctx.db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(), old.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
    }
  } finally { old.close(); }
  initDb(ctx.db);
  validateWordStudyConstraints(ctx.db);
});

test('ambiguous v39 mixed sources abort upgrade without dropping either source or learning history', t => {
  const ctx = fixture(t);
  downgrade(ctx.db);
  ctx.db.prepare('UPDATE word_study_items SET character_id = ? WHERE english_word_id = ?').run(ctx.character.id, ctx.word.id);
  assert.throws(() => initDb(ctx.db), /CHECK constraint/);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), 39);
  assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 2);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_items WHERE character_id IS NOT NULL AND english_word_id IS NOT NULL').get().n, 2);
});

test('v40 backups restore live memory and detached snapshots; v39 restores clean orphans; corrupt constraints are rejected', async t => {
  const ctx = fixture(t);
  await ctx.app.ready();
  const backup = ctx.app.backupService;
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  const parsed = JSON.parse(gunzipSync(archive));
  const candidate = mutate => {
    const db = new Database(Buffer.from(parsed.database, 'base64'));
    try { mutate(db); return gzipSync(JSON.stringify({ ...parsed, database: db.serialize().toString('base64') })); }
    finally { db.close(); }
  };
  ctx.book.deleteWord(ctx.word.id, { role: 'parent' });
  const detachedArchive = fs.readFileSync(backup.getPath((await backup.create()).name));
  await backup.restore(archive);
  assert.equal(ctx.book.getWord(ctx.word.id).study_progress.recognize.status, 'learning');
  await backup.restore(detachedArchive);
  assert.equal(ctx.book.getWord(ctx.word.id), null);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_items WHERE english_word_id IS NULL AND character_id IS NULL').get().n, 2);
  await backup.restore(candidate(db => { downgrade(db); db.prepare('DELETE FROM english_words WHERE id = ?').run(ctx.word.id); }));
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 1);
  validateWordStudyConstraints(ctx.db);
  const intact = ctx.db.prepare('SELECT * FROM word_study_items ORDER BY id').all();
  for (const mutate of [
    db => { downgrade(db); db.pragma('user_version = 40'); },
    db => { db.pragma('ignore_check_constraints = ON'); db.prepare("UPDATE word_study_states SET language = 'zh' WHERE language = 'en'").run(); },
    db => { db.pragma('ignore_check_constraints = ON'); db.prepare('UPDATE word_study_items SET character_id = ? WHERE english_word_id IS NOT NULL').run(ctx.character.id); },
    db => { downgrade(db); db.prepare('UPDATE word_study_items SET character_id = ? WHERE english_word_id IS NOT NULL').run(ctx.character.id); }
  ]) {
    await assert.rejects(() => backup.restore(candidate(mutate)), /备份/);
    assert.deepEqual(ctx.db.prepare('SELECT * FROM word_study_items ORDER BY id').all(), intact);
    assert.equal(ctx.db.pragma('foreign_keys', { simple: true }), 1);
  }
});
