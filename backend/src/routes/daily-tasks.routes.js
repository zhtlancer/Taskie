async function dailyTasksRoutes(fastify, options) {
  const { tasksService } = options;

  fastify.get('/', async (request, reply) => {
    const { child_id, date } = request.query || {};

    if (!child_id) {
      return reply.code(400).send({ error: 'child_id query parameter is required' });
    }

    try {
      const tasks = tasksService.getDailyTasks(child_id, date);
      return reply.send(tasks);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.post('/:id/complete', async (request, reply) => {
    try {
      const result = tasksService.completeDailyTask(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.post('/:id/uncomplete', async (request, reply) => {
    try {
      const result = tasksService.uncompleteDailyTask(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = dailyTasksRoutes;
