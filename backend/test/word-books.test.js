const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { initDb, SCHEMA_VERSION } = require('../src/db');
const { validateWordBooks } = require('../src/db/word-books-constraints');
const parent = { role: 'parent' };
async function fixture(t) {
  const c = createTestApp({ dictDir: null }); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const { childrenService, charactersService: chars, englishWordsService: words, wordBooksService: books } = c.app.services;
  const child = childrenService.createChild({ name: '词本甲' }), sibling = childrenService.createChild({ name: '词本乙' });
  const char = chars.createCharacter({ child_id: child.id, char: '长', pinyin: 'cháng', categories: ['write'] });
  const word = words.createWord({ child_id: child.id, word: 'May', definition_zh: '五月', strict_case: true }, parent);
  const auth = (actor = parent) => ({ authorization: `Bearer ${c.app.jwt.sign({ ...actor, epoch: c.app.sessionEpoch() })}` });
  const call = (method, path = '', payload, actor = parent, extra = {}) => c.app.inject({ method, url: `/api/word-books${path}`, payload, headers: { ...auth(actor), ...extra } });
  const create = (name, language = 'zh', other = {}) => books.create({ child_id: child.id, language, name, ...other }, parent);
  return { ...c, child, sibling, char, word, chars, words, books, auth, call, create };
}

test('one word belongs to multiple sources without changing its version, mastery or memory state', async t => {
  const c = await fixture(t), { books, create, char, word, words, db } = c;
  const before = words.getWord(word.id);
  const one = create('第一单元'), two = create('易错字');
  const a = books.add(one.id, { character_id: char.id, pinyin_override: 'chang2' }, parent);
  const b = books.add(two.id, { character_id: char.id, pinyin_override: 'zhang3' }, parent);
  assert.equal(a.effective_pinyin, 'cháng'); assert.equal(b.effective_pinyin, 'zhǎng');
  const en = [create('课本', 'en'), create('期中', 'en')];
  for (const book of en) books.add(book.id, { english_word_id: word.id }, parent);
  assert.deepEqual(words.getWord(word.id), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_study_states').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_tasks').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM point_logs').get().n, 0);
  assert.equal(books.list({ child_id: c.child.id, language: 'en', limit: 1 }, parent).next_offset, 1);
  const saved = books.updateItem(two.id, b.id, { expected_version: 1, pinyin_override: 'chang2' }, parent);
  assert.equal(saved.version, 2);
  assert.throws(() => books.updateItem(two.id, b.id, { expected_version: 1, pinyin_override: 'zhang3' }, parent), e => e.status === 409);
  books.remove(one.id, { expected_version: 1 }, parent);
  assert.equal(c.chars.getCharacter(char.id).pinyin, 'cháng');
  assert.equal(books.items(two.id, {}, parent).items.length, 1);
  words.deleteWord(word.id, parent);
  assert.ok(en.every(book => books.items(book.id, {}, parent).total === 0));
  validateWordBooks(db);
});

