const { generateId } = require('../utils/crypto');
const { bookMetadata } = require('../utils/word-book');
const { parsePinyinInput } = require('../utils/pinyin-input');
const fail = (status, message) => ({ status, message });
function access(actor, childId, write = false) {
  if (!actor || !['parent', 'child'].includes(actor.role) || (actor.role === 'child' && (write || actor.child_id !== childId))) {
    throw fail(403, write ? '需要家长权限' : '无权访问其他孩子的数据');
  }
}
function version(expected, current) {
  if (!Number.isSafeInteger(expected) || expected < 1) throw fail(400, '缺少有效版本，请刷新后重试');
  if (expected !== current) throw fail(409, '内容已被修改，请读取最新内容后核对');
}
function pageOptions({ limit = 100, offset = 0 } = {}) {
  const size = Number(limit), start = Number(offset);
  if (!Number.isSafeInteger(size) || size < 1 || size > 200 || !Number.isSafeInteger(start) || start < 0) throw fail(400, '分页参数无效');
  return { size, start };
}
const publicBook = book => { const { legacy_key, name_key, ...result } = book; return result; };
class WordBooksService {
  constructor(db) { this.db = db; }
  child(childId, language, actor, write = false) {
    access(actor, childId, write);
    if (!childId || !['zh', 'en'].includes(language)) throw fail(400, '请选择孩子和学习语言');
    if (!this.db.prepare('SELECT 1 FROM children WHERE id = ?').get(childId)) throw fail(404, '孩子不存在');
  }
  get(id, actor, write = false) {
    const book = this.db.prepare('SELECT * FROM word_books WHERE id = ?').get(id);
    if (!book) throw fail(404, '词本不存在，可能已被删除');
    access(actor, book.child_id, write);
    const plan_count = this.db.prepare(`SELECT COUNT(*) n FROM word_study_plans p WHERE p.child_id = ? AND p.language = ? AND p.scope_mode = 'books'
      AND EXISTS (SELECT 1 FROM json_each(p.book_ids) WHERE value = ?)`).get(book.child_id, book.language, book.id).n;
    return { ...publicBook(book), plan_count, recent_test: this.recentTest(book) };
  }
  list(query, actor) {
    const { child_id, language } = query;
    this.child(child_id, language, actor);
    const { size, start } = pageOptions(query);
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM word_books WHERE child_id = ? AND language = ?').get(child_id, language).n;
    const items = this.db.prepare(`SELECT b.*,
      (SELECT COUNT(*) FROM word_book_items i WHERE i.book_id = b.id) AS item_count,
      (SELECT COUNT(*) FROM word_book_items i LEFT JOIN characters c ON c.id = i.character_id
        LEFT JOIN english_words w ON w.id = i.english_word_id WHERE i.book_id = b.id AND COALESCE(c.is_mastered, w.is_mastered, 0) = 0) AS unmastered_count
      , (SELECT COUNT(*) FROM word_study_plans p WHERE p.child_id = b.child_id AND p.language = b.language AND p.scope_mode = 'books'
        AND EXISTS (SELECT 1 FROM json_each(p.book_ids) WHERE value = b.id)) AS plan_count
      FROM word_books b WHERE b.child_id = ? AND b.language = ? ORDER BY b.created_at, b.id LIMIT ? OFFSET ?`)
      .all(child_id, language, size, start).map(book => ({ ...publicBook(book), recent_test: this.recentTest(book) }));
    return { items, total, next_offset: start + items.length < total ? start + items.length : null };
  }
  recentTest(book) {
    return this.db.prepare(`SELECT t.id, t.title, t.completed_at, COUNT(*) AS total_count,
      COALESCE(SUM(i.result = 'correct'), 0) AS correct_count FROM word_tests t JOIN word_test_items i ON i.test_id = t.id
      WHERE t.child_id = ? AND t.language = ? AND t.status = 'completed'
      AND EXISTS (SELECT 1 FROM json_each(t.book_ids_json) WHERE value = ?)
      AND EXISTS (SELECT 1 FROM json_each(i.source_books_json) WHERE json_extract(value, '$.id') = ?)
      GROUP BY t.id ORDER BY t.completed_at DESC, t.id DESC LIMIT 1`).get(book.child_id, book.language, book.id, book.id) || null;
  }
  create(data, actor) {
    this.child(data.child_id, data.language, actor, true);
    const meta = bookMetadata(data), now = new Date().toISOString(), id = generateId();
    if (this.db.prepare('SELECT 1 FROM word_books WHERE child_id = ? AND language = ? AND name_key = ?').get(data.child_id, data.language, meta.name_key)) throw fail(409, '已有同名词本，请换个名称');
    this.db.prepare(`INSERT INTO word_books (id, child_id, language, name, name_key, source, unit, source_type, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, data.child_id, data.language, meta.name, meta.name_key, meta.source, meta.unit, meta.source_type, meta.note, now, now);
    return this.get(id, actor);
  }
  update(id, data, actor) {
    const book = this.get(id, actor, true);
    if ((data.child_id !== undefined && data.child_id !== book.child_id) || (data.language !== undefined && data.language !== book.language)) throw fail(400, '不能修改词本的孩子或语言');
    version(data.expected_version, book.version);
    const meta = bookMetadata({ ...book, ...data });
    if (this.db.prepare('SELECT 1 FROM word_books WHERE child_id = ? AND language = ? AND name_key = ? AND id != ?').get(book.child_id, book.language, meta.name_key, id)) throw fail(409, '已有同名词本，请换个名称');
    this.db.prepare(`UPDATE word_books SET name = ?, name_key = ?, source = ?, unit = ?, source_type = ?, note = ?,
      legacy_key = CASE WHEN source = ? AND unit = ? THEN legacy_key ELSE NULL END, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(meta.name, meta.name_key, meta.source, meta.unit, meta.source_type, meta.note, meta.source, meta.unit, new Date().toISOString(), id);
    return this.get(id, actor);
  }
  remove(id, data, actor) {
    return this.db.transaction(() => {
      const book = this.get(id, actor, true); version(data.expected_version, book.version);
      for (const plan of this.db.prepare("SELECT id, book_ids FROM word_study_plans WHERE child_id = ? AND language = ? AND scope_mode = 'books'").all(book.child_id, book.language)) {
        const ids = JSON.parse(plan.book_ids);
        if (ids.includes(id)) this.db.prepare('UPDATE word_study_plans SET book_ids = ? WHERE id = ?').run(JSON.stringify(ids.filter(value => value !== id)), plan.id);
      }
      this.db.prepare('DELETE FROM word_books WHERE id = ?').run(id);
      return { success: true };
    })();
  }
  item(bookId, itemId, actor, write = false) {
    const book = this.get(bookId, actor, write);
    const row = this.db.prepare(`SELECT i.*, COALESCE(c.char, w.word) AS text, c.pinyin,
      COALESCE(i.pinyin_override, c.pinyin) AS effective_pinyin, COALESCE(c.is_mastered, w.is_mastered) AS is_mastered
      FROM word_book_items i LEFT JOIN characters c ON c.id = i.character_id LEFT JOIN english_words w ON w.id = i.english_word_id
      WHERE i.id = ? AND i.book_id = ?`).get(itemId, bookId);
    if (!row) throw fail(404, '词本条目不存在，可能已被移出');
    return { ...row, child_id: book.child_id, is_mastered: Boolean(row.is_mastered) };
  }
  items(bookId, query, actor) {
    this.get(bookId, actor);
    const { size, start } = pageOptions(query);
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM word_book_items WHERE book_id = ?').get(bookId).n;
    const rows = this.db.prepare('SELECT id FROM word_book_items WHERE book_id = ? ORDER BY position, id LIMIT ? OFFSET ?').all(bookId, size, start);
    return { items: rows.map(row => this.item(bookId, row.id, actor)), total, next_offset: start + rows.length < total ? start + rows.length : null };
  }
  add(bookId, data, actor) {
    const book = this.get(bookId, actor, true);
    const isZh = book.language === 'zh', col = isZh ? 'character_id' : 'english_word_id', other = isZh ? 'english_word_id' : 'character_id';
    if (typeof data[col] !== 'string' || !data[col] || data[other] != null) throw fail(400, '词条语言与词本不一致');
    const entry = this.db.prepare(`SELECT * FROM ${isZh ? 'characters' : 'english_words'} WHERE id = ?`).get(data[col]);
    if (!entry) throw fail(404, '原词条不存在');
    if (entry.child_id !== book.child_id) throw fail(403, '不能关联其他孩子的词条');
    if (!isZh && data.pinyin_override != null) throw fail(400, '英语词本不能设置拼音');
    const pinyin = data.pinyin_override == null || data.pinyin_override === '' ? null : parsePinyinInput(data.pinyin_override, entry.char);
    const existing = this.db.prepare(`SELECT id, pinyin_override FROM word_book_items WHERE book_id = ? AND ${col} = ?`).get(bookId, entry.id);
    if (existing) {
      if (data.pinyin_override !== undefined && pinyin !== existing.pinyin_override) throw fail(409, '词本内已有其它读音，请编辑已有条目后重试');
      return this.item(bookId, existing.id, actor);
    }
    const id = generateId(), now = new Date().toISOString();
    const position = this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM word_book_items WHERE book_id = ?').get(bookId).n;
    this.db.prepare(`INSERT INTO word_book_items (id, book_id, language, ${col}, position, pinyin_override, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, bookId, book.language, entry.id, position, pinyin, now, now);
    return this.item(bookId, id, actor);
  }
  updateItem(bookId, itemId, data, actor) {
    const item = this.item(bookId, itemId, actor, true); version(data.expected_version, item.version);
    for (const key of ['book_id', 'character_id', 'english_word_id', 'language']) if (data[key] !== undefined && data[key] !== item[key]) throw fail(400, '不能更换关联的词本或词条');
    if (item.language !== 'zh') throw fail(400, '英语词本没有可编辑的拼音');
    const pinyin = data.pinyin_override === undefined ? item.pinyin_override
      : data.pinyin_override == null || data.pinyin_override === '' ? null : parsePinyinInput(data.pinyin_override, item.text);
    this.db.prepare('UPDATE word_book_items SET pinyin_override = ?, version = version + 1, updated_at = ? WHERE id = ?').run(pinyin, new Date().toISOString(), itemId);
    return this.item(bookId, itemId, actor);
  }
  removeItem(bookId, itemId, data, actor) {
    const item = this.item(bookId, itemId, actor, true); version(data.expected_version, item.version);
    this.db.prepare('DELETE FROM word_book_items WHERE id = ?').run(itemId);
    return { success: true };
  }
}
module.exports = WordBooksService;
