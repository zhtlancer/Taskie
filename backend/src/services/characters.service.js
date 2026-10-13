const { generateId } = require('../utils/crypto');

class CharactersService {
  constructor(db) {
    this.db = db;
  }

  listCharacters({ child_id, is_mastered }) {
    if (!child_id) {
      throw { status: 400, message: 'child_id is required' };
    }

    let query = `
      SELECT id, child_id, char, pinyin, strokes, radical, is_mastered, created_at, mastered_at
      FROM characters
      WHERE child_id = ?
    `;
    const params = [child_id];

    if (is_mastered !== undefined && is_mastered !== null && is_mastered !== '') {
      const isTrue = is_mastered === '1' || is_mastered === 1 || is_mastered === true || is_mastered === 'true';
      query += ' AND is_mastered = ?';
      params.push(isTrue ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      is_mastered: Boolean(r.is_mastered)
    }));
  }

  getCharacter(id) {
    const row = this.db.prepare(`
      SELECT id, child_id, char, pinyin, strokes, radical, is_mastered, created_at, mastered_at
      FROM characters
      WHERE id = ?
    `).get(id);

    if (!row) return null;
    return {
      ...row,
      is_mastered: Boolean(row.is_mastered)
    };
  }

  createCharacter({ child_id, char, pinyin, strokes, radical }) {
    if (!child_id) {
      throw { status: 400, message: 'child_id is required' };
    }

    // Check if child exists
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(child_id);
    if (!child) {
      throw { status: 404, message: 'Child not found' };
    }

    // Validate char: single Chinese character required
    if (!char || typeof char !== 'string') {
      throw { status: 400, message: 'char is required' };
    }

    const trimmedChar = char.trim();
    if (!trimmedChar || Array.from(trimmedChar).length !== 1) {
      throw { status: 400, message: 'char must be a single character' };
    }

    // Check duplicate
    const existing = this.db.prepare('SELECT id FROM characters WHERE child_id = ? AND char = ?').get(child_id, trimmedChar);
    if (existing) {
      throw { status: 409, message: 'Character already exists in character book' };
    }

    const id = generateId();
    const createdAt = new Date().toISOString();
    const parsedStrokes = strokes !== undefined && strokes !== null && strokes !== '' ? parseInt(strokes, 10) : null;
    const finalStrokes = Number.isInteger(parsedStrokes) ? parsedStrokes : null;
    const finalPinyin = typeof pinyin === 'string' && pinyin.trim() !== '' ? pinyin.trim() : null;
    const finalRadical = typeof radical === 'string' && radical.trim() !== '' ? radical.trim() : null;

    try {
      this.db.prepare(`
        INSERT INTO characters (id, child_id, char, pinyin, strokes, radical, is_mastered, created_at, mastered_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL)
      `).run(id, child_id, trimmedChar, finalPinyin, finalStrokes, finalRadical, createdAt);
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw { status: 409, message: 'Character already exists in character book' };
      }
      throw err;
    }

    return this.getCharacter(id);
  }

  markMastered(id, isMastered = null) {
    const existing = this.getCharacter(id);
    if (!existing) {
      throw { status: 404, message: 'Character not found' };
    }

    const targetMastered = isMastered !== null && isMastered !== undefined
      ? Boolean(isMastered)
      : !existing.is_mastered;

    const now = targetMastered ? new Date().toISOString() : null;
    const masteredVal = targetMastered ? 1 : 0;

    this.db.prepare(`
      UPDATE characters
      SET is_mastered = ?, mastered_at = ?
      WHERE id = ?
    `).run(masteredVal, now, id);

    return this.getCharacter(id);
  }

  deleteCharacter(id) {
    const existing = this.getCharacter(id);
    if (!existing) {
      throw { status: 404, message: 'Character not found' };
    }

    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return { success: true, id };
  }
}

module.exports = CharactersService;
