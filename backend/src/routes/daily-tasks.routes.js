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
  // A task carried over a break (or due later) stays open to the child until its deadline.
  const ensureChildTodayTask = (request, taskId) => {
    if (request.user.role !== 'child') return;
    const task = fastify.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(taskId);
    if (task?.completion_source === 'parent_backfill') throw { status: 403, message: '家长补卡记录请由家长修改' };
    if (task && !tasksService.childMayActOn(task)) throw { status: 403, message: '只能打卡今天的任务，或还没到截止日期的任务' };
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

  fastify.get('/backfill', async (request, reply) => {
    try {
      return tasksService.getBackfillTasks(request.query.child_id, request.query.date);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '操作失败' });
    }
  });
  for (const [path, method] of [['backfill', 'backfillDailyTask'], ['undo-backfill', 'undoBackfillDailyTask']]) {
    fastify.post(`/:id/${path}`, async (request, reply) => {
      try {
        return tasksService[method](request.params.id, { duration_seconds: request.body?.duration_seconds });
      } catch (err) {
        return reply.code(err.status || 500).send({ error: err.message || '操作失败' });
      }
    });
  }

  fastify.post('/:id/complete', async (request, reply) => {
    try {
      ensureChildTodayTask(request, request.params.id);
      const task = fastify.db.prepare('SELECT * FROM daily_tasks WHERE id = ?').get(request.params.id);
      const method = request.user.role === 'parent' && task && task.date < getTodayDate() && !tasksService.childMayActOn(task)
        ? 'backfillDailyTask' : 'completeDailyTask';
      const result = tasksService[method](request.params.id, { duration_seconds: request.body?.duration_seconds });
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
