const { generationWrite } = require('../utils/data-generation');
const { formSubmission } = require('../utils/form-submission');

async function adhocTasksRoutes(fastify, options) {
  const { tasksService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || '服务器处理失败，请稍后重试' });
    }
  };

  fastify.get('/children/:id/adhoc-tasks', handle(async request => tasksService.listAdhocTasks(request.params.id, request.query.from)));
  fastify.post('/children/:id/adhoc-tasks', generationWrite(fastify, (request, reply) => {
    reply.code(201);
    return formSubmission(fastify.db, request, 'adhoc', request.params.id,
      body => tasksService.createAdhocTask(request.params.id, body), id => {
        const row = fastify.db.prepare("SELECT id FROM daily_tasks WHERE id = ? AND origin = 'adhoc'").get(id);
        return row ? tasksService.getAdhocTask(id) : null;
      });
  }));
  fastify.get('/adhoc-tasks/:id', handle(async request => tasksService.getAdhocTask(request.params.id)));
  fastify.put('/adhoc-tasks/:id', generationWrite(fastify, request =>
    tasksService.updateAdhocTask(request.params.id, request.body)));
  fastify.delete('/adhoc-tasks/:id', handle(async request => tasksService.deleteAdhocTask(request.params.id)));
}

module.exports = adhocTasksRoutes;
