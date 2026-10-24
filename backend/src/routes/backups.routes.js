const fs = require('node:fs');
const { getTodayDate } = require('../utils/date');
const { MAX_UPLOAD_SIZE, MAX_PHOTO_PACKAGE_SIZE } = require('../services/backup.service');

async function backupRoutes(app, { backupService, authService, intervalHours }) {
  app.get('/', async () => {
    const missing = await backupService.missingPhotos();
    return { backups: backupService.list(), interval_hours: intervalHours, retention: backupService.retention, last_error: backupService.lastError,
      last_warning: backupService.lastWarning, photo_export: await backupService.photoExportStatus(),
      missing_photos: { count: missing.length, absent: missing.filter(p => p.reason === 'absent').length, mismatch: missing.filter(p => p.reason === 'mismatch').length, sample: missing.slice(0, 5) } };
  });
  // A photo package can be large, so the browser downloads it directly rather than through script.
  // A five-minute ticket stands in for the session header that a plain link cannot send.
  app.post('/photos/export-ticket', async (request, reply) => {
    const scope = request.body?.scope ?? 'all';
    if (Object.hasOwn(request.body || {}, 'since') || !['all', 'new'].includes(scope)) return reply.code(400).send({ error: '请使用 scope: all 或 new' });
    const epoch = app.sessionEpoch();
    const entries = await backupService.exportEntries(scope);
    if (epoch !== app.sessionEpoch()) return reply.code(401).send({ error: '会话已失效，请重新登录' });
    const ticket = app.jwt.sign({ purpose: 'photo-export', scope, epoch }, { expiresIn: '5m' });
    return { url: `/api/backups/photos/export?ticket=${encodeURIComponent(ticket)}`, included_count: entries.length, skipped: entries.skipped };
  });
  app.get('/photos/export', async (request, reply) => {
    let ticket;
    try { ticket = app.jwt.verify(String(request.query.ticket || '')); } catch { ticket = null; }
    if (ticket?.purpose !== 'photo-export' || ticket.epoch !== app.sessionEpoch() || !['all', 'new'].includes(ticket.scope)) return reply.code(401).send({ error: '下载链接已失效，请回到设置页重新下载' });
    const stream = backupService.exportPhotos(ticket.scope);
    let complete = false, failed = false;
    stream.once('end', () => { complete = true; });
    stream.once('error', () => { failed = true; });
    reply.raw.once('error', () => { failed = true; });
    reply.raw.once('finish', () => {
      if (!complete || failed || reply.raw.statusCode !== 200) return;
      try {
        // The ticket is authorized when the download starts. It may expire while a large
        // response is in flight; only a session/restore change should invalidate its record.
        if (ticket.epoch === app.sessionEpoch()) backupService.recordPhotoExport(stream.photoNames);
      } catch (error) { request.log.warn({ err: error }, '照片包未记录为完整导出'); }
    });
    const stamp = getTodayDate();
    return reply.header('Content-Disposition', `attachment; filename="taskie-photos-${stamp}${ticket.scope === 'new' ? '-new' : ''}.tar"`)
      .type('application/x-tar').send(stream);
  });
  app.post('/photos/import', async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send({ error: '请选择照片包（.tar）' });
    const file = await request.file({ limits: { files: 1, fileSize: MAX_PHOTO_PACKAGE_SIZE } });
    if (!file) return reply.code(400).send({ error: '请选择照片包（.tar）' });
    return backupService.importPhotos(file.file);
  });
  app.post('/', async () => backupService.create());
  app.get('/:name/download', async (request, reply) => {
    const file = backupService.getPath(request.params.name);
    return reply.header('Content-Disposition', `attachment; filename="${request.params.name}"`).type('application/gzip').send(fs.createReadStream(file));
  });
  app.post('/restore', async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send({ error: '请选择备份文件' });
    let file, pin;
    for await (const part of request.parts({ limits: { files: 1, fields: 1, fileSize: MAX_UPLOAD_SIZE } })) {
      if (part.type === 'file') file = await part.toBuffer();
      else if (part.fieldname === 'pin') pin = part.value;
    }
    if (!authService.loginParent(pin).success) return reply.code(403).send({ error: '家长 PIN 不正确' });
    if (!file) return reply.code(400).send({ error: '请选择备份文件' });
    return backupService.restore(file);
  });
}

module.exports = backupRoutes;
