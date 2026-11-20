const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { initDb, SCHEMA_VERSION } = require('../src/db');

async function fixture(t) {
  const ctx = createTestApp();
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); });
  await ctx.app.ready();
  const book = ctx.app.services.englishWordsService;
  const child = ctx.app.services.childrenService.createChild({ name: '编辑冲突' });
  const word = book.createWord({ child_id: child.id, word: 'bank', definition_zh: '银行', textbook: 'PEP' }, { role: 'parent' });
  const auth = (claims = { role: 'parent' }) => ({ authorization: `Bearer ${ctx.app.jwt.sign({ ...claims, epoch: ctx.app.sessionEpoch() })}` });
  const save = (payload, headers = auth(), suffix = '') => ctx.app.inject({ method: 'PUT', url: `/api/english-words/${word.id}${suffix}`, payload, headers });
  return { ...ctx, book, child, word, auth, save };
}

test('English edits require a version; simultaneous saves cannot silently replace each other', async t => {
  const ctx = await fixture(t), { word, book, save, child, auth } = ctx;
  assert.equal(word.version, 1);
  for (const version of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const response = await save({ expected_version: version, note: 'invalid' });
    assert.equal(response.statusCode, 400); assert.equal(response.json().code, 'ENGLISH_WORD_VERSION_REQUIRED');
    assert.equal(book.getWord(word.id).version, 1);
  }
  const responses = await Promise.all(['first', 'second'].map(note => save({ expected_version: 1, note })));
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal(responses.find(r => r.statusCode === 409).json().code, 'ENGLISH_WORD_EDIT_CONFLICT');
  const accepted = responses.find(r => r.statusCode === 200).json();
  assert.equal(accepted.version, 2); assert.equal(book.getWord(word.id).note, accepted.note);
  const student = auth({ role: 'child', child_id: child.id });
  assert.equal((await save({ expected_version: 2, textbook: 'unauthorized' }, student)).statusCode, 403);
  assert.equal((await save({ expected_version: 1, note: 'child draft' }, student)).statusCode, 409);
  assert.equal((await save({ expected_version: 2, note: 'child checked' }, student)).statusCode, 200);
  assert.equal(book.getWord(word.id).textbook, 'PEP');
  assert.equal((await save({ expected_version: 3, categories: ['write'] }, student, '/categories')).statusCode, 200);
  assert.equal((await save({ expected_version: 3, categories: ['write', 'recognize'] }, student, '/categories')).statusCode, 409);
  assert.equal((await save({ expected_version: 3, note: 'stale after category' })).statusCode, 409);
  assert.deepEqual(book.getWord(word.id).categories, ['write']);
  book.markMastered(word.id, true);
  assert.equal(book.getWord(word.id).version, 5);
  const sibling = ctx.app.services.childrenService.createChild({ name: '另一个孩子' });
  assert.equal((await save({ expected_version: 5 }, auth({ role: 'child', child_id: sibling.id }))).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'PUT', url: `/api/english-words/${word.id}`, payload: { expected_version: 5 } })).statusCode, 401);
  book.deleteWord(word.id, { role: 'parent' });
  assert.equal((await save({ expected_version: 5, note: 'deleted draft' })).statusCode, 404);
  assert.equal(book.getWord(word.id), null);
});

test('v42 backup preserves versions, upgrades genuine v41, rejects missing or corrupt versions atomically', async t => {
  const ctx = await fixture(t), { book, word, app, db, save, auth } = ctx;
  const backup = app.backupService;
  book.updateWord(word.id, { expected_version: 1, note: 'saved' });
  const archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  const parsed = JSON.parse(gunzipSync(archive));
  const candidate = mutate => {
    const copy = new Database(Buffer.from(parsed.database, 'base64'));
    try { mutate(copy); return gzipSync(JSON.stringify({ ...parsed, database: copy.serialize().toString('base64') })); }
    finally { copy.close(); }
  };
  book.updateWord(word.id, { expected_version: 2, note: 'later' });
  await backup.restore(archive);
  assert.equal(book.getWord(word.id).version, 2); assert.equal(book.getWord(word.id).note, 'saved');
  for (const mutate of [
    copy => copy.exec('ALTER TABLE english_words DROP COLUMN version'),
    copy => copy.exec('PRAGMA ignore_check_constraints = ON; UPDATE english_words SET version = 0'),
    copy => copy.exec('PRAGMA ignore_check_constraints = ON; UPDATE english_words SET version = 1.5')
  ]) {
    await assert.rejects(backup.restore(candidate(mutate)), /词条版本|完整性检查/);
    assert.equal(book.getWord(word.id).version, 2); assert.equal(book.getWord(word.id).note, 'saved');
  }
  const oldGeneration = db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get().value;
  await backup.restore(candidate(copy => { copy.exec('ALTER TABLE english_words DROP COLUMN version'); copy.pragma('user_version = 41'); }));
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(book.getWord(word.id).version, 1); assert.equal(book.getWord(word.id).note, 'saved');
  const stale = await save({ expected_version: 1, note: 'draft from before restore' }, { ...auth(), 'x-taskie-data-generation': oldGeneration });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().code, 'DATA_RESTORED');
  assert.equal(book.getWord(word.id).note, 'saved');
});

test('v42 migration failure rolls back its column and version and can be retried without changing words', async t => {
  const { db, book, word } = await fixture(t);
  db.exec('ALTER TABLE english_words DROP COLUMN version'); db.pragma('user_version = 41');
  const broken = new Proxy(db, { get(target, key) {
    if (key === 'exec') return sql => { const value = target.exec(sql); if (sql.includes('ADD COLUMN version')) throw new Error('injected version migration'); return value; };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.throws(() => initDb(broken), /injected version migration/);
  assert.equal(db.pragma('user_version', { simple: true }), 41);
  assert.equal(db.pragma('table_info(english_words)').some(c => c.name === 'version'), false);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  initDb(db); assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(book.getWord(word.id).version, 1); assert.equal(book.getWord(word.id).definition_zh, '银行');
});

test('version comparison is part of the SQL update, including category edits', async t => {
  const { book, word, db } = await fixture(t);
  const read = book.getWord.bind(book);
  for (const change of [
    () => book.updateWord(word.id, { expected_version: read(word.id).version, note: 'stale' }),
    () => book.setCategories(word.id, ['write'], { role: 'parent', expected_version: read(word.id).version })
  ]) {
    let injected = false;
    book.getWord = id => {
      const snapshot = read(id);
      if (!injected) { injected = true; db.prepare('UPDATE english_words SET note = ?, version = version + 1 WHERE id = ?').run('external writer', id); }
      return snapshot;
    };
    assert.throws(change, error => error.code === 'ENGLISH_WORD_EDIT_CONFLICT');
    assert.equal(read(word.id).note, 'external writer'); assert.deepEqual(read(word.id).categories, []);
    book.getWord = read;
  }
});