test('word book API authorizes collections, encoded paths and nested items; every mutation is parent-only', async t => {
  const c = await fixture(t), { call, child, sibling, char, create, books } = c;
  const own = { role: 'child', child_id: child.id }, other = { role: 'child', child_id: sibling.id };
  const a = create('甲本'), b = create('乙本');
  const item = books.add(a.id, { character_id: char.id }, parent);
  assert.equal((await call('GET', `?child_id=${child.id}&language=zh`, undefined, own)).statusCode, 200);
  assert.equal((await call('GET', `?child_id=${sibling.id}&language=zh`, undefined, own)).statusCode, 403);
  for (const path of [`/${a.id}`, `/${a.id}/items`, `/${encodeURIComponent(a.id).replace(/-/g, '%2D')}/items`]) {
    assert.equal((await call('GET', path, undefined, other)).statusCode, 403);
  }
  for (const [method, path, payload] of [
    ['POST', '', { child_id: child.id, language: 'zh', name: '越权', request_id: 'create-unauthorized' }],
    ['PUT', `/${a.id}`, { expected_version: 1, name: '越权' }],
    ['DELETE', `/${a.id}`, { expected_version: 1 }],
    ['POST', `/${a.id}/items`, { character_id: char.id, request_id: 'link-unauthorized' }],
    ['PUT', `/${a.id}/items/${item.id}`, { expected_version: 1 }],
    ['DELETE', `/${a.id}/items/${item.id}`, { expected_version: 1 }]
  ]) assert.equal((await call(method, path, payload, own)).statusCode, 403);
  assert.equal((await call('PUT', `/${b.id}/items/${item.id}`, { expected_version: 1 })).statusCode, 404);
  const alien = c.chars.createCharacter({ child_id: sibling.id, char: '行' });
  assert.equal((await call('POST', `/${a.id}/items`, { character_id: alien.id, request_id: 'wrong-child-link' })).statusCode, 403);
  assert.equal((await call('POST', `/${a.id}/items`, { english_word_id: c.word.id, request_id: 'wrong-language-link' })).statusCode, 400);
  const anonymous = await c.rawInject({ method: 'GET', url: `/api/word-books/${a.id}` });
  assert.equal(anonymous.statusCode, 401);
});

test('creation and links survive lost responses without duplication and old retries cannot resurrect deletions', async t => {
  const c = await fixture(t), { call, child, char, books } = c;
  const payload = { child_id: child.id, language: 'zh', name: '请求重放', request_id: 'create-word-book-0001' };
  const first = await call('POST', '', payload); assert.equal(first.statusCode, 200, first.body);
  const book = first.json();
  assert.equal((await call('POST', '', payload)).json().id, book.id);
  assert.equal((await call('POST', '', { ...payload, name: '改变请求' })).statusCode, 409);
  const add = { character_id: char.id, pinyin_override: 'zhang3', request_id: 'link-word-book-0001' };
  const item = (await call('POST', `/${book.id}/items`, add)).json();
  assert.equal((await call('POST', `/${book.id}/items`, add)).json().id, item.id);
  assert.equal(books.items(book.id, {}, parent).total, 1);
  await call('DELETE', `/${book.id}/items/${item.id}`, { expected_version: 1 });
  assert.equal((await call('POST', `/${book.id}/items`, add)).statusCode, 409);
  assert.equal(books.items(book.id, {}, parent).total, 0);
  assert.equal((await call('PUT', `/${book.id}`, { name: '已更新', expected_version: 1 })).json().version, 2);
  assert.equal((await call('DELETE', `/${book.id}`, { expected_version: 1 })).statusCode, 409);
  await call('DELETE', `/${book.id}`, { expected_version: 2 });
  assert.equal((await call('POST', '', payload)).statusCode, 409);
});

test('database rejects crossed ownership, mixed sources and mutations of referenced owners', async t => {
  const c = await fixture(t), { db, create, char, sibling, books } = c;
  const book = create('数据库约束');
  const item = books.add(book.id, { character_id: char.id }, parent);
  const alien = c.chars.createCharacter({ child_id: sibling.id, char: '行' });
  for (const sql of [
    ['UPDATE word_book_items SET character_id = ? WHERE id = ?', alien.id, item.id],
    ['UPDATE word_book_items SET english_word_id = ? WHERE id = ?', c.word.id, item.id],
    ['UPDATE word_books SET child_id = ? WHERE id = ?', sibling.id, book.id],
    ['UPDATE characters SET child_id = ? WHERE id = ?', sibling.id, char.id],
    ['UPDATE word_book_items SET position = ? WHERE id = ?', -1, item.id]
  ]) assert.throws(() => db.prepare(sql[0]).run(...sql.slice(1)));
  validateWordBooks(db);
});

