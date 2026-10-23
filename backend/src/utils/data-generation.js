// Reading the generation must never create a setting: old databases start at initial.
function dataGeneration(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get()?.value ?? 'initial';
}

// operation must be synchronous. Queue with restore/backup/photo import, then check and write
// in one SQLite transaction without yielding to another request. A preHandler alone would leave
// a gap between checking the generation and executing a request that waited behind a restore.
function generationWrite(app, operation) {
  return async (request, reply) => {
    try {
      return await app.backupService.exclusive(() => app.db.transaction(() => {
        // onRequest authenticated before queueing; a restore/PIN change may have revoked it since.
        app.requireCurrentSession(request);
        const generation = request.headers['x-taskie-data-generation'];
        if (generation !== undefined && generation !== dataGeneration(app.db)) {
          throw Object.assign(new Error('数据已恢复，这次操作没有执行，请核对后重新操作'), {
            statusCode: 409, code: 'DATA_RESTORED'
          });
        }
        return operation(request, reply);
      })());
    } catch (error) {
      return reply.code(error.statusCode || error.status || 500).send({
        error: error.message || '操作失败', ...(error.code === 'DATA_RESTORED' ? { code: error.code } : {})
      });
    }
  };
}

module.exports = { dataGeneration, generationWrite };
