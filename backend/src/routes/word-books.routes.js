const { generationWrite } = require('../utils/data-generation');
const { formSubmission } = require('../utils/form-submission');
function requiredId(request) {
  if (typeof request.body?.request_id !== 'string') throw { status: 400, message: '缺少提交标识，请重新操作' };
}
async function wordBooksRoutes(app, { wordBooksService: books }) {
  const read = fn => async (request, reply) => {
    try { return fn(request); } catch (error) { return reply.code(error.status || error.statusCode || 500).send({ error: error.message || '读取词本失败' }); }
  };
  app.get('/', read(r => books.list(r.query || {}, r.user)));
  app.get('/:id', read(r => books.get(r.params.id, r.user)));
  app.get('/:id/items', read(r => books.items(r.params.id, r.query || {}, r.user)));
  app.post('/', generationWrite(app, r => {
    requiredId(r);
    books.child(r.body.child_id, r.body.language, r.user, true);
    return formSubmission(app.db, r, 'word-book-create', r.body.child_id, data => books.create(data, r.user), id => {
      try { return books.get(id, r.user); } catch (error) { if (error.status === 404) return null; throw error; }
    });
  }));
  app.put('/:id', generationWrite(app, r => books.update(r.params.id, r.body || {}, r.user)));
  app.delete('/:id', generationWrite(app, r => books.remove(r.params.id, r.body || {}, r.user)));
  app.post('/:id/items', generationWrite(app, r => {
    requiredId(r);
    const book = books.get(r.params.id, r.user, true);
    return formSubmission(app.db, r, `word-book-item:${book.id}`, book.child_id, data => books.add(book.id, data, r.user), id => {
      try { return books.item(book.id, id, r.user); } catch (error) { if (error.status === 404) return null; throw error; }
    });
  }));
  app.put('/:id/items/:itemId', generationWrite(app, r => books.updateItem(r.params.id, r.params.itemId, r.body || {}, r.user)));
  app.delete('/:id/items/:itemId', generationWrite(app, r => books.removeItem(r.params.id, r.params.itemId, r.body || {}, r.user)));
}
module.exports = wordBooksRoutes;
