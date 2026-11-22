const { test } = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { initDb, SCHEMA_VERSION } = require('../src/db');
const { reading } = require('../src/services/character-imports.service');
const { validateWordImports } = require('../src/db/word-import-constraints');
const { parsePinyinInput } = require('../src/utils/pinyin-input');
const parent = { role: 'parent' };
async function fixture(t) {
  const c = createTestApp({ dictDir: null }); await c.app.ready();
  t.after(async () => { await c.app.close(); cleanupTestApp(c); c.db.close(); });
  const child = c.app.services.childrenService.createChild({ name: '导入甲' }), other = c.app.services.childrenService.createChild({ name: '导入乙' });
  const auth = actor => ({ authorization: `Bearer ${c.app.jwt.sign({ ...actor, epoch: c.app.sessionEpoch() })}` });
  const call = (path, data, actor = parent, headers = {}) => c.app.inject({ method: 'POST', url: `/api/characters/${path}`, payload: { child_id: child.id, ...data }, headers: { ...auth(actor), ...headers } });
  const book = (name = '语文', language = 'zh', childId = child.id) => c.app.services.wordBooksService.create({ child_id: childId, language, name }, parent);
  return { ...c, child, other, auth, call, book };
}
test('numeric, neutral, umlaut and NFC pinyin validate full syllables and Unicode Hanzi count', () => {
  for (const [text, raw, expected] of [['长', 'zhang3', 'zhǎng'], ['银行', 'YIN2  hang2', 'yín háng'], ['爸爸', 'ba4 ba5', 'bà ba'], ['爸爸', 'ba4 ba0', 'bà ba'], ['爸爸', 'ba4 ba', 'bà ba'], ['绿', 'lv4', 'lǜ'], ['绿', 'lü4', 'lǜ'], ['略', 'lve4', 'lüè'], ['略', 'lüe4', 'lüè'], ['长', 'zhǎng'.normalize('NFD'), 'zhǎng']]) assert.equal(parsePinyinInput(raw, text), expected);
  for (const [text, raw] of [['长', 'wrong3'], ['长', 'zhang6'], ['长', 'zhǎng3'], ['长', 'zhǎàng'], ['银行', 'yin2'], ['abc', 'a'], ['长'.repeat(9), 'chang2']]) assert.throws(() => parsePinyinInput(raw, text));
  assert.equal(reading('银行', '').pinyin, 'yín háng');
  assert.equal(reading('爸爸', undefined).needs_confirmation, true);
  assert.throws(() => reading('𰻞', ''), e => e.status === 400);
});
test('preview is read-only, strict about columns and limits, and reports repeated reading conflicts', async t => {
  const c = await fixture(t);
  const snapshot = () => ['characters', 'word_books', 'word_book_items', 'word_import_receipts', 'word_study_states', 'word_study_days', 'daily_tasks', 'point_logs'].map(table => c.db.prepare(`SELECT * FROM ${table}`).all());
  const before = snapshot();
  const response = await c.call('batch-preview', { text: '长\tchang2\n长\tzhang3\n绿、略，银行\n学\txue2\textra\nabc\na'.repeat(1), book_meta: { name: '预览不创建' } });
  assert.equal(response.statusCode, 200, response.body);
  const rows = response.json().items;
  assert.deepEqual(rows.slice(0, 2).map(row => row.status), ['conflict', 'conflict']);
  assert.equal(rows.find(row => row.char === '银行').pinyin, 'yín háng');
  assert.equal(rows.find(row => row.char === '学').status, 'invalid');
  assert.deepEqual(snapshot(), before);
  for (const data of [{ text: Array(201).fill('长').join('、') }, { text: '学'.repeat(50001) }, { items: [] }, { items: [{ char: '学' }], text: '学' }]) assert.equal((await c.call('batch-preview', data)).statusCode, 400);
  assert.equal((await c.call('batch-preview', { items: Array(200).fill({ char: '学', pinyin: 'xue2' }) })).statusCode, 200);
});
test('batch adds, links and skips atomically without changing existing content, categories or progress', async t => {
  const c = await fixture(t), services = c.app.services, b = c.book();
  const original = services.charactersService.createCharacter({ child_id: c.child.id, char: '长', pinyin: 'cháng', categories: ['error_prone'] });
  services.charactersService.markMastered(original.id, true);
  const before = c.db.prepare('SELECT * FROM characters WHERE id = ?').get(original.id);
  const data = { request_id: 'import-mixed-0001', book_id: b.id, items: [{ char: '长', pinyin: 'zhang3' }, { char: '银行', pinyin: '' }, { char: '银行', pinyin: 'yin2 hang2' }] };
  const response = await c.call('batch', data); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().added_count, 1); assert.equal(response.json().linked_count, 1);
  assert.equal(response.json().items.length, 2);
  assert.deepEqual(c.db.prepare('SELECT * FROM characters WHERE id = ?').get(original.id), before);
  assert.equal(services.wordBooksService.items(b.id, {}, parent).items[0].effective_pinyin, 'zhǎng');
  const skipped = await c.call('batch', { ...data, request_id: 'import-mixed-0002' });
  assert.equal(skipped.json().skipped_count, 2);
  for (const table of ['word_study_states', 'word_study_days', 'daily_tasks', 'point_logs']) assert.equal(c.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  validateWordImports(c.db);
});
test('invalid chosen rows, reading conflicts and failing inserts leave no book, word or receipt', async t => {
  const c = await fixture(t);
  for (const items of [[{ char: '河', pinyin: 'he2' }, { char: '水', pinyin: 'wrong3' }], [{ char: '长', pinyin: 'chang2' }, { char: '长', pinyin: 'zhang3' }]]) {
    const result = await c.call('batch', { request_id: 'invalid-batch-0001', book_meta: { name: '不能残留' }, items }); assert.equal(result.statusCode, 400);
  }
  c.db.exec("CREATE TRIGGER injected_import_failure BEFORE INSERT ON characters WHEN NEW.char = '水' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  assert.equal((await c.call('batch', { request_id: 'injected-batch-0001', book_meta: { name: '不能残留' }, items: [{ char: '河' }, { char: '水' }] })).statusCode, 500);
  for (const table of ['characters', 'word_books', 'word_book_items', 'word_import_receipts']) assert.equal(c.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
});
test('durable imports replay original results and never resurrect removed memberships, words or books', async t => {
  const c = await fixture(t), b = c.book(), data = { request_id: 'durable-batch-0001', book_id: b.id, items: [{ char: '长', pinyin: 'zhang3' }] };
  const first = await c.call('batch', data); assert.equal(first.statusCode, 200, first.body);
  c.db.prepare('DELETE FROM word_book_items WHERE book_id = ?').run(b.id);
  assert.deepEqual((await c.call('batch', data)).json(), first.json());
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM word_book_items').get().n, 0);
  c.db.prepare('DELETE FROM characters WHERE id = ?').run(first.json().items[0].id);
  assert.deepEqual((await c.call('batch', data)).json(), first.json());
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM characters').get().n, 0);
  assert.equal((await c.call('batch', { ...data, items: [{ char: '河' }] })).statusCode, 409);
  c.db.prepare('DELETE FROM word_books WHERE id = ?').run(b.id);
  const gone = await c.call('batch', data); assert.equal(gone.statusCode, 409); assert.equal(gone.json().code, 'WORD_IMPORT_GONE');
  validateWordImports(c.db);
});
test('all metadata paths and both API forms authorize child, language and target book ownership', async t => {
  const c = await fixture(t), actor = { role: 'child', child_id: c.child.id }, b = c.book();
  const items = [{ char: '学', pinyin: 'xue2' }];
  for (const path of ['batch-preview', 'batch', 'batch%2Dpreview']) {
    const base = { items, request_id: 'permission-batch-0001' };
    assert.equal((await c.call(path, { ...base, child_id: c.other.id }, actor)).statusCode, 403, path);
    for (const field of ['book_id', 'book_meta', 'source', 'unit', 'textbook', 'source_type', 'note', 'pinyin_override']) {
      for (const data of [{ ...base, [field]: '' }, { ...base, items: [{ ...items[0], [field]: '' }] }]) assert.equal((await c.call(path, data, actor)).statusCode, 403, `${path}/${field}`);
    }
  }
  assert.equal((await c.call('batch', { items, request_id: 'child-scattered-0001' }, actor)).statusCode, 200);
  for (const [id, status] of [[c.book('英语', 'en').id, 400], [c.book('他人', 'zh', c.other.id).id, 403], ['missing', 404]]) assert.equal((await c.call('batch', { items, request_id: 'bad-book-batch-0001', book_id: id })).statusCode, status);
  assert.equal((await c.call('batch', { items, request_id: 'bad-book-batch-0002', book_id: b.id, book_meta: { name: '重复目标' } })).statusCode, 400);
});
test('current receipts restore with deleted historical references; corrupt and missing structures reject before repair', async t => {
  const c = await fixture(t);
  await c.call('batch', { request_id: 'backup-import-0001', book_meta: { name: '历史词本' }, items: [{ char: '河' }] });
  c.db.exec('DELETE FROM word_books; DELETE FROM characters');
  const backup = await c.app.backupService.create(), content = require('node:fs').readFileSync(c.app.backupService.getPath(backup.name));
  await c.app.backupService.restore(content); validateWordImports(c.db);
  const candidate = change => {
    const envelope = JSON.parse(gunzipSync(content)); const db = new Database(Buffer.from(envelope.database, 'base64'));
    change(db); envelope.database = db.serialize().toString('base64'); db.close(); return gzipSync(JSON.stringify(envelope));
  };
  for (const change of [db => db.exec('DROP TABLE word_import_receipts'), db => db.exec("UPDATE word_import_receipts SET result_json = json_set(result_json, '$.added_count', 999)"), db => db.exec("UPDATE word_import_receipts SET result_json = json_set(result_json, '$.items[0].text', 'abc')")]) {
    await assert.rejects(c.app.backupService.restore(candidate(change)), /回执/);
    validateWordImports(c.db);
  }
  for (const version of [42, 43]) {
    await c.app.backupService.restore(candidate(db => { db.exec('DROP TABLE word_import_receipts'); if (version === 42) require('./legacy-word-books-fixture')(db); db.pragma(`user_version = ${version}`); }));
    assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION); validateWordImports(c.db);
  }
});
test('restore generation and session changes are rechecked inside the import write queue', async t => {
  const c = await fixture(t);
  for (const revoke of [false, true]) {
    let release, reached; const gate = new Promise(r => { release = r; }), queued = new Promise(r => { reached = r; });
    const hold = c.app.backupService.exclusive(() => gate), exclusive = c.app.backupService.exclusive.bind(c.app.backupService);
    c.app.backupService.exclusive = fn => { reached(); return exclusive(fn); };
    const response = c.call('batch', { request_id: 'queued-import-0001', items: [{ char: '学' }] }, parent, { 'x-taskie-data-generation': 'initial' });
    await queued;
    c.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(revoke ? 'auth_epoch' : 'last_restore_id', 'changed');
    release(); await hold;
    const result = await response; assert.equal(result.statusCode, revoke ? 401 : 409);
    c.app.backupService.exclusive = exclusive;
  }
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM characters').get().n, 0);
});
