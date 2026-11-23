const { generationWrite } = require('../utils/data-generation');

async function wordStudyRoutes(app, { wordStudyService: study }) {
  const handle = fn => async (request, reply) => {
    try { return fn(request); }
    catch (error) { return reply.code(error.status || error.statusCode || 500).send({ error: error.message || '学习操作失败' }); }
  };
  app.get('/children/:id/word-study', generationWrite(app, request => {
    app.requireChildAccess(request, request.params.id);
    return study.today(request.params.id, request.query?.language);
  }));
  app.get('/children/:id/word-study/history', handle(request => study.history(request.params.id, request.query?.language)));
  const savePlan = generationWrite(app, request => {
    if (request.user.role !== 'parent') throw { status: 403, message: '需要家长权限' };
    app.requireChildAccess(request, request.params.id);
    return study.savePlan(request.params.id, request.params.skill, request.body || {}, request.params.language ?? request.query?.language);
  });
  app.put('/children/:id/word-study/plans/:skill', savePlan);
  app.put('/children/:id/word-study/:language/plans/:skill', savePlan);
  app.post('/children/:id/word-study/:language/book-scope', handle(request => {
    app.requireChildAccess(request, request.params.id);
    return study.previewScope(request.params.id, request.params.language, request.body?.book_ids);
  }));
  app.post('/word-study/days/:id/extra', generationWrite(app, request => {
    app.requireChildAccess(request, study.getDay(request.params.id).child_id);
    return study.extra(request.params.id, request.body?.request_id);
  }));
  app.post('/word-study/items/:id/attempts', generationWrite(app, request => {
    const owner = app.db.prepare(`SELECT d.child_id FROM word_study_items i JOIN word_study_batches b ON b.id = i.batch_id
      JOIN word_study_days d ON d.id = b.day_id WHERE i.id = ?`).get(request.params.id);
    if (!owner) throw { status: 404, message: '学习内容不存在' };
    app.requireChildAccess(request, owner.child_id);
    return study.grade(request.params.id, request.body || {}, request.user.role);
  }));
}
module.exports = wordStudyRoutes;
