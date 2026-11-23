const { generationWrite } = require('../utils/data-generation');
module.exports = async function wordTestsRoutes(app, { wordTestsService: tests }) {
  const read = (fn) => async (request, reply) => {
    try {
      return fn(request);
    } catch (error) {
      return reply
        .code(error.statusCode || error.status || 500)
        .send({ error: error.message || '测试读取失败' });
    }
  };
  app.get(
    '/',
    read((request) => tests.list(request.query || {}, request.user)),
  );
  app.get(
    '/:id',
    read((request) => tests.get(request.params.id, request.user)),
  );
  app.post(
    '/',
    generationWrite(app, (request) => tests.create(request.body || {}, request.user)),
  );
  app.post(
    '/:id/items/:itemId/answer',
    generationWrite(app, (request) =>
      tests.answer(request.params.id, request.params.itemId, request.body || {}, request.user),
    ),
  );
  app.post(
    '/:id/retry-wrong',
    generationWrite(app, (request) => tests.retryWrong(request.params.id, request.body || {}, request.user)),
  );
  app.post(
    '/:id/mark-wrong',
    generationWrite(app, (request) => tests.markWrong(request.params.id, request.user)),
  );
};
