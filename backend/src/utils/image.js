const sharp = require('sharp');

/**
 * Default configuration for mistake photo pipeline
 */
const DEFAULT_OPTIONS = {
  maxDimension: 1600,
  format: 'webp',
  quality: 85,
  sharpen: {
    sigma: 1.2,
    m1: 1.0,
    m2: 2.0
  }
};

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/**
 * Checks whether the file extension is supported for image upload.
 * @param {string} ext
 * @returns {boolean}
 */
function isImageExtensionSupported(ext) {
  if (!ext || typeof ext !== 'string') return false;
  return SUPPORTED_EXTENSIONS.includes(ext.toLowerCase());
}

/**
 * Executes the Sharp image optimization pipeline for mistake photos:
 * 1. Auto-correct EXIF orientation (.rotate())
 * 2. Stretch contrast and normalize color levels (.normalize())
 * 3. Apply adaptive sharpening (.sharpen({ sigma: 1.2, m1: 1.0, m2: 2.0 }))
 * 4. Scale down largest dimension to 1600px while maintaining aspect ratio (.resize(...))
 * 5. Compress and standardize to lightweight WebP (or high-quality JPEG)
 *
 * @param {Buffer} inputBuffer
 * @param {object} [options]
 * @returns {Promise<{buffer: Buffer, format: string, ext: string, width: number, height: number, size: number}>}
 */
async function processMistakePhoto(inputBuffer, options = {}) {
  const maxDimension = options.maxDimension || DEFAULT_OPTIONS.maxDimension;
  const sharpenOpts = options.sharpen || DEFAULT_OPTIONS.sharpen;
  const targetFormat = (options.format || DEFAULT_OPTIONS.format).toLowerCase();
  const quality = options.quality !== undefined ? options.quality : DEFAULT_OPTIONS.quality;

  let pipeline = sharp(inputBuffer, { failOnError: false })
    .rotate()
    .normalize()
    .sharpen(sharpenOpts)
    .resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true
    });

  let ext;
  if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    ext = '.jpg';
  } else {
    pipeline = pipeline.webp({ quality });
    ext = '.webp';
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    format: info.format,
    ext,
    width: info.width,
    height: info.height,
    size: data.length
  };
}

/**
 * Gracefully processes an image buffer with Sharp.
 * If Sharp fails (e.g. invalid bytes, test fixtures, unsupported payload),
 * falls back to preserving the original buffer and extension.
 *
 * @param {Buffer} inputBuffer
 * @param {string} originalExt
 * @param {object} [options]
 * @returns {Promise<{success: boolean, buffer: Buffer, ext: string, format: string, processed: boolean, error?: string, width?: number, height?: number, size?: number}>}
 */
async function processOrFallbackPhoto(inputBuffer, originalExt, options = {}) {
  try {
    const result = await processMistakePhoto(inputBuffer, options);
    return {
      success: true,
      buffer: result.buffer,
      ext: result.ext,
      format: result.format,
      processed: true,
      width: result.width,
      height: result.height,
      size: result.size
    };
  } catch (err) {
    return {
      success: false,
      buffer: inputBuffer,
      ext: originalExt,
      format: (originalExt || '').replace(/^\./, ''),
      processed: false,
      error: err.message
    };
  }
}

module.exports = {
  DEFAULT_OPTIONS,
  SUPPORTED_EXTENSIONS,
  isImageExtensionSupported,
  processMistakePhoto,
  processOrFallbackPhoto
};
