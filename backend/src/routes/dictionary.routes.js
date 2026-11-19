const { dictionaryFailure } = require('../services/dictionary/issues');

async function dictionaryRoutes(fastify, options) {
  const { dictionaryService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      const issue = dictionaryFailure(err);
      return reply.code(issue.status).send({ error: issue.message, code: issue.code });
    }
  };

  fastify.get('/status', handle(async () => dictionaryService.status()));
  fastify.get('/lookup', handle(async request => dictionaryService.lookup(request.query?.word || '')));
  fastify.get('/suggest', handle(async request => dictionaryService.suggest(request.query?.prefix || '', request.query?.limit)));
  fastify.get('/article', handle(async request => dictionaryService.getArticles(request.query?.word || '', request.query?.dict_id || 'all')));
  fastify.post('/rebuild-index', handle(async () => dictionaryService.rebuildIndex()));

  fastify.get('/image/:dictId/:filename', handle(async (request, reply) => {
    const { dictId, filename } = request.params;
    const image = await dictionaryService.getImage(dictId, filename, request.query?.v);
    return reply.type(image.contentType)
      .header('Cache-Control', 'private, max-age=86400')
      .header('X-Content-Type-Options', 'nosniff')
      .send(image.buffer);
  }));

  fastify.get('/audio/:dictId/:filename', handle(async (request, reply) => {
    const { dictId, filename } = request.params;
    const audio = await dictionaryService.getAudio(dictId, filename, { sha256: request.query?.sha256, version: request.query?.v });
    return reply
      .type(audio.contentType)
      .header('Cache-Control', 'private, max-age=86400')
      .send(audio.buffer);
  }));
}

module.exports = dictionaryRoutes;
