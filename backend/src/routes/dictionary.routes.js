async function dictionaryRoutes(fastify, options) {
  const { dictionaryService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || err.statusCode || 500).send({ error: err.message || '词典服务处理失败，请稍后重试' });
    }
  };

  fastify.get('/status', handle(async () => dictionaryService.status()));
  fastify.get('/lookup', handle(async request => dictionaryService.lookup(request.query?.word || '')));
  fastify.get('/suggest', handle(async request => dictionaryService.suggest(request.query?.prefix || '', request.query?.limit)));
  fastify.get('/article', handle(async request => dictionaryService.getArticles(request.query?.word || '', request.query?.dict_id || 'all')));
  fastify.post('/rebuild-index', handle(async () => dictionaryService.rebuildIndex()));

  fastify.get('/audio/:dictId/:filename', handle(async (request, reply) => {
    const { dictId, filename } = request.params;
    const audio = await dictionaryService.getAudio(dictId, filename);
    return reply
      .type(audio.contentType)
      .header('Cache-Control', 'private, max-age=86400')
      .send(audio.buffer);
  }));
}

module.exports = dictionaryRoutes;