test('metadata and pinyin are bounded, normalized and versioned without silently merging names', async t => {
  const c = await fixture(t), { create, books, char } = c;
  const one = create('  PEP   单元  ');
  assert.equal(one.name, 'PEP 单元');
  assert.throws(() => create('pep 单元'), e => e.status === 409);
  for (const data of [{ name: 'x'.repeat(81) }, { source: 'x'.repeat(61) }, { note: 'x'.repeat(201) }, { source_type: 'other' }]) {
    assert.throws(() => create('不合法', 'zh', data), e => e.status === 400);
  }
  const auto = books.create({ child_id: c.child.id, language: 'zh', source: '源'.repeat(60), unit: '单'.repeat(60) }, parent);
  assert.equal(Array.from(auto.name).length, 80);
  for (const pinyin of ['wrong3', 'zhang6', 'zhang3 chang2', 'zhǎng3', 'zhǎàng']) {
    assert.throws(() => books.add(one.id, { character_id: char.id, pinyin_override: pinyin }, parent), e => e.status === 400);
  }
  assert.throws(() => books.list({ child_id: c.child.id, language: 'zh', limit: 1000 }, parent), e => e.status === 400);
});

test('v43 migration maps legacy sources deterministically and preserves words and progress', async t => {
  const c = await fixture(t), { db, words, child } = c;
  const rows = [
    ['apple', '教材', '单元'], ['banana', '教材', '单元'], ['pear', '', '仅单元'],
    ['orange', '源'.repeat(60), '单'.repeat(60)], ['grape', '源'.repeat(60), '章'.repeat(60)],
    ['peach', 'A · B', 'C'], ['plum', 'A', 'B · C'], ['melon', ' ', ' ']
  ].map(([word, textbook, unit]) => words.createWord({ child_id: child.id, word, textbook, unit, definition_zh: word }, parent));
  db.exec('DROP TABLE word_book_items; DROP TABLE word_books');
  db.pragma('user_version = 42');
  const before = db.prepare('SELECT * FROM english_words ORDER BY id').all();
  initDb(db); validateWordBooks(db);
  assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.deepEqual(db.prepare('SELECT * FROM english_words ORDER BY id').all(), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_books').get().n, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_book_items').get().n, 7);
  const ids = db.prepare('SELECT id FROM word_books ORDER BY id').all(); initDb(db);
  assert.deepEqual(db.prepare('SELECT id FROM word_books ORDER BY id').all(), ids);
  const shared = db.prepare("SELECT id FROM word_books WHERE source = '教材'").get();
  assert.deepEqual(db.prepare('SELECT english_word_id FROM word_book_items WHERE book_id = ? ORDER BY position').all(shared.id).map(r => r.english_word_id), rows.slice(0, 2).sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(w => w.id));
});

