const { pinyin } = require('pinyin-pro');
const { parsePinyinInput } = require('../utils/pinyin-input');
const { bookMetadata } = require('../utils/word-book');
const { checkImportActor, importSubmission, importResult } = require('../utils/word-import');
const WordBooksService = require('./word-books.service');
const fail = (status, message) => ({ status, message });
function rowsFrom(data) {
  if (data.items !== undefined) {
    if (data.text !== undefined || !Array.isArray(data.items) || data.items.length < 1 || data.items.length > 200) throw fail(400, '每批请输入 1 到 200 条字词');
    return data.items.map(item => item && typeof item === 'object' && !Array.isArray(item) ? { ...item } : { error: '条目格式无效' });
  }
  if (typeof data.text !== 'string' || data.text.length > 50000) throw fail(400, '请输入不超过 50000 字符的字词列表');
  const rows = [];
  for (const line of data.text.split(/\r?\n/).filter(line => line.trim())) {
    if (line.includes('\t')) {
      const cols = line.split('\t');
      rows.push(cols.length === 2 ? { char: cols[0].trim(), pinyin: cols[1].trim() } : { char: cols[0].trim(), error: '表格须为汉字、拼音两列' });
    } else for (const char of line.split(/[,，、]/).filter(part => part.trim())) rows.push({ char: char.trim(), pinyin: '' });
  }
  if (!rows.length || rows.length > 200) throw fail(400, '每批请输入 1 到 200 条字词（合并重复前计算）');
  return rows;
}
function reading(text, raw) {
  if (!/^\p{Script=Han}{1,8}$/u.test(text || '')) throw fail(400, '每条须为 1 到 8 个汉字');
  if (raw !== undefined && typeof raw !== 'string') throw fail(400, '拼音须为文字');
  const automatic = !raw?.trim();
  let value;
  try { value = parsePinyinInput(automatic ? pinyin(text, { toneType: 'symbol', type: 'array' }).join(' ') : raw, text); }
  catch (error) { if (automatic) throw fail(400, '无法自动注音，请手工填写拼音'); throw error; }
  return { pinyin: value, automatic, needs_confirmation: automatic };
}
class CharacterImportsService {
  constructor(db, characters) { this.db = db; this.characters = characters; this.books = new WordBooksService(db); }
  target(data, actor) {
    if (data.book_id != null && data.book_id !== '' && data.book_meta != null) throw fail(400, '请选择已有词本或新建词本，不可同时指定');
    if (data.book_meta != null) { bookMetadata(data.book_meta); return null; }
    if (!data.book_id) return null;
    if (typeof data.book_id !== 'string') throw fail(400, '词本编号无效');
    const book = this.books.get(data.book_id, actor, true);
    if (book.child_id !== data.child_id) throw fail(403, '不能导入其他孩子的词本');
    if (book.language !== 'zh') throw fail(400, '请选择语文词本');
    return book;
  }
  preview(data, actor) {
    checkImportActor(this.db, data, actor);
    const book = this.target(data, actor), rows = rowsFrom(data);
    const items = rows.map((row, index) => {
      const item = { index, char: typeof row.char === 'string' ? row.char.trim() : '', input_pinyin: row.pinyin ?? '', status: 'invalid' };
      try {
        if (row.error) throw fail(400, row.error);
        Object.assign(item, reading(item.char, row.pinyin));
        const existing = this.db.prepare('SELECT id, pinyin FROM characters WHERE child_id = ? AND char = ?').get(data.child_id, item.char);
        item.existing_id = existing?.id || null;
        const member = book && existing && this.db.prepare('SELECT * FROM word_book_items WHERE book_id = ? AND character_id = ?').get(book.id, existing.id);
        item.status = existing ? book || data.book_meta ? 'link' : 'existing' : 'new';
        if (member) {
          let current;
          try { current = reading(item.char, member.pinyin_override || existing.pinyin).pinyin; } catch {}
          item.status = current === item.pinyin ? 'in_book' : 'conflict';
          if (item.status === 'conflict') item.error = '本词本已有其它读音，请到管理词条中核对后修改';
        }
      } catch (error) { item.error = error.message; }
      return item;
    });
    const byText = new Map();
    for (const item of items.filter(item => item.status !== 'invalid')) {
      if (!byText.has(item.char)) byText.set(item.char, []);
      byText.get(item.char).push(item);
    }
    for (const group of byText.values()) {
      if (new Set(group.map(item => item.pinyin)).size > 1) for (const item of group) {
        item.status = 'conflict'; item.error = '同批同字有不同读音，请只选择一种读音后重新预览';
      }
    }
    return { items, book: book ? { id: book.id, name: book.name } : null };
  }
  commit(data, actor) {
    return importSubmission(this.db, data, actor, 'zh', () => {
      if (!Array.isArray(data.items) || data.text !== undefined) throw fail(400, '请提交已确认的条目');
      const preview = this.preview(data, actor);
      if (preview.items.some(item => ['invalid', 'conflict'].includes(item.status))) throw fail(400, '所选条目存在无效数据或读音冲突，请重新预览');
      const book = data.book_meta ? this.books.create({ ...data.book_meta, child_id: data.child_id, language: 'zh' }, actor) : this.target(data, actor);
      const seen = new Set(), results = [];
      for (const item of preview.items) {
        if (seen.has(item.char)) continue;
        seen.add(item.char);
        let entry = this.db.prepare('SELECT id FROM characters WHERE child_id = ? AND char = ?').get(data.child_id, item.char);
        const added = !entry;
        if (added) entry = this.characters.createCharacter({ child_id: data.child_id, char: item.char, pinyin: item.pinyin }, actor);
        let action = added ? 'added' : 'skipped';
        if (book && !this.db.prepare('SELECT 1 FROM word_book_items WHERE book_id = ? AND character_id = ?').get(book.id, entry.id)) {
          this.books.add(book.id, { character_id: entry.id, pinyin_override: item.pinyin }, actor);
          if (!added) action = 'linked';
        }
        results.push({ id: entry.id, text: item.char, action });
      }
      return importResult(book, results);
    });
  }
}
module.exports = CharacterImportsService;
module.exports.reading = reading;
