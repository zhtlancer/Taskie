const { generationWrite } = require('../utils/data-generation');

async function homeworkRoutes(fastify, options) {
  const { homeworkService, homeworkStudyService: study } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };
  const actor = request => request.user.role;

  fastify.get('/children/:id/homework', handle(async request => homeworkService.list(request.params.id, request.query)));
  fastify.post('/children/:id/homework', handle(async (request, reply) =>
    reply.code(201).send(homeworkService.create(request.params.id, request.body || {}, actor(request)))));
  fastify.get('/children/:id/homework/courses', handle(async request => homeworkService.listCourses(request.params.id)));
  fastify.get('/children/:id/homework/summary', handle(async request => homeworkService.summary(request.params.id, request.query)));
  fastify.get('/children/:id/homework/suggest', handle(async request => homeworkService.suggest(request.params.id, request.query)));

  fastify.get('/homework/:id', handle(async request => homeworkService.get(request.params.id)));
  fastify.put('/homework/:id', handle(async request => homeworkService.update(request.params.id, request.body || {}, actor(request))));
  fastify.delete('/homework/:id', handle(async request =>
    homeworkService.delete(request.params.id, { delete_task: request.query.delete_task === '1' }, actor(request))));
  fastify.post('/homework/:id/task', handle(async (request, reply) => reply.code(201).send(homeworkService.createTask(request.params.id, request.body || {}))));
  fastify.post('/homework/:id/reject-task', handle(async request => homeworkService.rejectTask(request.params.id)));

  fastify.get('/homework/:id/study', handle(async r => study.details(r.params.id)));
  fastify.put('/homework/:id/study/legacy', handle(r => study.correctLegacy(r.params.id, r.body || {}, actor(r))));
  fastify.post('/homework/:id/study/start', handle(async r => study.start(r.params.id)));
  fastify.post('/homework/:id/sessions/:sid/pause', handle(async r => study.pauseSession(r.params.id, r.params.sid)));
  fastify.post('/homework/:id/sessions/:sid/finish', handle(async r => study.finish(r.params.id, r.params.sid, r.body || {}, actor(r))));
  fastify.post('/homework/:id/sessions', generationWrite(fastify, r => study.manual(r.params.id, r.body || {}, actor(r))));
  fastify.put('/homework/:id/sessions/:sid', handle(async r => study.edit(r.params.id, r.params.sid, r.body || {}, actor(r))));
  fastify.post('/homework/:id/complete', generationWrite(fastify, r => study.completeWithDuration(r.params.id, r.body || {}, actor(r))));
  fastify.post('/homework/:id/reject-completion', handle(async r => study.reject(r.params.id)));
  fastify.get('/homework-completion-requests', handle(async () => homeworkService.query('r.completion_requested_at IS NOT NULL AND d.is_completed = 0', [])));

  fastify.get('/homework-requests', handle(async () => homeworkService.listTaskRequests()));
  fastify.put('/homework-course-points', handle(async request =>
    homeworkService.setCoursePoints(request.body?.course_key, request.body?.points)));
}

module.exports = homeworkRoutes;
