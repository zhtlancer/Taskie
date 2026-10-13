async function childrenRoutes(fastify, options) {
  const { childrenService } = options;

  fastify.get('/', async (request, reply) => {
    const list = childrenService.listChildren();
    return reply.send(list);
  });

  fastify.get('/:id', async (request, reply) => {
    const child = childrenService.getChild(request.params.id);
    if (!child) {
      return reply.code(404).send({ error: 'Child not found' });
    }
    return reply.send(child);
  });

  fastify.post('/', async (request, reply) => {
    try {
      const child = childrenService.createChild(request.body || {});
      return reply.code(201).send(child);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    try {
      const child = childrenService.updateChild(request.params.id, request.body || {});
      return reply.send(child);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = childrenService.deleteChild(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = childrenRoutes;
