async function templatesRoutes(fastify, options) {
  const { tasksService } = options;

  fastify.get('/', async (request, reply) => {
    const list = tasksService.listTemplates();
    return reply.send(list);
  });

  fastify.get('/:id', async (request, reply) => {
    const tmpl = tasksService.getTemplate(request.params.id);
    if (!tmpl) {
      return reply.code(404).send({ error: '任务模板不存在' });
    }
    return reply.send(tmpl);
  });

  fastify.post('/', async (request, reply) => {
    try {
      const tmpl = tasksService.createTemplate(request.body || {});
      return reply.code(201).send(tmpl);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });

  fastify.put('/:id', async (request, reply) => {
    try {
      const tmpl = tasksService.updateTemplate(request.params.id, request.body || {});
      return reply.send(tmpl);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = tasksService.deleteTemplate(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });
}

module.exports = templatesRoutes;
