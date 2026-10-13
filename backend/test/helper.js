const fs = require('fs');
const path = require('path');
const buildApp = require('../src/app');
const { getDb } = require('../src/db');

function createTestApp() {
  // Use in-memory SQLite for isolated, fast tests
  const db = getDb(':memory:');
  const tempUploadDir = path.join(__dirname, '../uploads/test-' + Math.random().toString(36).substring(7));

  const app = buildApp({
    logger: false,
    db,
    uploadDir: tempUploadDir,
    jwtSecret: 'test-jwt-secret'
  });

  return { app, db, tempUploadDir };
}

function cleanupTestApp(testContext) {
  if (testContext.app) {
    testContext.app.close();
  }
  if (testContext.tempUploadDir && fs.existsSync(testContext.tempUploadDir)) {
    fs.rmSync(testContext.tempUploadDir, { recursive: true, force: true });
  }
}

module.exports = {
  createTestApp,
  cleanupTestApp
};
