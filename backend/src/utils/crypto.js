const crypto = require('crypto');

/**
 * Hashes a numeric or string PIN using PBKDF2 with a random salt.
 * Format: "salt:hash"
 */
function hashPin(pin) {
  if (!pin) return null;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(pin), salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a PIN against a stored "salt:hash" string.
 */
function verifyPin(pin, storedHash) {
  if (!storedHash) return false;
  if (!pin) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHash] = parts;
  const hash = crypto.pbkdf2Sync(String(pin), salt, 1000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

/**
 * Generates a standard UUID v4.
 */
function generateId() {
  return crypto.randomUUID();
}

module.exports = {
  hashPin,
  verifyPin,
  generateId
};
