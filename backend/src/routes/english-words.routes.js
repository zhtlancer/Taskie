async function englishWordsRoutes(fastify, options) {
  const { englishWordsService, dictionaryService } = options;
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

  fastify.post('/', handle(request => englishWordsService.createWord(request.body || {}, { role: request.user?.role }), 201));
  fastify.post('/batch-preview', handle(request => (
    englishWordsService.batchPreview(request.body?.child_id, request.body?.text, { dictionaryService, useDictionary: request.body?.use_dictionary })
  )));
  // Up to 100 words × 30 senses, including examples, can exceed Fastify's 1 MiB default.
  fastify.post('/batch', { bodyLimit: 16 * 1024 * 1024 }, handle(request => (
    englishWordsService.batchImport(request.body?.child_id, request.body || {}, { role: request.user?.role })
  ), 201));

  fastify.put('/:id', handle(request => englishWordsService.updateWord(request.params.id, request.body || {}, { role: request.user?.role })));
  fastify.put('/:id/master', handle(request => {
    const isMastered = request.body && request.body.is_mastered !== undefined ? request.body.is_mastered : null;
    return englishWordsService.markMastered(request.params.id, isMastered);
  }));
  fastify.put('/:id/categories', handle(request => (
    englishWordsService.setCategories(request.params.id, request.body?.categories, { role: request.user?.role })
  )));
  fastify.delete('/:id', handle(request => englishWordsService.deleteWord(request.params.id, { role: request.user?.role })));
}

module.exports = englishWordsRoutes;
