const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createTestApp, cleanupTestApp } = require('./helper');

describe('Mistakes API (/api/mistakes)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Create mistake via JSON, list, mark mastered, and delete', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    const child = JSON.parse(childRes.body);

    // 1. Create mistake
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mistakes',
      payload: {
        child_id: child.id,
        subject: '数学',
        description: '加减法乘法口诀第8题做错'
      }
    });
    assert.equal(createRes.statusCode, 201);
    const mistake = JSON.parse(createRes.body);
    assert.equal(mistake.subject, '数学');
    assert.equal(mistake.description, '加减法乘法口诀第8题做错');
    assert.equal(mistake.is_mastered, false);
    assert.ok(mistake.id);

    // 2. List mistakes
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/mistakes?child_id=${child.id}&subject=数学`
    });
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body);
    assert.equal(list.length, 1);

    // 3. Mark mastered
    const masterRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/mistakes/${mistake.id}/master`,
      payload: { is_mastered: true }
    });
    assert.equal(masterRes.statusCode, 200);
    const mastered = JSON.parse(masterRes.body);
    assert.equal(mastered.is_mastered, true);
    assert.ok(mastered.mastered_at);

    // 4. Delete mistake
    const deleteRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/mistakes/${mistake.id}`
    });
    assert.equal(deleteRes.statusCode, 200);

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/mistakes/${mistake.id}`
    });
    assert.equal(getRes.statusCode, 404);
  });

  test('Create mistake with multipart photo upload', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小红' }
    });
    const child = JSON.parse(childRes.body);

    // Construct a multipart payload manually
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const fakeImageContent = Buffer.from('fake-image-bytes-png');

    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="child_id"\r\n\r\n${child.id}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n英语\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n单词拼写错误\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
      fakeImageContent,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mistakes',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartBody
    });

    assert.equal(uploadRes.statusCode, 201);
    const created = JSON.parse(uploadRes.body);
    assert.equal(created.subject, '英语');
    assert.ok(created.photo_path.startsWith('/uploads/'));
    assert.ok(created.photo_path.endsWith('.png'));

    // Check that photo was saved to disk
    const savedFileName = path.basename(created.photo_path);
    const savedFilePath = path.join(ctx.tempUploadDir, savedFileName);
    assert.ok(fs.existsSync(savedFilePath));

    // Delete mistake should clean up file
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/mistakes/${created.id}`
    });
    assert.ok(!fs.existsSync(savedFilePath));
  });

  test('Create mistake with real high-resolution photo upload and Sharp optimization pipeline', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    const child = JSON.parse(childRes.body);

    // Create a high-res (2000x1500) JPEG image
    const rawPhoto = await sharp({
      create: {
        width: 2000,
        height: 1500,
        channels: 3,
        background: { r: 245, g: 245, b: 245 }
      }
    })
    .jpeg({ quality: 100 })
    .toBuffer();

    const boundary = '----WebKitFormBoundarySharpTestUpload';
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="child_id"\r\n\r\n${child.id}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n数学\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n分数运算错题拍照\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="camera_photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      rawPhoto,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mistakes',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartBody
    });

    assert.equal(uploadRes.statusCode, 201);
    const created = JSON.parse(uploadRes.body);
    assert.equal(created.subject, '数学');
    assert.ok(created.photo_path.startsWith('/uploads/'));
    // Verified converted to lightweight WebP
    assert.ok(created.photo_path.endsWith('.webp'));

    // Check processed photo on disk
    const savedFileName = path.basename(created.photo_path);
    const savedFilePath = path.join(ctx.tempUploadDir, savedFileName);
    assert.ok(fs.existsSync(savedFilePath));

    const savedStats = fs.statSync(savedFilePath);
    assert.ok(savedStats.size > 0);
    // Verified compressed
    assert.ok(savedStats.size < rawPhoto.length);

    // Verify sharp metadata: maxDimension scaled to 1600 (2000x1500 -> 1600x1200)
    const savedMeta = await sharp(savedFilePath).metadata();
    assert.equal(savedMeta.format, 'webp');
    assert.equal(savedMeta.width, 1600);
    assert.equal(savedMeta.height, 1200);

    // Delete mistake cleans up webp file
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/mistakes/${created.id}`
    });
    assert.ok(!fs.existsSync(savedFilePath));
  });

  test('Create mistake with EXIF orientation rotated photo auto-corrects', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    const child = JSON.parse(childRes.body);

    // Create 300x150 image with EXIF orientation 6 (90° CW)
    const rawPhoto = await sharp({
      create: {
        width: 300,
        height: 150,
        channels: 3,
        background: { r: 120, g: 150, b: 180 }
      }
    })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

    const boundary = '----WebKitFormBoundaryExifTest';
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="child_id"\r\n\r\n${child.id}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n语文\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n古诗默写错字拍照\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rotated.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      rawPhoto,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mistakes',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartBody
    });

    assert.equal(uploadRes.statusCode, 201);
    const created = JSON.parse(uploadRes.body);

    const savedFileName = path.basename(created.photo_path);
    const savedFilePath = path.join(ctx.tempUploadDir, savedFileName);
    const savedMeta = await sharp(savedFilePath).metadata();

    // Orientation 6 rotated 90° CW, so 300x150 becomes 150x300, and orientation is reset
    assert.equal(savedMeta.width, 150);
    assert.equal(savedMeta.height, 300);
    assert.equal(savedMeta.orientation, undefined);
  });

  test('Reject non-image file upload with 400 validation error', async () => {
    ctx = createTestApp();

    const childRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/children',
      payload: { name: '小明' }
    });
    const child = JSON.parse(childRes.body);

    const boundary = '----WebKitFormBoundaryRejectTest';
    const multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="child_id"\r\n\r\n${child.id}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n数学\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n非图片文件\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('%PDF-1.4 ... fake pdf content ...'),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/mistakes',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: multipartBody
    });

    assert.equal(uploadRes.statusCode, 400);
    const body = JSON.parse(uploadRes.body);
    assert.ok(body.error);
  });
});
