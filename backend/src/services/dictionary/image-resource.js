const sharp = require('sharp');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,249}\.(?:jpe?g|png|gif|webp)$/i;

async function imageContentType(filename, bytes) {
  const ext = filename.split('.').at(-1).toLowerCase();
  let type;
  if ((ext === 'jpg' || ext === 'jpeg') && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) type = 'image/jpeg';
  if (ext === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) type = 'image/png';
  if (ext === 'gif' && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) type = 'image/gif';
  if (ext === 'webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') type = 'image/webp';
  try {
    if (!type) throw new Error('unsupported');
    // Inspect metadata only: preserve original bytes/colours and bound decoded dimensions.
    await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    return type;
  } catch { throw { status: 422, message: '词典图片格式无效或暂不支持' }; }
}

module.exports = { MAX_IMAGE_BYTES, IMAGE_NAME, imageContentType };

