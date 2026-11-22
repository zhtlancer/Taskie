const fs = require('node:fs');
const path = require('node:path');
const { bookMetadata } = require('../utils/word-book');
const { parsePinyinInput } = require('../utils/pinyin-input');
const compact = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, '').replace(/ifnotexists/gi, '').replace(/;$/, '').toLowerCase();
// Compare the canonical schema, including foreign-key actions and triggers, before initDb
// can repair a tampered current-version backup. This avoids a second set of table definitions.
const definitions = [...fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  .matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)[\s\S]*?\nEND;|CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS (\w+)[\s\S]*?;/g)]
  .map(match => ({ name: match[1] || match[2], sql: match[0] }))
  .filter(({ name }) => /^(?:word_books|word_book_items|word_book_character_owner|word_book_english_owner|idx_word_book)/.test(name));
function validateWordBooks(db) {
  for (const expected of definitions) {
    const actual = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(expected.name)?.sql;
    if (!actual || compact(actual) !== compact(expected.sql)) throw new Error('备份词本结构或约束无效');
  }
  const dateOk = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  for (const book of db.prepare('SELECT * FROM word_books').iterate()) {
    const clean = bookMetadata(book);
    if (Object.keys(clean).some(key => clean[key] !== book[key]) || !dateOk(book.created_at) || !dateOk(book.updated_at) ||
      !Number.isSafeInteger(book.version) || book.version < 1 || !['zh', 'en'].includes(book.language) || !book.id ||
      !db.prepare('SELECT 1 FROM children WHERE id = ?').get(book.child_id) ||
      (book.legacy_key !== null && (book.language !== 'en' || book.legacy_key !== JSON.stringify([book.source, book.unit])))) {
      throw new Error('备份词本数据无效');
    }
  }
  for (const item of db.prepare(`SELECT i.*, b.child_id, b.language AS book_language, c.char, c.child_id AS char_child, w.child_id AS word_child
    FROM word_book_items i LEFT JOIN word_books b ON b.id = i.book_id
    LEFT JOIN characters c ON c.id = i.character_id LEFT JOIN english_words w ON w.id = i.english_word_id`).iterate()) {
    if (!item.id || item.language !== item.book_language ||
      (item.language === 'zh' ? (!item.character_id || item.english_word_id !== null || item.char_child !== item.child_id)
        : item.language !== 'en' || !item.english_word_id || item.character_id !== null || item.word_child !== item.child_id) ||
      !Number.isSafeInteger(item.position) || item.position < 0 || !Number.isSafeInteger(item.version) || item.version < 1 ||
      !dateOk(item.created_at) || !dateOk(item.updated_at) ||
      (item.pinyin_override !== null && (item.language !== 'zh' || parsePinyinInput(item.pinyin_override, item.char) !== item.pinyin_override))) {
      throw new Error('备份词本关联无效');
    }
  }
  if (db.pragma('foreign_key_check').length) throw new Error('备份词本关联损坏');
}
module.exports = { validateWordBooks };
