const { generationWrite } = require('../utils/data-generation');

async function taskStudyRoutes(fastify, { taskStudyService: study }) {
  const handle = fn => async (request, reply) => {
    try { return fn(request); }
    catch (err) { return reply.code(err.status || 500).send({ error: err.message || '操作失败' }); }
  };
  fastify.get('/children/:id/unfinished-study', handle(r => study.unfinished(r.params.id)));
  fastify.get('/daily-tasks/:id/study', handle(r => study.details(r.params.id)));
  fastify.put('/daily-tasks/:id/study/legacy', handle(r => study.correctLegacy(r.params.id, r.body || {}, r.user.role)));
  fastify.post('/daily-tasks/:id/study/start', handle(r => study.start(r.params.id)));
  fastify.post('/daily-tasks/:id/sessions/:sid/pause', handle(r => study.pauseSession(r.params.id, r.params.sid)));
  fastify.post('/daily-tasks/:id/sessions/:sid/finish', handle(r => study.finish(r.params.id, r.params.sid, r.body || {}, r.user.role)));
  fastify.post('/daily-tasks/:id/sessions', generationWrite(fastify, r => study.manual(r.params.id, r.body || {}, r.user.role)));
  fastify.put('/daily-tasks/:id/sessions/:sid', handle(r => study.edit(r.params.id, r.params.sid, r.body || {}, r.user.role)));
  fastify.post('/daily-tasks/:id/study/complete', generationWrite(fastify, r => study.completeWithDuration(r.params.id, r.body || {}, r.user.role)));
}
module.exports = taskStudyRoutes;
