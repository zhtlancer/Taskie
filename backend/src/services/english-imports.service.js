const { checkImportActor, importSubmission, importResult, importBook } = require('../utils/word-import');
const { identityKey, validateEnglishWord } = require('../utils/english-word');
const WordBooksService = require('./word-books.service');
class EnglishImportsService {
  constructor(db, words) { this.db = db; this.words = words; this.books = new WordBooksService(db); }
  async preview(data, actor, dictionaryService) {
    checkImportActor(this.db, data, actor, { allowWordNotes: true });
    importBook(this.db, data, actor, 'en');
    if (typeof data.text !== 'string' || data.text.length > 50000) throw { status: 400, message: '请输入不超过 50000 字符的单词列表' };
    const result = await this.words.batchPreview(data.child_id, data.text, { dictionaryService, useDictionary: data.use_dictionary });
    const book = importBook(this.db, data, actor, 'en');
    for (const item of result.items) {
      if (item.status !== 'duplicate') continue;
      item.status = book || data.book_meta ? 'link' : 'duplicate';
      if (book && this.db.prepare('SELECT 1 FROM word_book_items WHERE book_id = ? AND english_word_id = ?').get(book.id, item.existing_id)) item.status = 'in_book';
    }
    return result;
  }
  commit(data, actor) {
    return importSubmission(this.db, data, actor, 'en', () => {
      importBook(this.db, data, actor, 'en');
      if (!Array.isArray(data.items) || !data.items.length || data.items.length > 100) throw { status: 400, message: '每批请输入 1 到 100 个单词' };
      const prepared = data.items.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw { status: 400, message: '单词格式无效' };
        const word = validateEnglishWord(item.word);
        const existing = this.db.prepare('SELECT id FROM english_words WHERE child_id = ? AND identity_key = ?').get(data.child_id, identityKey(word));
        if ((item.existing_only && !existing) || (item.existing_id !== undefined && item.existing_id !== existing?.id)) {
          throw { status: 409, code: 'WORD_IMPORT_CONFLICT', message: '预览中的单词已被删除或更名，请重新解析后核对' };
        }
        return { ...item, word, existing: Boolean(existing) };
      });
      // The original batch path retains all senses, audio, case-variant confirmation and
      // legacy metadata rules. Existing entries bypass its content parser for link-only rows.
      const fresh = prepared.filter(item => !item.existing);
      const imported = fresh.length ? this.words.batchImport(data.child_id, { ...data, items: fresh }, actor) : { added: [] };
      const book = data.book_meta ? this.books.create({ ...data.book_meta, child_id: data.child_id, language: 'en' }, actor) : importBook(this.db, data, actor, 'en');
      const addedIds = new Set(imported.added.map(row => row.id)), seen = new Set(), items = [];
      for (const item of prepared) {
        const key = identityKey(item.word);
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = this.db.prepare('SELECT id, word FROM english_words WHERE child_id = ? AND identity_key = ?').get(data.child_id, key);
        let action = addedIds.has(entry.id) ? 'added' : 'skipped';
        if (book && !this.db.prepare('SELECT 1 FROM word_book_items WHERE book_id = ? AND english_word_id = ?').get(book.id, entry.id)) {
          this.books.add(book.id, { english_word_id: entry.id }, actor);
          if (action !== 'added') action = 'linked';
        }
        items.push({ id: entry.id, text: entry.word, action });
      }
      return importResult(book, items);
    });
  }
}
module.exports = EnglishImportsService;
