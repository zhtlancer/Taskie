const { generateId, hashPin } = require('../utils/crypto');

class ChildrenService {
  constructor(db, uploadDir) {
    this.db = db;
    this.uploadDir = uploadDir;
  }

  listChildren() {
    const rows = this.db.prepare(`
      SELECT id, name, avatar_emoji, (pin_hash IS NOT NULL AND pin_hash != '') AS has_pin, created_at
      FROM children
      ORDER BY created_at ASC
    `).all();

    return rows.map(r => ({
      ...r,
      has_pin: Boolean(r.has_pin)
    }));
  }

  getChild(id) {
    const row = this.db.prepare(`
      SELECT id, name, avatar_emoji, (pin_hash IS NOT NULL AND pin_hash != '') AS has_pin, created_at
      FROM children
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    return {
      ...row,
      has_pin: Boolean(row.has_pin)
    };
  }

  createChild({ name, avatar_emoji, pin }) {
    if (!name || typeof name !== 'string' || name.trim() === '') {
      throw { status: 400, message: 'Child name is required' };
    }

    const id = generateId();
    const emoji = avatar_emoji || '🐱';
    const pinHash = pin ? hashPin(pin) : null;
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO children (id, name, avatar_emoji, pin_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name.trim(), emoji, pinHash, createdAt);

    return {
      id,
      name: name.trim(),
      avatar_emoji: emoji,
      has_pin: Boolean(pinHash),
      created_at: createdAt
    };
  }

  updateChild(id, { name, avatar_emoji, pin }) {
    const existing = this.getChild(id);
    if (!existing) {
      throw { status: 404, message: 'Child not found' };
    }

    let newName = existing.name;
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw { status: 400, message: 'Child name cannot be empty' };
      }
      newName = name.trim();
    }

    const newEmoji = avatar_emoji !== undefined ? avatar_emoji : existing.avatar_emoji;

    if (pin !== undefined) {
      const newPinHash = (pin && String(pin).trim() !== '') ? hashPin(pin) : null;
      this.db.prepare(`
        UPDATE children
        SET name = ?, avatar_emoji = ?, pin_hash = ?
        WHERE id = ?
      `).run(newName, newEmoji, newPinHash, id);
    } else {
      this.db.prepare(`
        UPDATE children
        SET name = ?, avatar_emoji = ?
        WHERE id = ?
      `).run(newName, newEmoji, id);
    }

    return this.getChild(id);
  }

  deleteChild(id) {
    const existing = this.getChild(id);
    if (!existing) {
      throw { status: 404, message: 'Child not found' };
    }

    const photos = this.db.prepare('SELECT photo_path FROM mistake_records WHERE child_id = ?').all(id);
    this.db.prepare('DELETE FROM children WHERE id = ?').run(id);
    if (this.uploadDir) for (const { photo_path } of photos) {
      if (!photo_path?.startsWith('/uploads/')) continue;
      const fs = require('node:fs'), path = require('node:path');
      const name = path.basename(photo_path);
      if (!this.db.prepare('SELECT id FROM mistake_records WHERE photo_path = ?').get(photo_path)) {
        fs.rmSync(path.join(this.uploadDir, name), { force: true });
      }
    }
    return { success: true, id };
  }
}

module.exports = ChildrenService;
