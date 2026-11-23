const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { SCHEMA_VERSION } = require('../src/db');
const { validateWordTests } = require('../src/db/word-tests-constraints');
const parent = { role: 'parent' };
async function fixture(t) {
  const c = createTestApp({ dictDir: null });
  await c.app.ready();
  t.after(async () => {
    await c.app.close();
    cleanupTestApp(c);
    c.db.close();
  });
  const {
    childrenService,
    wordBooksService: books,
    charactersService: chars,
    englishWordsService: words,
    wordTestsService: tests,
  } = c.app.services;
  const child = childrenService.createChild({ name: '独立测试甲' }),
    other = childrenService.createChild({ name: '独立测试乙' });
  const book = (name, language = 'zh', childId = child.id) =>
    books.create({ child_id: childId, language, name }, parent);
  const call = (method, path = '', body, actor = parent, headers = {}) =>
    c.app.inject({
      method,
      url: '/api/word-tests' + path,
      payload: body,
      headers: {
        authorization: `Bearer ${c.app.jwt.sign({ ...actor, epoch: c.app.sessionEpoch() })}`,
        ...headers,
      },
    });
  let serial = 0;
  const make = (ids, more = {}, actor = parent) =>
    tests.create(
      {
        child_id: child.id,
        language: 'zh',
        skill: 'recognize',
        book_ids: ids,
        request_id: `create-self-test-${++serial}`,
        ...more,
      },
      actor,
    );
  const answer = (test, item, result = 'correct', more = {}, actor = parent) =>
    tests.answer(test.id, item.id, { result, request_id: `answer-self-test-${++serial}`, ...more }, actor);
  return { ...c, child, other, books, chars, words, tests, book, call, make, answer };
}
test('independent tests deduplicate by effective reading and freeze source, definitions, strictness and audio', async (t) => {
  const c = await fixture(t),
    a = c.book('课本'),
    b = c.book('多音'),
    char = c.chars.createCharacter({ child_id: c.child.id, char: '长', pinyin: 'cháng' });
  c.books.add(a.id, { character_id: char.id, pinyin_override: 'chang2' }, parent);
  c.books.add(b.id, { character_id: char.id, pinyin_override: 'zhang3' }, parent);
  const zh = c.make([a.id, b.id]);
  assert.deepEqual(
    zh.items.map((item) => item.pinyin),
    ['cháng', 'zhǎng'],
  );
  assert.equal(zh.total_count, 2);
  c.books.updateItem(
    b.id,
    c.books.items(b.id, {}, parent).items[0].id,
    { expected_version: 1, pinyin_override: 'chang2' },
    parent,
  );
  assert.equal(c.make([a.id, b.id]).total_count, 1);
  assert.deepEqual(
    c.tests.get(zh.id, parent).items.map((item) => item.pinyin),
    ['cháng', 'zhǎng'],
  );
  const en = c.book('英语', 'en'),
    ref = {
      dict_id: 'oald8',
      accent: 'uk',
      file: 'may.wav',
      sha256: 'a'.repeat(64),
      entry_key: 'b'.repeat(64),
      headword: 'May',
      phonetic: 'meɪ',
    };
  const word = c.words.createWord(
    {
      child_id: c.child.id,
      word: 'May',
      strict_case: true,
      senses: [
        { id: 's1', definition_zh: '五月', audio_refs: [ref] },
        { id: 's2', definition_zh: '别义', audio_refs: [] },
      ],
    },
    parent,
  );
  c.books.add(en.id, { english_word_id: word.id }, parent);
  const english = c.make([en.id], { language: 'en', skill: 'write' });
  c.words.updateWord(word.id, { expected_version: 1, primary_sense_id: 's2', strict_case: false }, parent);
  const saved = c.tests.get(english.id, parent).items[0];
  assert.equal(saved.meaning_zh, '五月');
  assert.equal(saved.strict_case, true);
  assert.deepEqual(saved.audio_refs, [ref]);
  assert.deepEqual(c.make([en.id], { language: 'en', skill: 'write' }).items[0].audio_refs, []);
  c.words.deleteWord(word.id, parent);
  c.books.remove(en.id, { expected_version: 1 }, parent);
  assert.equal(c.tests.get(english.id, parent).items[0].english_word_id, null);
  assert.equal(c.tests.get(english.id, parent).book_names[0], '英语');
  validateWordTests(c.db);
});
test('first answers are immutable, spelling is server-graded and retries never count twice', async (t) => {
  const c = await fixture(t),
    b = c.book('拼写', 'en'),
    word = c.words.createWord(
      { child_id: c.child.id, word: 'May', definition_zh: '五月', strict_case: true },
      parent,
    );
  c.books.add(b.id, { english_word_id: word.id }, parent);
  const test = c.make([b.id], { language: 'en', skill: 'write' }),
    item = test.items[0];
  assert.equal(item.audio_refs, null, 'legacy/unspecified audio remains distinct from explicitly empty audio');
  const payload = { request_id: 'immutable-answer-0001', typed_answer: 'may', result: 'correct' };
  const first = await c.call('POST', `/${test.id}/items/${item.id}/answer`, payload);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().item.result, 'wrong');
  assert.equal(first.json().test.correct_count, 0);
  assert.equal(
    (await c.call('POST', `/${test.id}/items/${item.id}/answer`, payload)).json().item.result,
    'wrong',
  );
  for (const body of [
    { ...payload, typed_answer: 'May' },
    { ...payload, request_id: 'other-answer-0002' },
  ])
    assert.equal((await c.call('POST', `/${test.id}/items/${item.id}/answer`, body)).statusCode, 409);
  assert.equal(c.tests.get(test.id, parent).answered_count, 1);
  assert.equal(c.tests.get(test.id, parent).status, 'completed');
  const tolerant = c.make([b.id], { language: 'en', skill: 'write' });
  c.words.updateWord(word.id, { expected_version: 1, strict_case: false }, parent);
  assert.equal(
    c.answer(tolerant, tolerant.items[0], 'correct', { typed_answer: 'MAY' }).item.result,
    'wrong',
    'frozen strict rule survives editing',
  );
  const current = c.make([b.id], { language: 'en', skill: 'write' });
  assert.equal(
    c.answer(current, current.items[0], 'wrong', { typed_answer: ' MAY ' }).item.result,
    'correct',
  );
  const wrongText = c.make([b.id], { language: 'en', skill: 'write' });
  assert.equal(
    c.answer(wrongText, wrongText.items[0], 'correct', { typed_answer: '中文，答错了！' }).item.typed_answer,
    '中文，答错了！',
  );
  validateWordTests(c.db);
});
test('test creation, answering and retry-wrong do not alter daily memory, tasks, points or study time', async (t) => {
  const c = await fixture(t),
    b = c.book('隔离'),
    word = c.chars.createCharacter({
      child_id: c.child.id,
      char: '学',
      pinyin: 'xue2',
      categories: ['write'],
    });
  c.books.add(b.id, { character_id: word.id }, parent);
  const tables = [
    'word_study_states',
    'word_study_days',
    'word_study_batches',
    'word_study_items',
    'word_study_attempts',
    'daily_tasks',
    'point_logs',
    'homework_sessions',
    'homework_session_days',
    'study_legacy_corrections',
  ];
  const snapshot = () => tables.map((table) => c.db.prepare(`SELECT * FROM ${table}`).all()),
    before = snapshot(),
    entry = c.db.prepare('SELECT * FROM characters WHERE id=?').get(word.id);
  const test = c.make([b.id]);
  c.answer(test, test.items[0], 'wrong');
  const retried = c.tests.retryWrong(test.id, { request_id: 'retry-isolated-0001' }, parent);
  c.answer(retried, retried.items[0]);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(c.db.prepare('SELECT * FROM characters WHERE id=?').get(word.id), entry);
  assert.equal(Object.hasOwn(c.tests.get(test.id, parent), 'duration_seconds'), false);
  validateWordTests(c.db);
});
test('deleted word/book snapshots can be retested and marking errors changes each living word only once', async (t) => {
  const c = await fixture(t),
    a = c.book('甲'),
    b = c.book('乙'),
    char = c.chars.createCharacter({
      child_id: c.child.id,
      char: '长',
      pinyin: 'cháng',
      categories: ['write'],
    });
  c.books.add(a.id, { character_id: char.id, pinyin_override: 'chang2' }, parent);
  c.books.add(b.id, { character_id: char.id, pinyin_override: 'zhang3' }, parent);
  const test = c.make([a.id, b.id]);
  for (const item of test.items) c.answer(test, item, 'wrong');
  assert.deepEqual(c.tests.markWrong(test.id, parent), { added: 1, already: 0, deleted: 0 });
  assert.deepEqual(c.tests.markWrong(test.id, { role: 'child', child_id: c.child.id }), {
    added: 0,
    already: 1,
    deleted: 0,
  });
  assert.deepEqual(c.chars.getCharacter(char.id).categories, ['write', 'error_prone']);
  c.chars.deleteCharacter(char.id, parent);
  c.books.remove(a.id, { expected_version: 1 }, parent);
  c.books.remove(b.id, { expected_version: 1 }, parent);
  const data = { request_id: 'retry-deleted-word-0001' },
    retry = c.tests.retryWrong(test.id, data, parent);
  assert.equal(retry.total_count, 2);
  assert.ok(retry.items.every((item) => item.character_id === null));
  assert.equal(c.tests.retryWrong(test.id, data, parent).id, retry.id);
  assert.deepEqual(c.tests.markWrong(test.id, parent), { added: 0, already: 0, deleted: 1 });
  const en = c.book('英语', 'en'),
    word = c.words.createWord({ child_id: c.child.id, word: 'book', definition_zh: '书' }, parent);
  c.books.add(en.id, { english_word_id: word.id }, parent);
  const english = c.make([en.id], { language: 'en' });
  c.answer(english, english.items[0], 'wrong');
  c.tests.markWrong(english.id, parent);
  assert.equal(c.words.getWord(word.id).version, 2);
  c.tests.markWrong(english.id, parent);
  assert.equal(c.words.getWord(word.id).version, 2);
  validateWordTests(c.db);
});
test('all APIs authorize collections, nested IDs, encoded paths and generations for both roles', async (t) => {
  const c = await fixture(t),
    b = c.book('自己的'),
    alien = c.book('别人的', 'zh', c.other.id),
    word = c.chars.createCharacter({ child_id: c.child.id, char: '学', pinyin: 'xue2' });
  c.books.add(b.id, { character_id: word.id }, parent);
  const own = { role: 'child', child_id: c.child.id },
    other = { role: 'child', child_id: c.other.id },
    data = {
      child_id: c.child.id,
      language: 'zh',
      skill: 'recognize',
      book_ids: [b.id],
      request_id: 'api-child-test-0001',
    };
  const made = await c.call('POST', '', data, own);
  assert.equal(made.statusCode, 200, made.body);
  const test = made.json(),
    item = test.items[0];
  for (const [method, path, body] of [
    ['GET', `?child_id=${c.child.id}&language=zh`],
    ['GET', `/${test.id}`],
    ['GET', `/${test.id.replace(/-/g, '%2D')}`],
    ['POST', `/${test.id}/items/${item.id}/answer`, { result: 'correct', request_id: 'cross-answer-0001' }],
    ['POST', `/${test.id}/retry-wrong`, { request_id: 'cross-retry-0001' }],
    ['POST', `/${test.id}/mark-wrong`, {}],
  ])
    assert.equal((await c.call(method, path, body, other)).statusCode, 403);
  assert.equal(
    (await c.call('POST', '', { ...data, request_id: 'cross-book-test-0001', book_ids: [alien.id] }, own))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await c.call('POST', '', { ...data, request_id: 'old-generation-test' }, own, {
        'x-taskie-data-generation': 'old',
      })
    ).statusCode,
    409,
  );
  const second = c.make([b.id]);
  assert.equal(
    (
      await c.call(
        'POST',
        `/${second.id}/items/${item.id}/answer`,
        { result: 'correct', request_id: 'nested-mismatch-0001' },
        own,
      )
    ).statusCode,
    404,
  );
  assert.equal((await c.rawInject({ method: 'GET', url: `/api/word-tests/${test.id}` })).statusCode, 401);
});
test('failed scoring rolls back answer, counts and receipt; a later retry is still the first answer', async (t) => {
  const c = await fixture(t),
    b = c.book('回滚'),
    word = c.chars.createCharacter({ child_id: c.child.id, char: '学', pinyin: 'xue2' });
  c.books.add(b.id, { character_id: word.id }, parent);
  const test = c.make([b.id]),
    item = test.items[0];
  c.db.exec(
    "CREATE TRIGGER injected_test_failure BEFORE UPDATE ON word_tests WHEN NEW.answered_count>0 BEGIN SELECT RAISE(ABORT,'injected'); END;",
  );
  const body = { result: 'correct', request_id: 'rollback-test-answer-0001' };
  assert.equal((await c.call('POST', `/${test.id}/items/${item.id}/answer`, body)).statusCode, 500);
  assert.equal(c.tests.get(test.id, parent).items[0].result, null);
  assert.equal(
    c.db.prepare('SELECT 1 FROM form_submission_receipts WHERE id=?').get(body.request_id),
    undefined,
  );
  c.db.exec('DROP TRIGGER injected_test_failure');
  assert.equal(
    (await c.call('POST', `/${test.id}/items/${item.id}/answer`, body)).json().test.answered_count,
    1,
  );
  validateWordTests(c.db);
});
test('shuffle and pagination are persistent, bounded and do not need complete definitions for excluded words', async (t) => {
  const c = await fixture(t),
    b = c.book('大量', 'en');
  for (let i = 0; i < 202; i++) {
    const word = c.words.createWord(
      { child_id: c.child.id, word: `word${i}`, definition_zh: i === 201 ? '' : '词' },
      parent,
    );
    c.books.add(b.id, { english_word_id: word.id }, parent);
  }
  const payload = {
    child_id: c.child.id,
    language: 'en',
    skill: 'recognize',
    book_ids: [b.id],
    order_mode: 'shuffle',
    limit: 200,
    request_id: 'shuffled-test-0001',
  };
  const test = c.tests.create(payload, parent);
  assert.equal(test.total_count, 200);
  assert.equal(test.excluded_no_definition, 1);
  assert.deepEqual(
    c.tests.create(payload, parent).items.map((item) => item.text),
    test.items.map((item) => item.text),
  );
  assert.throws(
    () => c.tests.create({ ...payload, limit: 201, request_id: 'oversized-test-0001' }, parent),
    (e) => e.status === 400,
  );
  for (let i = 0; i < 3; i++) c.make([b.id], { language: 'en', limit: 1 });
  const first = c.tests.list({ child_id: c.child.id, language: 'en', limit: 2 }, parent),
    second = c.tests.list(
      { child_id: c.child.id, language: 'en', limit: 2, cursor: first.next_cursor },
      parent,
    );
  assert.equal(new Set([...first.items, ...second.items].map((test) => test.id)).size, 4);
  assert.equal(second.next_cursor, null);
  assert.throws(
    () => c.tests.list({ child_id: c.child.id, language: 'en', cursor: 'invalid' }, parent),
    (e) => e.status === 400,
  );
});
test('recent book accuracy includes only questions sourced from that book', async (t) => {
  const c = await fixture(t),
    a = c.book('甲', 'en'),
    b = c.book('乙', 'en');
  for (const [book, word] of [
    [a, 'apple'],
    [b, 'book'],
  ]) {
    const row = c.words.createWord({ child_id: c.child.id, word, definition_zh: '释义' }, parent);
    c.books.add(book.id, { english_word_id: row.id }, parent);
  }
  const test = c.make([a.id, b.id], { language: 'en' });
  c.answer(test, test.items[0], 'correct');
  c.answer(test, test.items[1], 'wrong');
  assert.deepEqual(
    [c.books.get(a.id, parent).recent_test.correct_count, c.books.get(a.id, parent).recent_test.total_count],
    [1, 1],
  );
  assert.deepEqual(
    [c.books.get(b.id, parent).recent_test.correct_count, c.books.get(b.id, parent).recent_test.total_count],
    [0, 1],
  );
  validateWordTests(c.db);
});
test('current and deleted-history backups restore; malformed counts, spelling, audio and receipts are rejected', async (t) => {
  const c = await fixture(t),
    b = c.book('备份', 'en'),
    word = c.words.createWord(
      { child_id: c.child.id, word: 'May', definition_zh: '五月', strict_case: true },
      parent,
    );
  c.books.add(b.id, { english_word_id: word.id }, parent);
  const test = c.make([b.id], { language: 'en', skill: 'write' });
  c.answer(test, test.items[0], 'correct', { typed_answer: 'may' });
  const archive = fs.readFileSync(c.app.backupService.getPath((await c.app.backupService.create()).name)),
    parsed = JSON.parse(gunzipSync(archive));
  const candidate = (change) => {
    const db = new Database(Buffer.from(parsed.database, 'base64'));
    try {
      change(db);
      return gzipSync(JSON.stringify({ ...parsed, database: db.serialize().toString('base64') }));
    } finally {
      db.close();
    }
  };
  for (const change of [
    (db) => db.exec('DROP TABLE word_test_items'),
    (db) => db.exec('DROP TRIGGER word_test_items_update'),
    (db) => db.exec("UPDATE word_test_items SET result='correct';UPDATE word_tests SET correct_count=1"),
    (db) => db.exec("DELETE FROM form_submission_receipts WHERE kind='word-test-answer'"),
    (db) => db.exec("UPDATE word_test_items SET source_books_json='[]'"),
    (db) => db.exec('UPDATE word_test_items SET audio_refs=\'[{"bad":1}]\''),
  ]) {
    await assert.rejects(c.app.backupService.restore(candidate(change)), /独立测试/);
    validateWordTests(c.db);
  }
  c.words.deleteWord(word.id, parent);
  c.books.remove(b.id, { expected_version: 1 }, parent);
  const deleted = fs.readFileSync(c.app.backupService.getPath((await c.app.backupService.create()).name));
  await c.app.backupService.restore(deleted);
  assert.equal(c.tests.get(test.id, parent).items[0].english_word_id, null);
  validateWordTests(c.db);
  for (const version of [42, 43, 44, 45]) {
    await c.app.backupService.restore(
      candidate((db) => {
        require('./legacy-word-tests-fixture')(db);
        if (version < 45) require('./legacy-word-study-scope-fixture')(db);
        if (version < 44) db.exec('DROP TABLE IF EXISTS word_import_receipts');
        if (version < 43) require('./legacy-word-books-fixture')(db);
        db.pragma(`user_version=${version}`);
      }),
    );
    assert.equal(c.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    assert.equal(c.db.prepare('SELECT COUNT(*) n FROM word_tests').get().n, 0);
    assert.equal(c.words.getWord(word.id).word, 'May');
    validateWordTests(c.db);
  }
});
test('scope filters, empty pools and creation receipts remain explicit after source deletion', async (t) => {
  const c = await fixture(t),
    b = c.book('范围筛选');
  const one = c.chars.createCharacter({
      child_id: c.child.id,
      char: '长',
      pinyin: 'chang2',
      categories: ['error_prone'],
    }),
    two = c.chars.createCharacter({ child_id: c.child.id, char: '行', pinyin: 'xing2' }),
    invalid = c.chars.createCharacter({ child_id: c.child.id, char: '学', pinyin: 'invalid' });
  c.chars.markMastered(one.id, true);
  for (const word of [one, two, invalid]) c.books.add(b.id, { character_id: word.id }, parent);
  const all = c.make([b.id]);
  assert.equal(all.total_count, 2);
  assert.equal(all.excluded_invalid_pinyin, 1);
  assert.deepEqual(
    c.make([b.id], { scope_filter: 'unmastered' }).items.map((item) => item.source_id),
    [two.id],
  );
  assert.deepEqual(
    c.make([b.id], { scope_filter: 'error_prone' }).items.map((item) => item.source_id),
    [one.id],
  );
  assert.throws(
    () => c.make([c.book('空本').id]),
    (e) => e.status === 400,
  );
  const body = {
    child_id: c.child.id,
    language: 'zh',
    skill: 'recognize',
    book_ids: [b.id],
    request_id: 'persistent-create-test-0001',
  };
  const first = c.tests.create(body, parent);
  assert.throws(
    () => c.tests.create({ ...body, limit: 1 }, parent),
    (e) => e.status === 409,
  );
  c.books.remove(b.id, { expected_version: 1 }, parent);
  assert.equal(c.tests.create(body, parent).id, first.id);
  c.db.prepare('DELETE FROM word_tests WHERE id=?').run(first.id);
  assert.throws(
    () => c.tests.create(body, parent),
    (e) => e.code === 'FORM_SUBMISSION_GONE',
  );
  c.answer(all, all.items[0], 'wrong');
  assert.throws(
    () => c.tests.retryWrong(all.id, { request_id: 'partial-retry-test-0001' }, parent),
    (e) => e.status === 409,
  );
  assert.throws(
    () => c.tests.markWrong(all.id, parent),
    (e) => e.status === 409,
  );
  validateWordTests(c.db);
});
test('concurrent confirmations accept only the first request and identical retries share one receipt', async (t) => {
  const c = await fixture(t),
    b = c.book('并发'),
    word = c.chars.createCharacter({ child_id: c.child.id, char: '学', pinyin: 'xue2' });
  c.books.add(b.id, { character_id: word.id }, parent);
  const first = c.make([b.id]),
    url = `/${first.id}/items/${first.items[0].id}/answer`;
  const results = await Promise.all([
    c.call('POST', url, { result: 'correct', request_id: 'concurrent-test-answer-0001' }),
    c.call('POST', url, { result: 'wrong', request_id: 'concurrent-test-answer-0002' }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(c.tests.get(first.id, parent).answered_count, 1);
  const second = c.make([b.id]),
    payload = { result: 'correct', request_id: 'same-concurrent-answer-0001' },
    path = `/${second.id}/items/${second.items[0].id}/answer`;
  assert.ok(
    (await Promise.all([c.call('POST', path, payload), c.call('POST', path, payload)])).every(
      (response) => response.statusCode === 200,
    ),
  );
  assert.equal(c.tests.get(second.id, parent).correct_count, 1);
  validateWordTests(c.db);
});
test('queued writes recheck sessions and database guards enforce source ownership', async (t) => {
  const c = await fixture(t),
    b = c.book('数据库'),
    word = c.chars.createCharacter({ child_id: c.child.id, char: '学', pinyin: 'xue2' });
  c.books.add(b.id, { character_id: word.id }, parent);
  const test = c.make([b.id]);
  c.books.remove(b.id, { expected_version: 1 }, parent);
  assert.throws(() => c.db.prepare('UPDATE characters SET child_id=? WHERE id=?').run(c.other.id, word.id));
  assert.throws(() => c.db.prepare('UPDATE word_tests SET child_id=? WHERE id=?').run(c.other.id, test.id));
  const foreign = c.chars.createCharacter({ child_id: c.other.id, char: '水', pinyin: 'shui3' });
  assert.throws(() =>
    c.db
      .prepare('UPDATE word_test_items SET character_id=?,source_id=? WHERE id=?')
      .run(foreign.id, foreign.id, test.items[0].id),
  );
  let release, reached;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    ready = new Promise((resolve) => {
      reached = resolve;
    }),
    hold = c.app.backupService.exclusive(() => gate),
    exclusive = c.app.backupService.exclusive.bind(c.app.backupService);
  c.app.backupService.exclusive = (fn) => {
    reached();
    return exclusive(fn);
  };
  const pending = c.call('POST', `/${test.id}/items/${test.items[0].id}/answer`, {
    result: 'correct',
    request_id: 'queued-test-answer-0001',
  });
  await ready;
  c.db.prepare("UPDATE settings SET value='new' WHERE key='auth_epoch'").run();
  release();
  await hold;
  assert.equal((await pending).statusCode, 401);
  assert.equal(c.tests.get(test.id, parent).answered_count, 0);
  validateWordTests(c.db);
});
