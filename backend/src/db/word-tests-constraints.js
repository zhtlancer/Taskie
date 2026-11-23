const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cleanText } = require('../utils/word-book');
const { parsePinyinInput } = require('../utils/pinyin-input');
const { validateEnglishWord, compareSpellingAnswer } = require('../utils/english-word');
const { normalizeAudioRefs } = require('../utils/english-audio');
const compact = (sql) =>
  sql
    .replace(/--[^\n]*/g, '')
    .replace(/\s+/g, '')
    .replace(/ifnotexists/gi, '')
    .replace(/;$/, '')
    .toLowerCase();
const hash = (body) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(body)
            .sort()
            .map((key) => [key, body[key]]),
        ),
      ),
    )
    .digest('hex');
const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const bad = () => {
  throw new Error('备份独立测试数据或约束无效');
};
function validateWordTests(db) {
  const definitions = [
    ...fs
      .readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
      .matchAll(
        /CREATE TRIGGER IF NOT EXISTS (\w+)[\s\S]*?\nEND;|CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS (\w+)[\s\S]*?;/g,
      ),
  ].filter((match) => /^(?:word_test|idx_word_test)/.test(match[1] || match[2]));
  for (const match of definitions) {
    const actual = db.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(match[1] || match[2])?.sql;
    if (!actual || compact(actual) !== compact(match[0])) bad();
  }
  const tests = db.prepare('SELECT * FROM word_tests').all(),
    byId = new Map(tests.map((test) => [test.id, test]));
  for (const test of tests) {
    const ids = JSON.parse(test.book_ids_json),
      names = JSON.parse(test.book_names_json);
    if (
      !test.id ||
      !db.prepare('SELECT 1 FROM children WHERE id=?').get(test.child_id) ||
      !['zh', 'en'].includes(test.language) ||
      !['recognize', 'write'].includes(test.skill) ||
      !['all', 'unmastered', 'error_prone'].includes(test.scope_filter) ||
      !['ordered', 'shuffle'].includes(test.order_mode) ||
      !['parent', 'child'].includes(test.created_by) ||
      typeof test.title !== 'string' ||
      !test.title ||
      Array.from(test.title).length > 200 ||
      !validDate(test.created_at) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => typeof id !== 'string' || !id || id.length > 100) ||
      !Array.isArray(names) ||
      names.length !== ids.length ||
      names.some((name) => cleanText(name, 80, '词本名称', true) !== name) ||
      !Number.isSafeInteger(test.total_count) ||
      test.total_count < 1 ||
      test.total_count > 200 ||
      !Number.isSafeInteger(test.answered_count) ||
      !Number.isSafeInteger(test.correct_count) ||
      !Number.isSafeInteger(test.excluded_no_definition) ||
      test.excluded_no_definition < 0 ||
      !Number.isSafeInteger(test.excluded_invalid_pinyin) ||
      test.excluded_invalid_pinyin < 0
    )
      bad();
    for (const id of ids) {
      const live = db.prepare('SELECT child_id,language FROM word_books WHERE id=?').get(id);
      if (live && (live.child_id !== test.child_id || live.language !== test.language)) bad();
    }
    if (test.parent_test_id) {
      const parent = byId.get(test.parent_test_id);
      if (
        !parent ||
        parent.status !== 'completed' ||
        parent.child_id !== test.child_id ||
        parent.language !== test.language ||
        parent.skill !== test.skill
      )
        bad();
    }
    const items = db.prepare('SELECT * FROM word_test_items WHERE test_id=? ORDER BY position').all(test.id);
    if (items.length !== test.total_count) bad();
    let answered = 0,
      correct = 0;
    const identities = new Set();
    for (const [position, item] of items.entries()) {
      const sources = JSON.parse(item.source_books_json),
        zh = test.language === 'zh';
      if (
        !item.id ||
        item.position !== position ||
        item.language !== test.language ||
        typeof item.source_id !== 'string' ||
        !item.source_id ||
        item.source_id.length > 100 ||
        !Array.isArray(sources) ||
        !sources.length ||
        sources.length > ids.length ||
        new Set(sources.map((source) => source.id)).size !== sources.length ||
        sources.some((source) => !ids.includes(source.id) || source.name !== names[ids.indexOf(source.id)])
      )
        bad();
      if (zh) {
        if (
          item.english_word_id !== null ||
          item.strict_case !== 0 ||
          item.audio_refs !== null ||
          parsePinyinInput(item.pinyin, item.text) !== item.pinyin
        )
          bad();
      } else if (
        item.character_id !== null ||
        item.pinyin !== null ||
        ![0, 1].includes(item.strict_case) ||
        validateEnglishWord(item.text) !== item.text ||
        (!item.meaning_zh?.trim() && !item.meaning_en?.trim())
      )
        bad();
      if (
        [
          ['phonetic', 80],
          ['meaning_zh', 400],
          ['meaning_en', 400],
        ].some(
          ([key, max]) => item[key] !== null && (typeof item[key] !== 'string' || item[key].length > max),
        )
      )
        bad();
      const col = zh ? 'character_id' : 'english_word_id',
        table = zh ? 'characters' : 'english_words';
      if (item[col] !== null) {
        const word = db.prepare(`SELECT child_id FROM ${table} WHERE id=?`).get(item[col]);
        if (item[col] !== item.source_id || !word || word.child_id !== test.child_id) bad();
      }
      if (
        item.audio_refs !== null &&
        normalizeAudioRefs(JSON.parse(item.audio_refs)).some((ref) => ref.headword !== item.text)
      )
        bad();
      const identity = JSON.stringify([item.source_id, item.pinyin]);
      if (identities.has(identity)) bad();
      identities.add(identity);
      if (item.result === null) {
        if (
          item.typed_answer !== null ||
          item.answered_at !== null ||
          item.answered_by !== null ||
          item.answer_request_id !== null
        )
          bad();
        continue;
      }
      if (
        !['correct', 'wrong'].includes(item.result) ||
        !validDate(item.answered_at) ||
        !['parent', 'child'].includes(item.answered_by) ||
        typeof item.answer_request_id !== 'string'
      )
        bad();
      const spelling = !zh && test.skill === 'write';
      if (
        spelling
          ? typeof item.typed_answer !== 'string' ||
            item.typed_answer.length > 1000 ||
            (compareSpellingAnswer(item.typed_answer, item.text, Boolean(item.strict_case)).is_correct
              ? 'correct'
              : 'wrong') !== item.result
          : item.typed_answer !== null
      )
        bad();
      const receipt = db
        .prepare('SELECT * FROM form_submission_receipts WHERE id=?')
        .get(item.answer_request_id);
      const body = {
        test_id: test.id,
        item_id: item.id,
        ...(spelling ? { typed_answer: item.typed_answer } : { result: item.result }),
      };
      if (
        !receipt ||
        receipt.kind !== 'word-test-answer' ||
        receipt.record_id !== item.id ||
        receipt.child_id !== test.child_id ||
        receipt.actor !== item.answered_by ||
        receipt.fingerprint !== hash(body)
      )
        bad();
      answered++;
      if (item.result === 'correct') correct++;
    }
    if (
      answered !== test.answered_count ||
      correct !== test.correct_count ||
      (answered === test.total_count
        ? test.status !== 'completed' || !validDate(test.completed_at)
        : test.status !== 'in_progress' || test.completed_at !== null)
    )
      bad();
  }
  const checked = new Set();
  for (const test of tests) {
    const seen = new Set();
    let current = test;
    while (current && !checked.has(current.id)) {
      if (seen.has(current.id)) bad();
      seen.add(current.id);
      current = byId.get(current.parent_test_id);
    }
    for (const id of seen) checked.add(id);
  }
  for (const receipt of db
    .prepare("SELECT * FROM form_submission_receipts WHERE kind LIKE 'word-test-%'")
    .iterate()) {
    if (
      !['word-test-create', 'word-test-retry', 'word-test-answer'].includes(receipt.kind) ||
      !['parent', 'child'].includes(receipt.actor) ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(receipt.id) ||
      !/^[a-f0-9]{64}$/.test(receipt.fingerprint) ||
      !validDate(receipt.created_at)
    )
      bad();
    if (receipt.kind === 'word-test-answer') {
      const item = db
        .prepare(
          'SELECT i.answer_request_id,t.child_id FROM word_test_items i JOIN word_tests t ON t.id=i.test_id WHERE i.id=?',
        )
        .get(receipt.record_id);
      if (item && (item.answer_request_id !== receipt.id || item.child_id !== receipt.child_id)) bad();
    } else {
      const test = byId.get(receipt.record_id);
      if (test && (test.child_id !== receipt.child_id || test.created_by !== receipt.actor)) bad();
    }
  }
  if (db.pragma('foreign_key_check').length) bad();
}
module.exports = { validateWordTests };
