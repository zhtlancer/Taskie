const fs = require('fs');
const path = require('path');
const buildApp = require('../src/app');
const { getDb } = require('../src/db');

function createTestApp({ authenticated = true, defaultParentPin = false, deviceAuth = false } = {}) {
  // Use in-memory SQLite for isolated, fast tests
  const db = getDb(':memory:');
  // Most tests exercise the parent console as if the default PIN had already been changed
  // (the PIN itself stays 1234); the forced-change flow opts back in.
  if (!defaultParentPin) db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
  const tempUploadDir = path.join(__dirname, '../uploads/test-' + Math.random().toString(36).substring(7));

  const app = buildApp({
    logger: false,
    db,
    uploadDir: tempUploadDir,
    jwtSecret: 'test-jwt-secret',
    backupDir: path.join(tempUploadDir, '../backups-' + Math.random().toString(36).slice(2)),
    backupIntervalHours: 0,
    // Feature tests run as an already-authorized device; the device gate has its own tests.
    deviceAuth,
    authorizedTokensFile: path.join(tempUploadDir, '../authorized-tokens-' + Math.random().toString(36).slice(2))
  });
  const rawInject = app.inject.bind(app);
  if (authenticated) app.inject = async options => {
    await app.ready();
    const headers = { ...options.headers };
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'authorization')) {
      headers.authorization = `Bearer ${app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() })}`;
    }
    return rawInject({ ...options, headers });
  };

  return { app, db, tempUploadDir, rawInject };
}

function cleanupTestApp(testContext) {
  if (testContext.app) {
    testContext.app.close();
  }
  if (testContext.tempUploadDir && fs.existsSync(testContext.tempUploadDir)) {
    fs.rmSync(testContext.tempUploadDir, { recursive: true, force: true });
  }
  if (testContext.app?.backupService) fs.rmSync(testContext.app.backupService.backupDir, { recursive: true, force: true });
}

module.exports = {
  createTestApp,
  cleanupTestApp
};
