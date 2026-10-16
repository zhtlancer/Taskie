async function periodsRoutes(fastify, options) {
  const { periodsService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };
  const actor = request => ({ role: request.user.role });

  fastify.get('/children/:id/periods', handle(async request => periodsService.listPeriods(request.params.id)));
  fastify.post('/children/:id/periods', handle(async (request, reply) =>
    reply.code(201).send(periodsService.createPeriod(request.params.id, request.body || {}))));
  fastify.put('/periods/:id', handle(async request => periodsService.updatePeriod(request.params.id, request.body || {})));
  fastify.delete('/periods/:id', handle(async request => periodsService.deletePeriod(request.params.id)));

  fastify.get('/children/:id/goals', handle(async request => periodsService.listGoals(request.params.id)));
  fastify.post('/children/:id/goals', handle(async (request, reply) =>
    reply.code(201).send(periodsService.createGoal(request.params.id, request.body || {}))));

  fastify.post('/periods/:id/tasks', handle(async (request, reply) =>
    reply.code(201).send(periodsService.createTask(request.params.id, request.body || {}))));
  fastify.put('/period-tasks/:id', handle(async request => periodsService.updateTask(request.params.id, request.body || {})));
  fastify.delete('/period-tasks/:id', handle(async request => periodsService.deleteTask(request.params.id)));

  fastify.post('/period-tasks/:id/logs', handle(async (request, reply) =>
    reply.code(201).send(periodsService.logProgress(request.params.id, request.body || {}, actor(request)))));
  fastify.delete('/period-task-logs/:id', handle(async request => periodsService.deleteLog(request.params.id, actor(request))));

  fastify.get('/children/:id/makeup-days', handle(async request => periodsService.listMakeupDays(request.params.id)));
  fastify.post('/children/:id/makeup-days', handle(async (request, reply) =>
    reply.code(201).send(periodsService.createMakeupDay(request.params.id, request.body || {}))));
  fastify.delete('/makeup-days/:id', handle(async request => periodsService.deleteMakeupDay(request.params.id)));
}

module.exports = periodsRoutes;
