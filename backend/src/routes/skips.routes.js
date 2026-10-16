const { getTodayDate } = require('../utils/date');

async function skipsRoutes(fastify, options) {
  const { skipsService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };

  // Children may only ask to skip today's tasks; parents may also skip earlier days.
  fastify.post('/daily-tasks/:id/skip', handle(async (request, reply) => {
    if (request.user.role === 'child') {
      const task = fastify.db.prepare('SELECT date FROM daily_tasks WHERE id = ?').get(request.params.id);
      if (task && task.date !== getTodayDate()) throw { status: 403, message: '只能申请跳过今天的任务' };
    }
    return reply.code(201).send(skipsService.requestSkip(request.params.id, request.body?.reason, { role: request.user.role }));
  }));
  fastify.post('/daily-tasks/:id/unskip', handle(async request => skipsService.unskip(request.params.id)));

  fastify.get('/skip-requests', handle(async request =>
    skipsService.listRequests({ status: request.query.status, limit: request.query.limit, offset: request.query.offset })));
  fastify.post('/skip-requests/:id/approve', handle(async request => skipsService.resolveRequest(request.params.id, 'approved')));
  fastify.post('/skip-requests/:id/reject', handle(async request => skipsService.resolveRequest(request.params.id, 'rejected')));
  fastify.post('/skip-requests/:id/cancel', handle(async request => skipsService.resolveRequest(request.params.id, 'cancelled')));
}

module.exports = skipsRoutes;
