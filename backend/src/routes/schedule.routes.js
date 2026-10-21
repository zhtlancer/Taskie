async function scheduleRoutes(fastify, options) {
  const { scheduleService, classStatsService } = options;
  const handle = fn => async (request, reply) => {
    try {
      return await fn(request, reply);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  };

  // A child's days: school lessons, outside classes and what to bring.
  fastify.get('/children/:id/schedule', handle(async request =>
    scheduleService.schedule(request.params.id, request.query.from, request.query.to ?? request.query.from)));

  fastify.get('/children/:id/timetables', handle(async request => scheduleService.listTimetables(request.params.id)));
  fastify.post('/children/:id/timetables', handle(async (request, reply) =>
    reply.code(201).send(scheduleService.createTimetable(request.params.id, request.body || {}))));
  fastify.put('/timetables/:id', handle(async request => scheduleService.updateTimetable(request.params.id, request.body || {})));
  fastify.delete('/timetables/:id', handle(async request => scheduleService.deleteTimetable(request.params.id)));

  fastify.get('/outside-classes', handle(async () => scheduleService.listClasses()));
  fastify.get('/outside-classes/stats', handle(async request => classStatsService.list(request.query.child_id)));
  fastify.get('/outside-classes/:id/stats', handle(async request => classStatsService.details(request.params.id, request.query.child_id, request.query.from, request.query.to)));
  fastify.put('/outside-classes/:id/attendance', handle(async request => classStatsService.setAttendance(request.params.id, request.body?.child_id, request.body?.lesson_date, request.body || {})));
  fastify.put('/outside-classes/:id/fee', handle(async request => classStatsService.setFee(request.params.id, request.body?.child_id, request.body || {})));
  fastify.post('/outside-classes', handle(async (request, reply) => reply.code(201).send(scheduleService.createClass(request.body || {}))));
  fastify.put('/outside-classes/:id', handle(async request => scheduleService.updateClass(request.params.id, request.body || {})));
  fastify.delete('/outside-classes/:id', handle(async request => scheduleService.deleteClass(request.params.id)));
  fastify.put('/outside-classes/:id/exceptions', handle(async request => scheduleService.setException(request.params.id, request.body || {})));
  fastify.delete('/outside-class-exceptions/:id', handle(async request => scheduleService.deleteException(request.params.id)));
}

module.exports = scheduleRoutes;
