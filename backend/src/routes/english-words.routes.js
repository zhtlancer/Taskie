const { generationWrite } = require('../utils/data-generation');
const EnglishImportsService = require('../services/english-imports.service');
const { checkImportActor } = require('../utils/word-import');

async function englishWordsRoutes(fastify, options) {
  const { englishWordsService, dictionaryService } = options;
  const imports = new EnglishImportsService(englishWordsService.db, englishWordsService);
  const handle = (fn, status = 200) => async (request, reply) => {
    try {
      const result = await fn(request);
      return reply.code(status).send(result);
    } catch (err) {
      return reply.code(err.status || err.statusCode || 500).send({
        error: err.message || '服务器处理失败，请稍后重试',
        ...(err.code ? { code: err.code } : {}),
        ...(err.conflicts ? { conflicts: err.conflicts } : {})
      });
    }
  };

  fastify.get('/', handle(request => englishWordsService.listWords(request.query || {})));
  fastify.get('/taxonomy', handle(request => englishWordsService.listTaxonomy(request.query?.child_id)));
  fastify.get('/:id', handle(request => {
    const entry = englishWordsService.getWord(request.params.id);
    if (!entry) throw { status: 404, message: '该单词不存在，可能已被移出，请刷新后重试' };
    return entry;
  }));

  fastify.post('/', generationWrite(fastify, (request, reply) => {
    reply.code(201);
    fastify.requireChildAccess(request, request.body?.child_id);
    return englishWordsService.createWord(request.body || {}, { role: request.user?.role });
  }));
  fastify.post('/batch-preview', handle(async request => {
    const result = await imports.preview(request.body || {}, request.user, dictionaryService);
    fastify.requireCurrentSession(request);
    fastify.requireChildAccess(request, request.body?.child_id);
    return result;
  }));
  // Up to 100 words × 30 senses, including examples, can exceed Fastify's 1 MiB default.
  fastify.post('/batch', { bodyLimit: 32 * 1024 * 1024 }, generationWrite(fastify, (request, reply) => {
    reply.code(201);
    fastify.requireChildAccess(request, request.body?.child_id);
    if (request.body?.request_id !== undefined || request.body?.book_id !== undefined || request.body?.book_meta !== undefined) return imports.commit(request.body, request.user);
    checkImportActor(englishWordsService.db, request.body || {}, request.user, { allowWordNotes: true });
    return englishWordsService.batchImport(request.body?.child_id, request.body || {}, { role: request.user?.role });
  }));

  fastify.put('/:id', generationWrite(fastify, request => (
    englishWordsService.updateWord(request.params.id, request.body || {}, { role: request.user?.role })
  )));
  fastify.put('/:id/master', handle(request => {
    const isMastered = request.body && request.body.is_mastered !== undefined ? request.body.is_mastered : null;
    return englishWordsService.markMastered(request.params.id, isMastered);
  }));
  fastify.put('/:id/categories', generationWrite(fastify, request => (
    englishWordsService.setCategories(request.params.id, request.body?.categories, { role: request.user?.role, expected_version: request.body?.expected_version })
  )));
  fastify.delete('/:id', handle(request => englishWordsService.deleteWord(request.params.id, { role: request.user?.role })));
}

module.exports = englishWordsRoutes;
