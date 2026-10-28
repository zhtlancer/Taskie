const { generateId } = require('../utils/crypto');

// Fixed categories, in display order: 会认读, 会写, 笔画要改正, 易错字. Anyone may add a category to an
// entry; only parents may take one away, so a correction mark stays until a parent clears it.
const CATEGORIES = ['recognize', 'write', 'fix_strokes', 'error_prone'];
const MAX_WORD_LENGTH = 8;
const COLUMNS = 'id, child_id, char, pinyin, strokes, radical, is_mastered, created_at, mastered_at, categories';

function normalizeCategories(categories) {
  if (categories === undefined || categories === null) return [];
  if (!Array.isArray(categories) || categories.some(key => !CATEGORIES.includes(key))) {
    throw { status: 400, message: '分类无效' };
  }
  return CATEGORIES.filter(key => categories.includes(key));
}

function toEntry(row) {
  let categories = [];
  try {
    categories = normalizeCategories(JSON.parse(row.categories || '[]'));
  } catch {}
  return { ...row, is_mastered: Boolean(row.is_mastered), categories };
}

class CharactersService {
  constructor(db) {
    this.db = db;
  }

  listCharacters({ child_id, is_mastered, category }) {
    if (!child_id) {
      throw { status: 400, message: '请选择孩子' };
    }

    if (category && !CATEGORIES.includes(category)) throw { status: 400, message: '分类无效' };
    let query = `SELECT ${COLUMNS} FROM characters WHERE child_id = ?`;
    const params = [child_id];

    if (is_mastered !== undefined && is_mastered !== null && is_mastered !== '') {
      const isTrue = is_mastered === '1' || is_mastered === 1 || is_mastered === true || is_mastered === 'true';
      query += ' AND is_mastered = ?';
      params.push(isTrue ? 1 : 0);
    }

    query += ' ORDER BY created_at DESC';

    const entries = this.db.prepare(query).all(...params).map(toEntry);
    return category ? entries.filter(entry => entry.categories.includes(category)) : entries;
  }

  getCharacter(id) {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM characters WHERE id = ?`).get(id);
    return row ? toEntry(row) : null;
  }

  // An entry is a single character or a word of up to 8 Chinese characters.
  createCharacter({ child_id, char, pinyin, strokes, radical, categories }) {
    if (!child_id) {
      throw { status: 400, message: '请选择孩子' };
    }

    // Check if child exists
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(child_id);
    if (!child) {
      throw { status: 404, message: '孩子不存在' };
    }

    if (!char || typeof char !== 'string') {
      throw { status: 400, message: '请输入汉字或词语' };
    }

    const trimmedChar = char.trim();
    if (!/^\p{Script=Han}+$/u.test(trimmedChar) || Array.from(trimmedChar).length > MAX_WORD_LENGTH) {
      throw { status: 400, message: `请输入 1 到 ${MAX_WORD_LENGTH} 个汉字` };
    }
    const isWord = Array.from(trimmedChar).length > 1;
    const initialCategories = normalizeCategories(categories);

    // Check duplicate
    const existing = this.db.prepare('SELECT id FROM characters WHERE child_id = ? AND char = ?').get(child_id, trimmedChar);
    if (existing) {
      throw { status: 409, message: '该字词已在生字生词本中，请勿重复添加' };
    }

    const id = generateId();
    const createdAt = new Date().toISOString();
    const parsedStrokes = strokes !== undefined && strokes !== null && strokes !== '' ? parseInt(strokes, 10) : null;
    // Stroke count and radical describe a single character; words have neither.
    const finalStrokes = !isWord && Number.isInteger(parsedStrokes) ? parsedStrokes : null;
    const finalPinyin = typeof pinyin === 'string' && pinyin.trim() !== '' ? pinyin.trim() : null;
    const finalRadical = !isWord && typeof radical === 'string' && radical.trim() !== '' ? radical.trim() : null;

    try {
      this.db.prepare(`
        INSERT INTO characters (id, child_id, char, pinyin, strokes, radical, is_mastered, created_at, mastered_at, categories)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)
      `).run(id, child_id, trimmedChar, finalPinyin, finalStrokes, finalRadical, createdAt, JSON.stringify(initialCategories));
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw { status: 409, message: '该字词已在生字生词本中，请勿重复添加' };
      }
      throw err;
    }

    return this.getCharacter(id);
  }

  markMastered(id, isMastered = null) {
    const existing = this.getCharacter(id);
    if (!existing) {
      throw { status: 404, message: '该字词不存在，可能已被移出，请刷新后重试' };
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

  // Replaces an entry's categories. Children may only add: removing one needs a parent.
  setCategories(id, categories, { role } = {}) {
    const existing = this.getCharacter(id);
    if (!existing) {
      throw { status: 404, message: '该字词不存在，可能已被移出，请刷新后重试' };
    }
    const next = normalizeCategories(categories ?? []);
    if (role !== 'parent' && existing.categories.some(key => !next.includes(key))) {
      throw { status: 403, message: '只有家长可以去掉分类' };
    }
    this.db.prepare('UPDATE characters SET categories = ? WHERE id = ?').run(JSON.stringify(next), id);
    return this.getCharacter(id);
  }

  // Removing a categorized entry would also remove its categories, so that needs a parent too.
  deleteCharacter(id, { role } = {}) {
    const existing = this.getCharacter(id);
    if (!existing) {
      throw { status: 404, message: '该字词不存在，可能已被移出，请刷新后重试' };
    }
    if (role !== 'parent' && existing.categories.length) {
      throw { status: 403, message: '这个字词有分类标记，需要家长移出' };
    }

    this.db.prepare('DELETE FROM characters WHERE id = ?').run(id);
    return { success: true, id };
  }
}

module.exports = CharactersService;
module.exports.CATEGORIES = CATEGORIES;