test('legacy edits and duplicate batches supplement source links without replacing other memberships', async t => {
  const c = await fixture(t), { words, word, child, db } = c;
  words.updateWord(word.id, { expected_version: 1, textbook: '原课本', unit: '第一单元' }, parent);
  words.updateWord(word.id, { expected_version: 2, textbook: '新课本' }, parent);
  const before = words.getWord(word.id);
  const result = words.batchImport(child.id, { textbook: '复习资料', items: [{ word: 'May' }] }, parent);
  assert.deepEqual(result.skipped, ['May']);
  assert.deepEqual(words.getWord(word.id), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_book_items WHERE english_word_id = ?').get(word.id).n, 3);
});

test('current restore, genuine v42 upgrade and corrupted structure/data rejection preserve live data', async t => {
  const c = await fixture(t), { db, app, create, books, char, sibling } = c;
  const book = create('备份词本'), item = books.add(book.id, { character_id: char.id, pinyin_override: 'zhang3' }, parent);
  const alien = c.chars.createCharacter({ child_id: sibling.id, char: '行' });
  const backup = app.backupService, archive = fs.readFileSync(backup.getPath((await backup.create()).name));
  const parsed = JSON.parse(gunzipSync(archive));
  const candidate = mutate => {
    const copy = new Database(Buffer.from(parsed.database, 'base64'));
    try { mutate(copy); return gzipSync(JSON.stringify({ ...parsed, database: copy.serialize().toString('base64') })); }
    finally { copy.close(); }
  };
  books.remove(book.id, { expected_version: 1 }, parent); await backup.restore(archive);
  assert.equal(books.item(book.id, item.id, parent).effective_pinyin, 'zhǎng');
  validateWordBooks(db);
  for (const mutate of [
    copy => copy.exec('DROP TABLE word_book_items'),
    copy => copy.exec('DROP TRIGGER word_book_items_owner_update'),
    copy => { copy.pragma('ignore_check_constraints = ON'); copy.prepare('UPDATE word_book_items SET position = -1').run(); },
    copy => copy.prepare("UPDATE word_book_items SET pinyin_override = 'invalid3'").run(),
    copy => {
      const trigger = copy.prepare("SELECT sql FROM sqlite_master WHERE name = 'word_book_items_owner_update'").get().sql;
      copy.exec('DROP TRIGGER word_book_items_owner_update');
      copy.prepare('UPDATE word_book_items SET character_id = ?').run(alien.id);
      copy.exec(trigger);
    },
    copy => copy.prepare("UPDATE word_books SET name_key = 'wrong-normalization'").run(),
    copy => { copy.pragma('ignore_check_constraints = ON'); copy.prepare('UPDATE word_book_items SET version = 0').run(); }
  ]) {
    const intact = db.prepare('SELECT * FROM word_book_items').all();
    await assert.rejects(() => backup.restore(candidate(mutate)), /备份/);
    assert.deepEqual(db.prepare('SELECT * FROM word_book_items').all(), intact);
  }
  await backup.restore(candidate(copy => { copy.exec('DROP TABLE word_book_items; DROP TABLE word_books'); copy.pragma('user_version = 42'); }));
  validateWordBooks(db); assert.equal(db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_books').get().n, 0);
});

test('v43 failure rolls back migrated memberships and version; retry keeps original word records', async t => {
  const c = await fixture(t), { db, words, child } = c;
  words.createWord({ child_id: child.id, word: 'school', textbook: 'PEP', unit: 'U1' }, parent);
  require('./legacy-word-books-fixture')(db); db.pragma('user_version = 42');
  const before = db.prepare('SELECT * FROM english_words ORDER BY id').all();
  const broken = new Proxy(db, { get(target, key) {
    if (key === 'prepare') return sql => {
      if (sql.includes('INSERT INTO word_book_items')) throw new Error('injected membership failure');
      return target.prepare(sql);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  assert.throws(() => initDb(broken), /injected membership failure/);
  assert.equal(db.pragma('user_version', { simple: true }), 42);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_books').get().n, 0);
  assert.deepEqual(db.prepare('SELECT * FROM english_words ORDER BY id').all(), before);
  initDb(db); validateWordBooks(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_book_items').get().n, 1);
});

test('queued word book writes reject old generations after restoration', async t => {
  const c = await fixture(t), { app, call, child, db } = c;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const hold = app.backupService.exclusive(() => gate);
  const pending = call('POST', '', { child_id: child.id, language: 'zh', name: '旧草稿', request_id: 'restore-stale-book' }, parent, { 'x-taskie-data-generation': 'initial' });
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('last_restore_id','restored')").run();
  release(); await hold;
  const response = await pending; assert.equal(response.statusCode, 409); assert.equal(response.json().code, 'DATA_RESTORED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_books').get().n, 0);
});

test('a session revoked while waiting for the restore lock cannot write a word book', async t => {
  const c = await fixture(t), { app, call, child, db } = c;
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = new Promise(resolve => { reached = resolve; });
  const hold = app.backupService.exclusive(() => gate);
  const exclusive = app.backupService.exclusive.bind(app.backupService);
  app.backupService.exclusive = operation => { reached(); return exclusive(operation); };
  const pending = call('POST', '', { child_id: child.id, language: 'zh', name: '过期提交', request_id: 'revoked-session-book' });
  await queued;
  db.prepare("UPDATE settings SET value = 'new-session' WHERE key = 'auth_epoch'").run();
  release(); await hold;
  assert.equal((await pending).statusCode, 401);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM word_books').get().n, 0);
});
