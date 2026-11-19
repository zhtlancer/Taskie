const { generateId } = require('../utils/crypto');
const {
  ENGLISH_CATEGORIES,
  identityKey,
  canonicalKey,
  validateEnglishWord,
  normalizeEnglishCategories,
  normalizeOptionalText,
  normalizeMetaText
} = require('../utils/english-word');

const COLUMNS = `id, child_id, word, identity_key, canonical_key, phonetic, phonetic_uk, phonetic_us,
  pos, definition_zh, definition_en, textbook, unit, note, categories, is_mastered, created_at, mastered_at`;

const MAX_BATCH_WORDS = 100;

function checkMetadataPermission(payload, role, existing = {}) {
  if (role === 'parent') return;
  for (const key of ['textbook', 'unit']) {
    if (payload[key] !== undefined && normalizeMetaText(payload[key]) !== (existing[key] || null)) {
      throw { status: 403, message: '只有家长可以设置教材和单元' };
    }
  }
}

function toEntry(row) {
  let categories = [];
  try {
    categories = normalizeEnglishCategories(JSON.parse(row.categories || '[]'));
  } catch {}
  return {
    ...row,
    is_mastered: Boolean(row.is_mastered),
    categories
  };
}

class EnglishWordsService {
  constructor(db) {
    this.db = db;
  }

  ensureChildExists(childId) {
    if (!childId) throw { status: 400, message: '请选择孩子' };
    const child = this.db.prepare('SELECT id FROM children WHERE id = ?').get(childId);
    if (!child) throw { status: 404, message: '孩子不存在' };
  }

  listWords({ child_id, is_mastered, category, textbook, unit, search } = {}) {
    if (!child_id) throw { status: 400, message: '请选择孩子' };
    if (category && !ENGLISH_CATEGORIES.includes(category)) {
      throw { status: 400, message: '分类无效' };
    }

    let query = `SELECT ${COLUMNS} FROM english_words WHERE child_id = ?`;
    const params = [child_id];

    if (is_mastered !== undefined && is_mastered !== null && is_mastered !== '') {
      const isTrue = is_mastered === '1' || is_mastered === 1 || is_mastered === true || is_mastered === 'true';
      query += ' AND is_mastered = ?';
      params.push(isTrue ? 1 : 0);
    }

    if (textbook !== undefined && textbook !== null && String(textbook).trim() !== '') {
      query += ' AND textbook = ?';
      params.push(String(textbook).trim());
    }

    if (unit !== undefined && unit !== null && String(unit).trim() !== '') {
      query += ' AND unit = ?';
      params.push(String(unit).trim());
    }

    query += ' ORDER BY created_at DESC';
    let entries = this.db.prepare(query).all(...params).map(toEntry);

    if (category) {
      entries = entries.filter(entry => entry.categories.includes(category));
    }

    const q = typeof search === 'string' ? search.trim().toLowerCase() : '';
    if (q) {
      entries = entries.filter(entry =>
        entry.word.toLowerCase().includes(q)
        || (entry.definition_zh && entry.definition_zh.toLowerCase().includes(q))
        || (entry.definition_en && entry.definition_en.toLowerCase().includes(q))
        || (entry.unit && entry.unit.toLowerCase().includes(q))
      );
    }

    return entries;
  }

  listTaxonomy(childId) {
    this.ensureChildExists(childId);
    const textbooks = this.db.prepare(`
      SELECT DISTINCT textbook FROM english_words
      WHERE child_id = ? AND textbook IS NOT NULL AND textbook != ''
      ORDER BY textbook
    `).all(childId).map(r => r.textbook);

    const units = this.db.prepare(`
      SELECT DISTINCT unit FROM english_words
      WHERE child_id = ? AND unit IS NOT NULL AND unit != ''
      ORDER BY unit
    `).all(childId).map(r => r.unit);

    return { textbooks, units };
  }

