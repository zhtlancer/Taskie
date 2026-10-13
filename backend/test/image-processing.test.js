const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  processMistakePhoto,
  processOrFallbackPhoto,
  isImageExtensionSupported
} = require('../src/utils/image');

describe('Image Utility (backend/src/utils/image.js)', () => {
  test('isImageExtensionSupported validates allowed image extensions', () => {
    assert.equal(isImageExtensionSupported('.jpg'), true);
    assert.equal(isImageExtensionSupported('.jpeg'), true);
    assert.equal(isImageExtensionSupported('.png'), true);
    assert.equal(isImageExtensionSupported('.webp'), true);
    assert.equal(isImageExtensionSupported('.JPG'), true);
    assert.equal(isImageExtensionSupported('.PNG'), true);
    assert.equal(isImageExtensionSupported('.pdf'), false);
    assert.equal(isImageExtensionSupported('.txt'), false);
    assert.equal(isImageExtensionSupported(''), false);
    assert.equal(isImageExtensionSupported(null), false);
  });

  test('processMistakePhoto auto-corrects EXIF orientation', async () => {
    // 200x100 with orientation 6 (90° CW)
    const rawImage = await sharp({
      create: {
        width: 200,
        height: 100,
        channels: 3,
        background: { r: 180, g: 200, b: 220 }
      }
    })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();

    const rawMeta = await sharp(rawImage).metadata();
    assert.equal(rawMeta.orientation, 6);

    const result = await processMistakePhoto(rawImage);
    assert.equal(result.format, 'webp');
    assert.equal(result.ext, '.webp');

    const processedMeta = await sharp(result.buffer).metadata();
    assert.equal(processedMeta.width, 100);
    assert.equal(processedMeta.height, 200);
    assert.equal(processedMeta.orientation, undefined);
  });

  test('processMistakePhoto downscales oversized images to max dimension 1600px', async () => {
    // 3200x2400 (4:3)
    const rawLargeImage = await sharp({
      create: {
        width: 3200,
        height: 2400,
        channels: 3,
        background: { r: 255, g: 250, b: 240 }
      }
    })
    .jpeg()
    .toBuffer();

    const result = await processMistakePhoto(rawLargeImage);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 1600);
    assert.equal(meta.height, 1200);
    assert.equal(result.format, 'webp');
  });

  test('processMistakePhoto preserves smaller image dimensions without enlargement', async () => {
    const rawSmallImage = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 200, g: 200, b: 200 }
      }
    })
    .png()
    .toBuffer();

    const result = await processMistakePhoto(rawSmallImage);
    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.width, 800);
    assert.equal(meta.height, 600);
  });

  test('processMistakePhoto supports JPEG format configuration', async () => {
    const rawImage = await sharp({
      create: {
        width: 500,
        height: 400,
        channels: 3,
        background: { r: 120, g: 140, b: 160 }
      }
    })
    .jpeg()
    .toBuffer();

    const result = await processMistakePhoto(rawImage, { format: 'jpeg', quality: 90 });
    assert.equal(result.format, 'jpeg');
    assert.equal(result.ext, '.jpg');

    const meta = await sharp(result.buffer).metadata();
    assert.equal(meta.format, 'jpeg');
  });

  test('processOrFallbackPhoto falls back gracefully on non-image buffer', async () => {
    const invalidBuffer = Buffer.from('not-a-valid-image-content');
    const result = await processOrFallbackPhoto(invalidBuffer, '.png');

    assert.equal(result.success, false);
    assert.equal(result.processed, false);
    assert.equal(result.ext, '.png');
    assert.deepEqual(result.buffer, invalidBuffer);
    assert.ok(result.error);
  });
});
