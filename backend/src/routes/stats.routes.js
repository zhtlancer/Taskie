async function statsRoutes(fastify, options) {
  const { statsService } = options;

  fastify.get('/children/:id/history', async (request, reply) => {
    const { from, to } = request.query || {};
    try {
      const history = statsService.getHistory(request.params.id, from, to);
      return reply.send(history);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.get('/children/:id/weekly-summary', async (request, reply) => {
    const { date } = request.query || {};
    try {
      const summary = statsService.getWeeklySummary(request.params.id, date);
      return reply.send(summary);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = statsRoutes;
