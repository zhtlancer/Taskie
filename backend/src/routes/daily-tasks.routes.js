const { getTodayDate } = require('../utils/date');

async function dailyTasksRoutes(fastify, options) {
  const { tasksService } = options;

  // Children may only view and check off today's tasks; past dates would let them
  // generate and complete back-dated tasks for extra points, streaks and badges.
  const ensureChildToday = (request, date) => {
    if (request.user.role === 'child' && date !== getTodayDate()) {
      throw { status: 403, message: '只能查看和打卡今天的任务' };
    }
  };
  const ensureChildTodayTask = (request, taskId) => {
    if (request.user.role !== 'child') return;
    const task = fastify.db.prepare('SELECT date FROM daily_tasks WHERE id = ?').get(taskId);
    if (task) ensureChildToday(request, task.date);
  };

  fastify.get('/', async (request, reply) => {
    const { child_id, date } = request.query || {};

    if (!child_id) {
      return reply.code(400).send({ error: 'child_id query parameter is required' });
    }

    try {
      ensureChildToday(request, date || getTodayDate());
      const tasks = tasksService.getDailyTasks(child_id, date);
      return reply.send(tasks);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.post('/:id/complete', async (request, reply) => {
    try {
      ensureChildTodayTask(request, request.params.id);
      const result = tasksService.completeDailyTask(request.params.id);
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.post('/:id/uncomplete', async (request, reply) => {
    try {
      ensureChildTodayTask(request, request.params.id);
      // Parents may still correct a mistaken check-off after points were spent.
      const result = tasksService.uncompleteDailyTask(request.params.id, { allowNegativeBalance: request.user.role === 'parent' });
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = dailyTasksRoutes;
