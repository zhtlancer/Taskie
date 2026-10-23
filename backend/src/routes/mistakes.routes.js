const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/crypto');
const { isImageExtensionSupported, processOrFallbackPhoto } = require('../utils/image');
const config = require('../config');
const { queuedDeletion } = require('../utils/queued-deletion');

async function mistakesRoutes(fastify, options) {
  const { mistakesService } = options;
  const uploadDir = options.uploadDir || config.uploadDir;
  const imageOptions = {
    ...config.imageProcessing,
    ...(options.imageProcessing || {})
  };

  fastify.get('/', async (request, reply) => {
    const { child_id, subject } = request.query || {};
    const list = mistakesService.listMistakes({ child_id, subject });
    return reply.send(list);
  });

  fastify.get('/:id', async (request, reply) => {
    const mistake = mistakesService.getMistake(request.params.id);
    if (!mistake) {
      return reply.code(404).send({ error: 'Mistake record not found' });
    }
    return reply.send(mistake);
  });

  fastify.post('/', async (request, reply) => {
    let child_id;
    let subject;
    let description;
    let photo_path = null;
    const writtenFiles = [];
    let committed = false;

    try {
      if (request.isMultipart()) {
        // Ensure upload directory exists
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }

        const parts = request.parts({ limits: { files: 1 } });
        for await (const part of parts) {
          if (part.type === 'file') {
            const originalName = part.filename || 'photo.jpg';
            let ext = path.extname(originalName).toLowerCase();
            if (!ext || ext === '') {
              ext = part.mimetype === 'image/png' ? '.png' : (part.mimetype === 'image/webp' ? '.webp' : '.jpg');
            }

            if (!isImageExtensionSupported(ext)) {
              // Drain remaining file to avoid hanging
              part.file.resume();
              return reply.code(400).send({ error: 'Only JPG, PNG and WebP images are allowed' });
            }

            // Buffer uploaded file data
            let fileBuffer;
            if (typeof part.toBuffer === 'function') {
              fileBuffer = await part.toBuffer();
            } else {
              const chunks = [];
              for await (const chunk of part.file) {
                chunks.push(chunk);
              }
              fileBuffer = Buffer.concat(chunks);
            }

            // Process image with Sharp pipeline (auto EXIF orientation, contrast stretch, sharpen, max 1600px, WebP compression)
            const processedResult = await processOrFallbackPhoto(fileBuffer, ext, imageOptions);

            const filename = `${generateId()}${processedResult.ext}`;
            const savePath = path.join(uploadDir, filename);
            await fs.promises.writeFile(savePath, processedResult.buffer);
            writtenFiles.push(savePath);
            photo_path = `/uploads/${filename}`;
          } else {
            if (part.fieldname === 'child_id') child_id = part.value;
            else if (part.fieldname === 'subject') subject = part.value;
            else if (part.fieldname === 'description') description = part.value;
            else if (part.fieldname === 'photo_path') throw Object.assign(new Error('请通过文件上传照片'), { status: 400 });
          }
        }
      } else {
        const body = request.body || {};
        child_id = body.child_id;
        subject = body.subject;
        description = body.description;
        if (body.photo_path) throw Object.assign(new Error('请通过文件上传照片'), { status: 400 });
      }

      if (request.user.epoch !== fastify.sessionEpoch()) throw Object.assign(new Error('数据已恢复，请重新登录'), { statusCode: 401 });
      if (request.user.role === 'child') fastify.requireChildAccess(request, child_id);
      const created = mistakesService.createMistake({
        child_id,
        subject,
        description,
        photo_path
      });
      committed = true;
      return reply.code(201).send(created);
    } catch (err) {
      return reply.code(err.statusCode || err.status || 500).send({ error: err.message || 'Internal server error' });
    } finally {
      if (!committed) for (const file of writtenFiles) await fs.promises.unlink(file).catch(() => {});
    }
  });

  fastify.put('/:id/master', async (request, reply) => {
    const isMastered = request.body && request.body.is_mastered !== undefined
      ? Boolean(request.body.is_mastered)
      : true;

    try {
      const updated = mistakesService.markMastered(request.params.id, isMastered);
      return reply.send(updated);
    } catch (err) {
      return reply.code(err.status || 500).send({ error: err.message || 'Internal server error' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    try {
      const result = await queuedDeletion(fastify.backupService, request, reply, () => {
        fastify.requireCurrentSession(request);
        const record = mistakesService.getMistake(request.params.id);
        if (record) fastify.requireChildAccess(request, record.child_id);
        return mistakesService.deleteMistake(request.params.id);
      });
      return reply.send(result);
    } catch (err) {
      return reply.code(err.status || err.statusCode || 500).send({ error: err.message || 'Internal server error' });
    }
  });
}

module.exports = mistakesRoutes;
