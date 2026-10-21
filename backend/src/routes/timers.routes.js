async function timersRoutes(fastify, options) {
  const { timersService, tasksService, periodsService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };

  fastify.get('/children/:id/running-timer', handle(async request => ({ timer: timersService.running(request.params.id) })));
  fastify.post('/children/:id/running-timer/pause', handle(async request => {
    timersService.pauseChildTimer(request.params.id);
    return { timer: timersService.running(request.params.id) };
  }));
  fastify.post('/daily-tasks/:id/timer/:action', handle(async request =>
    timersService.apply('task', request.params.id, request.params.action)));
  fastify.post('/period-tasks/:id/timer/:action', handle(async request =>
    timersService.apply('goal', request.params.id, request.params.action)));

  // Children may only correct durations of tasks still open to them.
  fastify.put('/daily-tasks/:id/duration', handle(async request => {
    if (request.user.role === 'child') {
      const task = fastify.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(request.params.id);
      if (task?.completion_source === 'parent_backfill') throw { status: 403, message: '家长补卡记录请由家长修改' };
      if (task && !tasksService.childMayActOn(task)) throw { status: 403, message: '只能修改今天的用时' };
    }
    return tasksService.setDuration(request.params.id, request.body?.duration_seconds);
  }));
  fastify.put('/period-task-logs/:id/duration', handle(async request =>
    periodsService.setLogDuration(request.params.id, request.body?.duration_seconds, { role: request.user.role })));
}

module.exports = timersRoutes;
