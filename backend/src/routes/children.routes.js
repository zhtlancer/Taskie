const { queuedDeletion } = require('../utils/queued-deletion');

async function childrenRoutes(fastify, options) {
  const { childrenService } = options;

  fastify.get('/', async (request, reply) => {
    const list = childrenService.listChildren();
    return reply.send(list);
  });

  fastify.get('/:id', async (request, reply) => {
    const child = childrenService.getChild(request.params.id);
    if (!child) {
      return reply.code(404).send({ error: '孩子不存在' });
    }
    return reply.send(child);
  });

  fastify.post('/', async (request, reply) => {
    try {
      const child = childrenService.createChild(request.body || {});
      return reply.code(201).send(child);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    try {
      const child = childrenService.updateChild(request.params.id, request.body || {});
      return reply.send(child);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = await queuedDeletion(fastify.backupService, request, reply, () => {
        fastify.requireCurrentSession(request);
        return childrenService.deleteChild(request.params.id);
      });
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || err.statusCode || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });
}

module.exports = childrenRoutes;
