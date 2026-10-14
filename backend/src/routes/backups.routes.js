const fs = require('node:fs');

async function backupRoutes(app, { backupService, authService, intervalHours }) {
  app.get('/', async () => ({ backups: backupService.list(), interval_hours: intervalHours, retention: backupService.retention, last_error: backupService.lastError }));
  app.post('/', async () => backupService.create());
  app.get('/:name/download', async (request, reply) => {
    const file = backupService.getPath(request.params.name);
    return reply.header('Content-Disposition', `attachment; filename="${request.params.name}"`).type('application/gzip').send(fs.createReadStream(file));
  });
  app.post('/restore', async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send({ error: '请选择备份文件' });
    let file, pin;
    for await (const part of request.parts({ limits: { files: 1, fields: 1, fileSize: 64 * 1024 * 1024 } })) {
      if (part.type === 'file') file = await part.toBuffer();
      else if (part.fieldname === 'pin') pin = part.value;
    }
    if (!authService.loginParent(pin).success) return reply.code(403).send({ error: '家长 PIN 不正确' });
    if (!file) return reply.code(400).send({ error: '请选择备份文件' });
    return backupService.restore(file);
  });
}

module.exports = backupRoutes;
