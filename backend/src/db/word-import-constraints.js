const fs = require('node:fs');
const path = require('node:path');
const { importResult } = require('../utils/word-import');
const { cleanText } = require('../utils/word-book');
const { validateEnglishWord } = require('../utils/english-word');
const compact = sql => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, '').replace(/ifnotexists/gi, '').replace(/;$/, '').toLowerCase();
const definitions = [...fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').matchAll(/CREATE (?:TABLE|INDEX) IF NOT EXISTS ((?:idx_)?word_import_receipts\w*)[\s\S]*?;/g)];
function validateWordImports(db) {
  for (const match of definitions) {
    const actual = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(match[1])?.sql;
    if (!actual || compact(actual) !== compact(match[0])) throw new Error('备份导入回执结构无效');
  }
  for (const row of db.prepare('SELECT * FROM word_import_receipts').iterate()) {
    const result = JSON.parse(row.result_json);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(row.id) || !/^[a-f0-9]{64}$/.test(row.fingerprint) || !['parent', 'child'].includes(row.actor) || !['zh', 'en'].includes(row.language) ||
      !db.prepare('SELECT 1 FROM children WHERE id = ?').get(row.child_id) || !Number.isFinite(Date.parse(row.created_at)) ||
      !Array.isArray(result.items) || result.items.length < 1 || result.items.length > (row.language === 'zh' ? 200 : 100) ||
      new Set(result.items.map(item => item.id)).size !== result.items.length ||
      result.items.some(item => typeof item.id !== 'string' || !item.id || typeof item.text !== 'string' || !item.text ||
        (row.language === 'zh' ? !/^\p{Script=Han}{1,8}$/u.test(item.text) : validateEnglishWord(item.text) !== item.text) ||
        !['added', 'linked', 'skipped'].includes(item.action) || Object.keys(item).some(key => !['id', 'text', 'action'].includes(key)))) throw new Error('备份导入回执数据无效');
    if (row.book_id === null ? row.book_name !== null || result.book !== null : row.actor !== 'parent' || typeof row.book_name !== 'string' || !row.book_name || result.book?.id !== row.book_id || result.book?.name !== row.book_name) throw new Error('备份导入词本快照无效');
    if (row.book_name !== null && cleanText(row.book_name, 80, '词本名称', true) !== row.book_name) throw new Error('备份导入词本名称无效');
    const expected = importResult(result.book, result.items);
    if (['added_count', 'linked_count', 'skipped_count'].some(key => result[key] !== expected[key]) || (!row.book_id && result.linked_count)) throw new Error('备份导入数量无效');
    // Deleted references are valid history; live references must still belong to this family scope.
    const book = row.book_id && db.prepare('SELECT child_id, language FROM word_books WHERE id = ?').get(row.book_id);
    if (book && (book.child_id !== row.child_id || book.language !== row.language)) throw new Error('备份导入词本归属无效');
    for (const item of result.items) {
      const entry = db.prepare(`SELECT child_id FROM ${row.language === 'zh' ? 'characters' : 'english_words'} WHERE id = ?`).get(item.id);
      if (entry && entry.child_id !== row.child_id) throw new Error('备份导入词条归属无效');
    }
  }
}
module.exports = { validateWordImports };
