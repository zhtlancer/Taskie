const { createHash } = require('node:crypto');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
const managementFields = ['book_id', 'book_meta', 'source', 'unit', 'textbook', 'source_type', 'note', 'pinyin_override'];
function checkImportActor(db, data, actor) {
  if (!actor || !['parent', 'child'].includes(actor.role) || (actor.role === 'child' && actor.child_id !== data.child_id)) throw { status: 403, message: '无权导入其他孩子的字词' };
  if (!data.child_id || !db.prepare('SELECT 1 FROM children WHERE id = ?').get(data.child_id)) throw { status: 404, message: '孩子不存在' };
  if (actor.role === 'child' && [data, ...(Array.isArray(data.items) ? data.items : [])].some(item => item && managementFields.some(key => Object.hasOwn(item, key)))) {
    throw { status: 403, message: '词本、来源和单元由家长设置，孩子只能导入散词' };
  }
}
function importSubmission(db, data, actor, language, create) {
  checkImportActor(db, data, actor);
  const { request_id: id, ...body } = data;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw { status: 400, message: '缺少有效的导入请求标识' };
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(body))).digest('hex');
  return db.transaction(() => {
    const prior = db.prepare('SELECT * FROM word_import_receipts WHERE id = ?').get(id);
    if (prior) {
      if (prior.child_id !== data.child_id || prior.actor !== actor.role || prior.language !== language || prior.fingerprint !== fingerprint) {
        throw { status: 409, code: 'WORD_IMPORT_CONFLICT', message: '原导入内容已改变，请先核对原结果' };
      }
      if (prior.book_id && !db.prepare('SELECT 1 FROM word_books WHERE id = ? AND child_id = ? AND language = ?').get(prior.book_id, data.child_id, language)) {
        throw { status: 409, code: 'WORD_IMPORT_GONE', message: '原导入已保存，但目标词本已删除，请重新选择词本' };
      }
      return JSON.parse(prior.result_json);
    }
    const result = create();
    db.prepare(`INSERT INTO word_import_receipts (id, child_id, actor, language, fingerprint, book_id, book_name, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, data.child_id, actor.role, language, fingerprint, result.book?.id || null, result.book?.name || null, JSON.stringify(result), new Date().toISOString());
    return result;
  })();
}
const importResult = (book, items) => ({ book: book ? { id: book.id, name: book.name } : null, items,
  added_count: items.filter(item => item.action === 'added').length,
  linked_count: items.filter(item => item.action === 'linked').length,
  skipped_count: items.filter(item => item.action === 'skipped').length });
module.exports = { checkImportActor, importSubmission, importResult };
