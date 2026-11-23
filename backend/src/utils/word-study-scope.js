const { reading } = require('../services/character-imports.service');
const fail = message => ({ status: 400, message });
const list = value => Array.isArray(value) ? value : JSON.parse(value || '[]');
function bookIds(raw) {
  if (!Array.isArray(raw) || raw.length > 200 || raw.some(id => typeof id !== 'string' || !id || id.length > 100)) throw fail('词本范围格式无效，最多选择 200 本');
  return [...new Set(raw)];
}
function ownedBooks(db, childId, language, ids) {
  return ids.map(id => {
    const book = db.prepare('SELECT id, child_id, language, name FROM word_books WHERE id = ?').get(id);
    if (!book) throw fail('所选词本已被删除，请重新选择');
    if (book.child_id !== childId || book.language !== language) throw { status: 403, message: '词本不属于当前孩子或语言' };
    return book;
  });
}
function scopeConfig(db, childId, language, data, previous, textbook, units) {
  if (data.scope_mode !== undefined && typeof data.scope_mode !== 'string') throw fail('学习范围无效');
  let mode = data.scope_mode ?? previous?.scope_mode ?? 'all';
  if (data.scope_mode === undefined && previous?.scope_mode !== 'books' && (data.textbook !== undefined || data.units !== undefined)) mode = textbook || units.length ? 'legacy' : 'all';
  if (!['all', 'books', 'legacy'].includes(mode)) throw fail('学习范围无效');
  const ids = bookIds(data.book_ids ?? (mode === 'books' ? previous?.book_ids || [] : []));
  if (mode !== 'books' && ids.length) throw fail('全部或旧教材范围不能同时指定词本');
  if (mode !== 'legacy' && ((data.textbook != null && String(data.textbook).trim()) || (Array.isArray(data.units) && data.units.length))) throw fail('词本范围与旧教材范围不能同时指定');
  if (mode === 'books') {
    if (!ids.length) throw fail('请至少选择一本有效词本');
    ownedBooks(db, childId, language, ids);
  }
  if (mode === 'legacy' && (language !== 'en' || (!textbook && !units.length))) throw fail('旧教材范围无效');
  return { scope_mode: mode, book_ids: ids, textbook: mode === 'legacy' ? textbook : null, units: mode === 'legacy' ? units : [] };
}
function currentBookScope(db, childId, language, rawIds) {
  const ids = bookIds(list(rawIds)), books = ownedBooks(db, childId, language, ids), members = new Map(), readings = new Map();
  for (const book of books) {
    const col = language === 'zh' ? 'character_id' : 'english_word_id', table = language === 'zh' ? 'characters' : 'english_words';
    const rows = db.prepare(`SELECT w.*, i.pinyin_override FROM word_book_items i JOIN ${table} w ON w.id = i.${col} WHERE i.book_id = ? ORDER BY i.position, i.id`).all(book.id);
    for (const row of rows) {
      const choice = { id: row.id, text: row.char || row.word, pinyin: null, source_book_id: book.id, source_book_name: book.name };
      if (language === 'zh') {
        try { choice.pinyin = reading(row.char, row.pinyin_override || row.pinyin || '').pinyin; }
        catch (error) { choice.error = error.message; }
        if (!readings.has(row.id)) readings.set(row.id, []);
        readings.get(row.id).push(choice);
      }
      if (!members.has(row.id)) members.set(row.id, choice);
    }
  }
  const conflicts = [...readings].filter(([, choices]) => new Set(choices.map(choice => choice.pinyin)).size > 1)
    .map(([id, choices]) => ({ id, text: choices[0].text, chosen: choices[0], choices }));
  const invalid = [...members.values()].filter(choice => choice.error);
  return { books: books.map(({ id, name }) => ({ id, name })), members, conflicts, invalid };
}
function frozenBookScope(db, day) {
  return new Map(db.prepare('SELECT * FROM word_study_day_scope_items WHERE day_id = ? AND (character_id IS NOT NULL OR english_word_id IS NOT NULL) ORDER BY position').all(day.id)
    .map(row => [row.source_id, row]));
}
module.exports = { bookIds, ownedBooks, scopeConfig, currentBookScope, frozenBookScope };
