const fs = require('fs');
const path = require('path');
const { generateId } = require('../utils/crypto');
const config = require('../config');
const { editVersion, requireEditVersion } = require('../utils/edit-version');

const describeMistake = row => ({ ...row, is_mastered: Boolean(row.is_mastered),
  edit_version: editVersion([row.subject, row.description]) });

class MistakesService {
  constructor(db, uploadDir) {
    this.db = db;
    this.uploadDir = uploadDir || config.uploadDir;
  }

  listMistakes({ child_id, subject }) {
    let query = `
      SELECT id, child_id, subject, description, photo_path, is_mastered, created_at, mastered_at
      FROM mistake_records
      WHERE 1=1
    `;
    const params = [];

    if (child_id) {
      query += ' AND child_id = ?';
      params.push(child_id);
    }
    if (subject) {
      query += ' AND subject = ?';
      params.push(subject);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params);
    return rows.map(describeMistake);
  }

  getMistake(id) {
    const row = this.db.prepare(`
      SELECT id, child_id, subject, description, photo_path, is_mastered, created_at, mastered_at
      FROM mistake_records
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    return describeMistake(row);
  }

  createMistake({ child_id, subject, description, photo_path }) {
    if (!child_id) {
      throw { status: 400, message: 'child_id is required' };
    }
    if (!subject || typeof subject !== 'string' || subject.trim() === '') {
      throw { status: 400, message: 'subject is required' };
    }
    if (!description || typeof description !== 'string' || description.trim() === '') {
      throw { status: 400, message: 'description is required' };
    }

    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(child_id);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    const id = generateId();
    const createdAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO mistake_records (id, child_id, subject, description, photo_path, is_mastered, created_at, mastered_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, NULL)
    `).run(id, child_id, subject.trim(), description.trim(), photo_path || null, createdAt);

    return this.getMistake(id);
  }

  updateMistake(id, body) {
    const existing = this.getMistake(id);
    if (!existing) throw { status: 404, message: '错题记录不存在' };
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(key => !['subject', 'description', 'expected_version'].includes(key))) {
      throw { status: 400, message: '只能修改错题的学科和文字内容' };
    }
    requireEditVersion(body.expected_version, existing.edit_version);
    const subject = body.subject === undefined ? existing.subject : body.subject;
    const description = body.description === undefined ? existing.description : body.description;
    if (typeof subject !== 'string' || !subject.trim() || subject.trim().length > 50 ||
        typeof description !== 'string' || !description.trim() || description.trim().length > 10000) {
      throw { status: 400, message: '请选择学科并填写题目描述（学科最多 50 字，描述最多 10000 字）' };
    }
    this.db.prepare('UPDATE mistake_records SET subject = ?, description = ? WHERE id = ?')
      .run(subject.trim(), description.trim(), id);
    return this.getMistake(id);
  }

  markMastered(id, isMastered = true) {
    const existing = this.getMistake(id);
    if (!existing) {
      throw { status: 404, message: 'Mistake record not found' };
    }

    const now = isMastered ? new Date().toISOString() : null;
    const masteredVal = isMastered ? 1 : 0;

    this.db.prepare(`
      UPDATE mistake_records
      SET is_mastered = ?, mastered_at = ?
      WHERE id = ?
    `).run(masteredVal, now, id);

    return this.getMistake(id);
  }

  deleteMistake(id) {
    const existing = this.getMistake(id);
    if (!existing) {
      throw { status: 404, message: 'Mistake record not found' };
    }

    // Try deleting photo if local file exists
    if (existing.photo_path) {
      const fileName = path.basename(existing.photo_path);
      const filePath = path.join(this.uploadDir, fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore unlink error
        }
      }
    }

    this.db.prepare('DELETE FROM mistake_records WHERE id = ?').run(id);
    return { success: true, id };
  }
}

module.exports = MistakesService;
