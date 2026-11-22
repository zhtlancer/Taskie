const { createHash } = require('node:crypto');
const { generateId } = require('./crypto');
const fail = message => ({ status: 400, message });
function cleanText(value, max, label, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw fail(`${label}格式无效`);
  const clean = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (Array.from(clean).length > max || (required && !clean)) throw fail(`${label}${required ? '须为 1 到' : '最多'} ${max} 字`);
  return clean;
}
const nameKey = value => cleanText(value, 80, '词本名称', true).toLowerCase();
const defaultName = (source, unit) => Array.from([source, unit].filter(Boolean).join(' · ')).slice(0, 80).join('');
function bookMetadata(data) {
  const source = cleanText(data.source, 60, '来源'), unit = cleanText(data.unit, 60, '单元');
  const name = cleanText(data.name ?? defaultName(source, unit), 80, '词本名称', true);
  const sourceType = data.source_type ?? '';
  if (!['', 'textbook', 'material', 'custom'].includes(sourceType)) throw fail('来源类型无效');
  return { name, name_key: nameKey(name), source, unit, source_type: sourceType, note: cleanText(data.note, 200, '备注') };
}
function ensureLegacyMembership(db, word) {
  const source = cleanText(word.textbook, 60, '来源'), unit = cleanText(word.unit, 60, '单元');
  if (!source && !unit) return null;
  const key = JSON.stringify([source, unit]);
  let book = db.prepare("SELECT * FROM word_books WHERE child_id = ? AND language = 'en' AND legacy_key = ?").get(word.child_id, key);
  if (!book) {
    const title = defaultName(source, unit);
    let name = title, attempt = 0;
    while (db.prepare("SELECT 1 FROM word_books WHERE child_id = ? AND language = 'en' AND name_key = ?").get(word.child_id, nameKey(name))) {
      const suffix = ` · ${createHash('sha256').update(key + ':' + attempt++).digest('hex').slice(0, 10)}`;
      name = Array.from(title).slice(0, 80 - suffix.length).join('') + suffix;
    }
    const now = new Date().toISOString();
    book = { id: generateId(), child_id: word.child_id, language: 'en', ...bookMetadata({ name, source, unit, source_type: 'textbook' }) };
    db.prepare(`INSERT INTO word_books (id, child_id, language, name, name_key, source, unit, source_type, note, legacy_key, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(book.id, book.child_id, 'en', book.name, book.name_key, source, unit, 'textbook', '', key, now, now);
  }
  if (!db.prepare('SELECT 1 FROM word_book_items WHERE book_id = ? AND english_word_id = ?').get(book.id, word.id)) {
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM word_book_items WHERE book_id = ?').get(book.id).next;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO word_book_items (id, book_id, language, english_word_id, position, created_at, updated_at) VALUES (?, ?, 'en', ?, ?, ?, ?)`)
      .run(generateId(), book.id, word.id, position, now, now);
  }
  return book.id;
}
module.exports = { cleanText, nameKey, defaultName, bookMetadata, ensureLegacyMembership };
