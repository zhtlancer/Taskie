const { getTodayDate, shiftDate } = require('../utils/date');
const { defaultRange } = require('../services/time-stats.service');

async function statsRoutes(fastify, options) {
  const { statsService, timeStatsService } = options;

  // How long homework takes and when it is finished; the last 7 days unless given.
  fastify.get('/children/:id/time-stats', async (request, reply) => {
    try {
      const range = defaultRange(request.query.to || undefined);
      return reply.send(timeStatsService.stats(request.params.id, request.query.from || range.from, request.query.to || range.to));
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });

  fastify.get('/children/:id/history', async (request, reply) => {
    const { from, to, days } = request.query || {};
    try {
      // `days` counts back from `to` (default today, in the family time zone) when `from` is omitted.
      if (days !== undefined && !(/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 366)) {
        return reply.code(400).send({ error: 'days 必须为 1 至 366 的整数' });
      }
      const end = to || getTodayDate();
      const start = from || (days !== undefined ? shiftDate(end, 1 - Number(days)) : undefined);
      const history = statsService.getHistory(request.params.id, start, end);
      return reply.send(history);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });

  fastify.get('/children/:id/weekly-summary', async (request, reply) => {
    const { date } = request.query || {};
    try {
      const summary = statsService.getWeeklySummary(request.params.id, date);
      return reply.send(summary);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  });
}

module.exports = statsRoutes;
