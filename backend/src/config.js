const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DATABASE_PATH || path.resolve(__dirname, '../data.sqlite'),
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads'),
  clientDistDir: process.env.CLIENT_DIST_DIR || path.resolve(__dirname, '../../frontend/dist'),
  jwtSecret: process.env.JWT_SECRET || null,
  timeZone: process.env.TIME_ZONE || 'Asia/Shanghai',
  backupDir: process.env.BACKUP_DIR || path.resolve(path.dirname(process.env.DATABASE_PATH || path.resolve(__dirname, '../data.sqlite')), 'backups'),
  backupIntervalHours: Number(process.env.BACKUP_INTERVAL_HOURS || 24),
  backupRetention: Number(process.env.BACKUP_RETENTION || 7),
  // Device authorization gate; DEVICE_AUTH=off disables it (e.g. for local development).
  deviceAuth: process.env.DEVICE_AUTH !== 'off',
  authorizedTokensFile: process.env.AUTHORIZED_TOKENS_FILE || path.resolve(path.dirname(process.env.DATABASE_PATH || path.resolve(__dirname, '../data.sqlite')), 'authorized_tokens'),
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
