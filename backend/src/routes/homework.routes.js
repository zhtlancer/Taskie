async function homeworkRoutes(fastify, options) {
  const { homeworkService } = options;
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
  fastify.get('/children/:id/homework/suggest', handle(async request => homeworkService.suggest(request.params.id, request.query)));

  fastify.put('/homework/:id', handle(async request => homeworkService.update(request.params.id, request.body || {}, actor(request))));
  fastify.delete('/homework/:id', handle(async request =>
    homeworkService.delete(request.params.id, { delete_task: request.query.delete_task === '1' }, actor(request))));
  fastify.post('/homework/:id/task', handle(async (request, reply) => reply.code(201).send(homeworkService.createTask(request.params.id, request.body || {}))));
  fastify.post('/homework/:id/reject-task', handle(async request => homeworkService.rejectTask(request.params.id)));

  fastify.get('/homework-requests', handle(async () => homeworkService.listTaskRequests()));
  fastify.put('/homework-course-points', handle(async request =>
    homeworkService.setCoursePoints(request.body?.course_key, request.body?.points)));
}

module.exports = homeworkRoutes;
