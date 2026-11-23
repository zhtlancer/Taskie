const fs = require('node:fs');
const path = require('node:path');
const { bookIds } = require('../utils/word-study-scope');
const { parsePinyinInput } = require('../utils/pinyin-input');
const { validateEnglishWord } = require('../utils/english-word');
const SCOPE_COLUMNS = {
  scope_mode: "TEXT NOT NULL DEFAULT 'all' CHECK(scope_mode IN ('all', 'books', 'legacy'))",
  book_ids: "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(book_ids) AND json_type(book_ids) = 'array' AND json_array_length(book_ids) <= 200)"
};
const DAY_SCOPE_COLUMNS = { ...SCOPE_COLUMNS,
  scope_books: "TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(scope_books) AND json_type(scope_books) = 'array')",
  scope_excluded_no_definition: "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(scope_excluded_no_definition) = 'integer' AND scope_excluded_no_definition >= 0)",
  scope_excluded_pinyin: "INTEGER NOT NULL DEFAULT 0 CHECK(typeof(scope_excluded_pinyin) = 'integer' AND scope_excluded_pinyin >= 0)"
};
const compact = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, '').replace(/ifnotexists/gi, '').replace(/;$/, '').toLowerCase();
function validateWordStudyScopes(db) {
  for (const [table, columns] of [['word_study_plans', SCOPE_COLUMNS], ['word_study_days', DAY_SCOPE_COLUMNS]]) {
    const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table)?.sql || '';
    for (const [name, definition] of Object.entries(columns)) if (!compact(sql).includes(compact(name + ' ' + definition))) throw new Error('备份学习词本范围结构无效');
    for (const row of db.prepare(`SELECT * FROM ${table}`).iterate()) {
      const ids = JSON.parse(row.book_ids), clean = bookIds(ids);
      if (clean.length !== ids.length || !['all', 'books', 'legacy'].includes(row.scope_mode) || (row.scope_mode !== 'books' && ids.length) ||
        (row.scope_mode === 'legacy' && (row.language !== 'en' || (!row.textbook && !JSON.parse(row.units).length)))) throw new Error('备份学习词本范围无效');
      if (table === 'word_study_plans') {
        for (const id of ids) if (!db.prepare('SELECT 1 FROM word_books WHERE id = ? AND child_id = ? AND language = ?').get(id, row.child_id, row.language)) throw new Error('备份学习词本归属无效');
      } else {
        const books = JSON.parse(row.scope_books);
        if (!Array.isArray(books) || books.length !== ids.length || books.some((book, i) => book.id !== ids[i] || typeof book.name !== 'string' || !book.name || Array.from(book.name).length > 80) ||
          (row.scope_mode === 'books' && !ids.length) || !Number.isSafeInteger(row.scope_excluded_no_definition) || row.scope_excluded_no_definition < 0 || !Number.isSafeInteger(row.scope_excluded_pinyin) || row.scope_excluded_pinyin < 0) throw new Error('备份当日词本快照无效');
        for (const id of ids) {
          const live = db.prepare('SELECT child_id, language FROM word_books WHERE id = ?').get(id);
          if (live && (live.child_id !== row.child_id || live.language !== row.language)) throw new Error('备份当日词本快照归属无效');
        }
      }
    }
  }
  const definitions = [...fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .matchAll(/CREATE TRIGGER IF NOT EXISTS (\w+)[\s\S]*?\nEND;|CREATE (?:UNIQUE )?(?:TABLE|INDEX) IF NOT EXISTS (\w+)[\s\S]*?;/g)]
    .filter(match => /^(?:word_study_day_scope|idx_word_study_day_scope)/.test(match[1] || match[2]));
  for (const match of definitions) {
    const actual = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(match[1] || match[2])?.sql;
    if (!actual || compact(actual) !== compact(match[0])) throw new Error('备份学习范围成员约束无效');
  }
  for (const row of db.prepare(`SELECT s.*, d.child_id, d.language AS day_language, d.scope_mode, d.scope_books,
    c.child_id AS char_child, w.child_id AS word_child FROM word_study_day_scope_items s JOIN word_study_days d ON d.id = s.day_id
    LEFT JOIN characters c ON c.id = s.character_id LEFT JOIN english_words w ON w.id = s.english_word_id`).iterate()) {
    const book = JSON.parse(row.scope_books).find(book => book.id === row.source_book_id);
    if (row.scope_mode !== 'books' || row.language !== row.day_language || !book || book.name !== row.source_book_name || !row.source_id ||
      !Number.isSafeInteger(row.position) || row.position < 0 ||
      (row.language === 'zh' ? row.english_word_id !== null || (row.character_id !== null && (row.character_id !== row.source_id || row.char_child !== row.child_id)) || parsePinyinInput(row.pinyin, row.text) !== row.pinyin
        : row.language !== 'en' || row.character_id !== null || row.pinyin !== null || validateEnglishWord(row.text) !== row.text || (row.english_word_id !== null && (row.english_word_id !== row.source_id || row.word_child !== row.child_id)))) throw new Error('备份学习范围成员数据无效');
  }
  if (db.pragma('foreign_key_check').length) throw new Error('备份学习范围成员引用无效');
}
module.exports = { SCOPE_COLUMNS, DAY_SCOPE_COLUMNS, validateWordStudyScopes };