  getWord(id) {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM english_words WHERE id = ?`).get(id);
    return row ? toEntry(row) : null;
  }

  createWord(payload = {}, { role } = {}) {
    const {
      child_id,
      word,
      phonetic,
      phonetic_uk,
      phonetic_us,
      pos,
      definition_zh,
      definition_en,
      textbook,
      unit,
      note,
      categories
    } = payload;

    this.ensureChildExists(child_id);
    checkMetadataPermission(payload, role);
    const cleanWord = validateEnglishWord(word);
    const idKey = identityKey(cleanWord);
    const canKey = canonicalKey(cleanWord);
    const initialCategories = normalizeEnglishCategories(categories);

    const dup = this.db.prepare('SELECT id FROM english_words WHERE child_id = ? AND identity_key = ?').get(child_id, idKey);
    if (dup) {
      throw { status: 409, message: '该单词已在英语单词本中，请勿重复添加' };
    }

    const id = generateId();
    const createdAt = new Date().toISOString();
    const cleanUk = normalizeOptionalText(phonetic_uk, 80);
    const cleanUs = normalizeOptionalText(phonetic_us, 80);
    const cleanPhonetic = normalizeOptionalText(phonetic, 80) || cleanUk || cleanUs || null;

    try {
      this.db.prepare(`
        INSERT INTO english_words (
          id, child_id, word, identity_key, canonical_key,
          phonetic, phonetic_uk, phonetic_us, pos, definition_zh, definition_en,
          textbook, unit, note, categories, is_mastered, created_at, mastered_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
      `).run(
        id,
        child_id,
        cleanWord,
        idKey,
        canKey,
        cleanPhonetic,
        cleanUk,
        cleanUs,
        normalizeOptionalText(pos, 60),
        normalizeOptionalText(definition_zh, 400),
        normalizeOptionalText(definition_en, 400),
        normalizeMetaText(textbook),
        normalizeMetaText(unit),
        normalizeOptionalText(note, 300),
        JSON.stringify(initialCategories),
        createdAt
      );
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        throw { status: 409, message: '该单词已在英语单词本中，请勿重复添加' };
      }
      throw err;
    }

    return this.getWord(id);
  }

  updateWord(id, payload = {}, { role } = {}) {
    const existing = this.getWord(id);
    if (!existing) {
      throw { status: 404, message: '该单词不存在，可能已被移出，请刷新后重试' };
    }

    checkMetadataPermission(payload, role, existing);

    let nextWord = existing.word;
    let nextIdKey = existing.identity_key;
    let nextCanKey = existing.canonical_key;
    if (payload.word !== undefined) {
      nextWord = validateEnglishWord(payload.word);
      nextIdKey = identityKey(nextWord);
      nextCanKey = canonicalKey(nextWord);
      if (nextIdKey !== existing.identity_key) {
        const dup = this.db.prepare('SELECT id FROM english_words WHERE child_id = ? AND identity_key = ? AND id != ?')
          .get(existing.child_id, nextIdKey, id);
        if (dup) throw { status: 409, message: '该单词已在英语单词本中，无法重命名为重复词条' };
      }
    }

    let nextCategories = existing.categories;
    if (payload.categories !== undefined) {
      nextCategories = normalizeEnglishCategories(payload.categories);
      if (role !== 'parent' && existing.categories.some(k => !nextCategories.includes(k))) {
        throw { status: 403, message: '只有家长可以去掉分类' };
      }
    }

    const nextUk = payload.phonetic_uk !== undefined ? normalizeOptionalText(payload.phonetic_uk, 80) : existing.phonetic_uk;
    const nextUs = payload.phonetic_us !== undefined ? normalizeOptionalText(payload.phonetic_us, 80) : existing.phonetic_us;
    const nextPhonetic = payload.phonetic !== undefined
      ? (normalizeOptionalText(payload.phonetic, 80) || nextUk || nextUs || null)
      : (existing.phonetic || nextUk || nextUs || null);

    this.db.prepare(`
      UPDATE english_words
      SET word = ?, identity_key = ?, canonical_key = ?,
          phonetic = ?, phonetic_uk = ?, phonetic_us = ?,
          pos = ?, definition_zh = ?, definition_en = ?,
          textbook = ?, unit = ?, note = ?, categories = ?
      WHERE id = ?
    `).run(
      nextWord,
      nextIdKey,
      nextCanKey,
      nextPhonetic,
      nextUk,
      nextUs,
      payload.pos !== undefined ? normalizeOptionalText(payload.pos, 60) : existing.pos,
      payload.definition_zh !== undefined ? normalizeOptionalText(payload.definition_zh, 400) : existing.definition_zh,
      payload.definition_en !== undefined ? normalizeOptionalText(payload.definition_en, 400) : existing.definition_en,
      payload.textbook !== undefined ? normalizeMetaText(payload.textbook) : existing.textbook,
      payload.unit !== undefined ? normalizeMetaText(payload.unit) : existing.unit,
      payload.note !== undefined ? normalizeOptionalText(payload.note, 300) : existing.note,
      JSON.stringify(nextCategories),
      id
    );

    return this.getWord(id);
  }

  markMastered(id, isMastered = null) {
    const existing = this.getWord(id);
    if (!existing) {
      throw { status: 404, message: '该单词不存在，可能已被移出，请刷新后重试' };
    }
    const targetMastered = isMastered !== null && isMastered !== undefined
      ? Boolean(isMastered)
      : !existing.is_mastered;
    const now = targetMastered ? new Date().toISOString() : null;
    this.db.prepare('UPDATE english_words SET is_mastered = ?, mastered_at = ? WHERE id = ?')
      .run(targetMastered ? 1 : 0, now, id);
    return this.getWord(id);
  }

  setCategories(id, categories, { role } = {}) {
    const existing = this.getWord(id);
    if (!existing) {
      throw { status: 404, message: '该单词不存在，可能已被移出，请刷新后重试' };
    }
    const next = normalizeEnglishCategories(categories ?? []);
    if (role !== 'parent' && existing.categories.some(key => !next.includes(key))) {
      throw { status: 403, message: '只有家长可以去掉分类' };
    }
    this.db.prepare('UPDATE english_words SET categories = ? WHERE id = ?').run(JSON.stringify(next), id);
    return this.getWord(id);
  }

  async batchPreview(childId, rawText, { dictionaryService } = {}) {
    this.ensureChildExists(childId);
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw { status: 400, message: '请输入单词列表，每行可用制表符分隔英文和中文释义' };
    }

    const tokens = rawText
      .split(/\r?\n|\r/)
      .filter(line => line.trim())
      // A TSV row is one entry; commas and semicolons in its meaning are content.
      .flatMap(line => line.includes('\t') ? [line] : line.split(/[,;，；、]+/).map(s => s.trim()).filter(Boolean));

    if (tokens.length > MAX_BATCH_WORDS) {
      throw { status: 400, message: `单次最多预览 ${MAX_BATCH_WORDS} 个单词，请分批导入` };
    }

    const existingRows = this.db.prepare('SELECT id, identity_key, word FROM english_words WHERE child_id = ?').all(childId);
    const existingByIdKey = new Map(existingRows.map(r => [r.identity_key, r]));

    const seenInBatch = new Set();
    const items = [];

    for (const raw of tokens) {
      const columns = raw.split('\t');
      const suppliedMeaning = columns.length === 2 ? normalizeOptionalText(columns[1], 400) : null;
      let validWord;
      try {
        if (columns.length > 2) throw { message: '每行仅支持英文和中文释义两列，请用制表符分隔' };
        validWord = validateEnglishWord(columns[0]);
      } catch (err) {
        items.push({ raw, word: raw, status: 'invalid', error: err.message });
        continue;
      }

      const idKey = identityKey(validWord);
      if (seenInBatch.has(idKey)) continue;
      seenInBatch.add(idKey);

      const existing = existingByIdKey.get(idKey);
      if (existing) {
        items.push({
          raw,
          word: existing.word,
          identity_key: idKey,
          status: 'duplicate',
          existing_id: existing.id
        });
        continue;
      }

      let matched = null;
      let suggestions = [];
      if (dictionaryService) {
        const res = await dictionaryService.lookup(validWord);
        if (res.exact_matches.length > 0) {
          matched = res.exact_matches.find(m => m.identity_key === idKey) || res.exact_matches[0];
        } else {
          suggestions = res.suggestions || [];
        }
      }

      if (matched) {
        items.push({
          raw,
          word: matched.word || validWord,
          identity_key: idKey,
          status: 'matched',
          phonetic: matched.phonetic || '',
          phonetic_uk: matched.phonetic_uk || '',
          phonetic_us: matched.phonetic_us || '',
          pos: matched.pos || '',
          definition_zh: suppliedMeaning || matched.definition_zh || '',
          definition_en: matched.definition_en || ''
        });
      } else {
        items.push({
          raw,
          word: validWord,
          identity_key: idKey,
          status: 'manual',
          phonetic: '',
          phonetic_uk: '',
          phonetic_us: '',
          pos: '',
          definition_zh: suppliedMeaning || '',
          definition_en: '',
          suggestions
        });
      }
    }

    return { items };
  }

  batchImport(childId, { items, textbook, unit, categories } = {}, { role } = {}) {
    this.ensureChildExists(childId);
    if (!Array.isArray(items) || !items.length) {
      throw { status: 400, message: '请提供要导入的单词列表' };
    }
    if (items.length > MAX_BATCH_WORDS) {
      throw { status: 400, message: `单次最多导入 ${MAX_BATCH_WORDS} 个单词` };
    }

    // Validate the entire request before inserting, including per-word overrides.
    checkMetadataPermission({ textbook, unit }, role);
    for (const item of items) checkMetadataPermission(item, role);

    const defaultTextbook = normalizeMetaText(textbook);
    const defaultUnit = normalizeMetaText(unit);
    const defaultCategories = categories !== undefined ? normalizeEnglishCategories(categories) : [];

    const existingStmt = this.db.prepare('SELECT id FROM english_words WHERE child_id = ? AND identity_key = ?');
    const insertStmt = this.db.prepare(`
      INSERT INTO english_words (
        id, child_id, word, identity_key, canonical_key,
        phonetic, phonetic_uk, phonetic_us, pos, definition_zh, definition_en,
        textbook, unit, note, categories, is_mastered, created_at, mastered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)
    `);

    const added = [];
    const skipped = [];

    const run = this.db.transaction(() => {
      for (const item of items) {
        const cleanWord = validateEnglishWord(item.word);
        const idKey = identityKey(cleanWord);
        const canKey = canonicalKey(cleanWord);
        if (existingStmt.get(childId, idKey)) {
          skipped.push(cleanWord);
          continue;
        }
        const id = generateId();
        const createdAt = new Date().toISOString();
        const cleanUk = normalizeOptionalText(item.phonetic_uk, 80);
        const cleanUs = normalizeOptionalText(item.phonetic_us, 80);
        const cleanPhonetic = normalizeOptionalText(item.phonetic, 80) || cleanUk || cleanUs || null;
        const cats = item.categories !== undefined ? normalizeEnglishCategories(item.categories) : defaultCategories;

        insertStmt.run(
          id,
          childId,
          cleanWord,
          idKey,
          canKey,
          cleanPhonetic,
          cleanUk,
          cleanUs,
          normalizeOptionalText(item.pos, 60),
          normalizeOptionalText(item.definition_zh, 400),
          normalizeOptionalText(item.definition_en, 400),
          normalizeMetaText(item.textbook) ?? defaultTextbook,
          normalizeMetaText(item.unit) ?? defaultUnit,
          normalizeOptionalText(item.note, 300),
          JSON.stringify(cats),
          createdAt
        );
        added.push(this.getWord(id));
      }
    });

    run();
    return { added, skipped };
  }

  deleteWord(id, { role } = {}) {
    const existing = this.getWord(id);
    if (!existing) {
      throw { status: 404, message: '该单词不存在，可能已被移出，请刷新后重试' };
    }
    if (role !== 'parent' && existing.categories.length) {
      throw { status: 403, message: '这个单词有分类标记，需要家长移出' };
    }
    this.db.prepare('DELETE FROM english_words WHERE id = ?').run(id);
    return { success: true, id };
  }
}

module.exports = EnglishWordsService;
module.exports.ENGLISH_CATEGORIES = ENGLISH_CATEGORIES;
