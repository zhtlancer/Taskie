async function rewardsRoutes(fastify, options) {
  const { rewardsService } = options;
  fastify.get('/children/:id/point-logs', async request => fastify.db.prepare(`
    SELECT pl.id, pl.points, pl.earned_at, dt.title FROM point_logs pl
    LEFT JOIN daily_tasks dt ON dt.id = pl.daily_task_id
    WHERE pl.child_id = ? ORDER BY pl.earned_at DESC LIMIT 200
  `).all(request.params.id));

  fastify.get('/badge-definitions', async (request, reply) => {
    const definitions = rewardsService.listBadgeDefinitions();
    return reply.send(definitions);
  });

  fastify.get('/children/:id/stats', async (request, reply) => {
    try {
      const stats = rewardsService.getChildStats(request.params.id, request.query.date);
      return reply.send(stats);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.get('/children/:id/badges', async (request, reply) => {
    try {
      const badges = rewardsService.getChildBadges(request.params.id);
      return reply.send(badges);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = rewardsRoutes;
