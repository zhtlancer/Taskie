async function redemptionsRoutes(fastify, options) {
  const { redemptionsService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };

  // Children only see rewards that are on offer; parents also see unlisted ones.
  fastify.get('/reward-items', handle(async request =>
    redemptionsService.listItems({ includeInactive: request.user.role === 'parent' })));
  fastify.post('/reward-items', handle(async (request, reply) =>
    reply.code(201).send(redemptionsService.createItem(request.body || {}))));
  fastify.put('/reward-items/:id', handle(async request =>
    redemptionsService.updateItem(request.params.id, request.body || {})));
  fastify.delete('/reward-items/:id', handle(async request =>
    redemptionsService.deleteItem(request.params.id)));

  fastify.get('/children/:id/redemptions', handle(async request =>
    redemptionsService.listRedemptions({ childId: request.params.id, status: request.query.status, limit: request.query.limit, offset: request.query.offset })));
  fastify.post('/children/:id/redemptions', handle(async (request, reply) =>
    reply.code(201).send(redemptionsService.requestRedemption(request.params.id, request.body?.reward_id))));

  fastify.get('/redemptions', handle(async request =>
    redemptionsService.listRedemptions({ status: request.query.status, limit: request.query.limit, offset: request.query.offset })));
  fastify.post('/redemptions/:id/approve', handle(async request =>
    redemptionsService.resolveRedemption(request.params.id, 'approved')));
  fastify.post('/redemptions/:id/reject', handle(async request =>
    redemptionsService.resolveRedemption(request.params.id, 'rejected')));
  fastify.post('/redemptions/:id/cancel', handle(async request =>
    redemptionsService.resolveRedemption(request.params.id, 'cancelled')));
}

module.exports = redemptionsRoutes;
