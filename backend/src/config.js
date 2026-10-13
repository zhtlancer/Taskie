const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DATABASE_PATH || path.resolve(__dirname, '../data.sqlite'),
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads'),
  clientDistDir: process.env.CLIENT_DIST_DIR || path.resolve(__dirname, '../../frontend/dist'),
  jwtSecret: process.env.JWT_SECRET || 'homework-task-secret-key-2026',
  defaultParentPin: process.env.DEFAULT_PARENT_PIN || '1234',
  imageProcessing: {
    maxDimension: parseInt(process.env.IMAGE_MAX_DIMENSION || '1600', 10),
    format: process.env.IMAGE_FORMAT || 'webp',
    quality: parseInt(process.env.IMAGE_QUALITY || '85', 10),
    sharpen: {
      sigma: parseFloat(process.env.IMAGE_SHARPEN_SIGMA || '1.2'),
      m1: parseFloat(process.env.IMAGE_SHARPEN_M1 || '1.0'),
      m2: parseFloat(process.env.IMAGE_SHARPEN_M2 || '2.0')
    }
  }
};
