async function adhocTasksRoutes(fastify, options) {
  const { tasksService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };

  fastify.get('/children/:id/adhoc-tasks', handle(async request => tasksService.listAdhocTasks(request.params.id, request.query.from)));
  fastify.post('/children/:id/adhoc-tasks', handle(async (request, reply) =>
    reply.code(201).send(tasksService.createAdhocTask(request.params.id, request.body || {}))));
  fastify.delete('/adhoc-tasks/:id', handle(async request => tasksService.deleteAdhocTask(request.params.id)));
}

module.exports = adhocTasksRoutes;
