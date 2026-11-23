const { randomInt } = require('node:crypto');
const { generateId } = require('../utils/crypto');
const { formSubmission } = require('../utils/form-submission');
const { bookIds, ownedBooks } = require('../utils/word-study-scope');
const { reading } = require('./character-imports.service');
const { normalizeAudioRefs } = require('../utils/english-audio');
const { compareSpellingAnswer, normalizeEnglishCategories } = require('../utils/english-word');
const { CATEGORIES } = require('./characters.service');
const fail = (status, message) => ({ status, message });
const parse = (value) => JSON.parse(value || '[]');
const requireId = (id) => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw fail(400, '缺少有效的测试请求标识');
};
const publicItem = (row) => {
  const { source_books_json, ...item } = row;
  return {
    ...item,
    strict_case: Boolean(row.strict_case),
    source_books: parse(source_books_json),
    audio_refs: row.audio_refs === null ? null : parse(row.audio_refs),
  };
};
const publicTest = (row) => {
  const { book_ids_json, book_names_json, ...test } = row;
  return { ...test, book_ids: parse(book_ids_json), book_names: parse(book_names_json) };
};
class WordTestsService {
  constructor(db) {
    this.db = db;
  }
  child(childId, actor) {
    if (
      !actor ||
      !['parent', 'child'].includes(actor.role) ||
      (actor.role === 'child' && actor.child_id !== childId)
    )
      throw fail(403, '无权访问其他孩子的测试');
    if (!childId || !this.db.prepare('SELECT 1 FROM children WHERE id = ?').get(childId))
      throw fail(404, '孩子不存在');
  }
  row(id, actor) {
    const test = this.db.prepare('SELECT * FROM word_tests WHERE id = ?').get(id);
    if (!test) throw fail(404, '测试不存在，可能已被删除');
    this.child(test.child_id, actor);
    return test;
  }
  get(id, actor) {
    const test = this.row(id, actor);
    return {
      ...publicTest(test),
      items: this.db
        .prepare('SELECT * FROM word_test_items WHERE test_id = ? ORDER BY position')
        .all(id)
        .map(publicItem),
    };
  }
  list(query, actor) {
    this.child(query.child_id, actor);
    if (!['zh', 'en'].includes(query.language)) throw fail(400, '请选择测试语言');
    const size = Number(query.limit ?? 20);
    if (!Number.isSafeInteger(size) || size < 1 || size > 50) throw fail(400, '分页数量无效');
    let cursor;
    if (query.cursor) {
      try {
        if (typeof query.cursor !== 'string' || query.cursor.length > 1024) throw 0;
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url'));
        if (
          !Number.isFinite(Date.parse(cursor.date)) ||
          typeof cursor.id !== 'string' ||
          !cursor.id ||
          cursor.id.length > 100
        )
          throw 0;
      } catch {
        throw fail(400, '分页标识无效');
      }
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM word_tests WHERE child_id = ? AND language = ?
      ${cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(
        query.child_id,
        query.language,
        ...(cursor ? [cursor.date, cursor.date, cursor.id] : []),
        size + 1,
      );
    const more = rows.length > size,
      items = rows.slice(0, size),
      last = items.at(-1);
    return {
      items: items.map(publicTest),
      next_cursor: more
        ? Buffer.from(JSON.stringify({ date: last.created_at, id: last.id })).toString('base64url')
        : null,
    };
  }
  submission(kind, data, actor, childId, create) {
    requireId(data.request_id);
    return formSubmission(this.db, { body: data, user: actor }, kind, childId, create, (id) => {
      if (!this.db.prepare('SELECT 1 FROM word_tests WHERE id = ?').get(id)) return null;
      return this.get(id, actor);
    });
  }
  create(data, actor) {
    this.child(data.child_id, actor);
    const normalized = {
      child_id: data.child_id,
      language: data.language,
      skill: data.skill,
      book_ids: bookIds(data.book_ids),
      scope_filter: data.scope_filter ?? 'all',
      order_mode: data.order_mode ?? 'ordered',
      limit: data.limit ?? 200,
      request_id: data.request_id,
    };
    if (
      !['zh', 'en'].includes(normalized.language) ||
      !['recognize', 'write'].includes(normalized.skill) ||
      !['all', 'unmastered', 'error_prone'].includes(normalized.scope_filter) ||
      !['ordered', 'shuffle'].includes(normalized.order_mode) ||
      !normalized.book_ids.length ||
      !Number.isSafeInteger(normalized.limit) ||
      normalized.limit < 1 ||
      normalized.limit > 200
    )
      throw fail(400, '测试范围、方式或题量无效');
    return this.db.transaction(() =>
      this.submission('word-test-create', normalized, actor, data.child_id, () => {
        const books = ownedBooks(this.db, data.child_id, data.language, normalized.book_ids),
          items = new Map(),
          missing = new Set(),
          invalid = new Set();
        for (const book of books) {
          const zh = data.language === 'zh',
            col = zh ? 'character_id' : 'english_word_id';
          const rows = this.db
            .prepare(
              `SELECT w.*, i.pinyin_override FROM word_book_items i JOIN ${zh ? 'characters' : 'english_words'} w ON w.id = i.${col} WHERE i.book_id = ? ORDER BY i.position, i.id`,
            )
            .all(book.id);
          for (const row of rows) {
            if (
              (normalized.scope_filter === 'unmastered' && row.is_mastered) ||
              (normalized.scope_filter === 'error_prone' && !parse(row.categories).includes('error_prone'))
            )
              continue;
            let snapshot = {
              language: data.language,
              source_id: row.id,
              character_id: zh ? row.id : null,
              english_word_id: zh ? null : row.id,
              text: row.char || row.word,
              pinyin: null,
              phonetic: null,
              meaning_zh: null,
              meaning_en: null,
              strict_case: 0,
              audio_refs: null,
              source_books: [],
            };
            if (zh) {
              try {
                snapshot.pinyin = reading(row.char, row.pinyin_override || row.pinyin || '').pinyin;
              } catch {
                invalid.add(JSON.stringify([row.id, row.pinyin_override || row.pinyin]));
                continue;
              }
            } else {
              if (!row.definition_zh?.trim() && !row.definition_en?.trim()) {
                missing.add(row.id);
                continue;
              }
              const selected = parse(row.senses).find((sense) => sense.id === row.primary_sense_id);
              const refs =
                selected?.audio_refs === undefined ? null : normalizeAudioRefs(selected.audio_refs);
              if (refs?.some((ref) => ref.headword !== row.word))
                throw fail(400, '词条发音来源与当前单词不一致，请先核对');
              Object.assign(snapshot, {
                phonetic: refs?.[0]?.phonetic || row.phonetic || row.phonetic_uk || row.phonetic_us || null,
                meaning_zh: row.definition_zh,
                meaning_en: row.definition_en,
                strict_case: +Boolean(row.strict_case),
                audio_refs: refs,
              });
            }
            const key = JSON.stringify([row.id, snapshot.pinyin]);
            if (!items.has(key)) items.set(key, snapshot);
            items.get(key).source_books.push({ id: book.id, name: book.name });
          }
        }
        const candidates = [...items.values()];
        if (normalized.order_mode === 'shuffle')
          for (let i = candidates.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
          }
        if (!candidates.length) throw fail(400, '当前范围没有可用题目，请检查词本、拼音和英语释义');
        const test = this.insert(
          {
            ...normalized,
            books: books.map(({ id, name }) => ({ id, name })),
            created_by: actor.role,
            title: `${data.language === 'zh' ? '字词' : '英语'}${data.skill === 'write' ? (data.language === 'en' ? '拼写' : '书写') : '认读'}自测 · ${books[0].name}${books.length > 1 ? `等 ${books.length} 本` : ''}`,
            excluded_no_definition: missing.size,
            excluded_invalid_pinyin: invalid.size,
          },
          candidates.slice(0, normalized.limit),
        );
        return this.get(test.id, actor);
      }),
    )();
  }
  insert(data, items) {
    const id = generateId(),
      now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO word_tests(id,child_id,language,skill,title,book_ids_json,book_names_json,scope_filter,order_mode,total_count,created_by,parent_test_id,created_at,excluded_no_definition,excluded_invalid_pinyin)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        data.child_id,
        data.language,
        data.skill,
        Array.from(data.title).slice(0, 200).join(''),
        JSON.stringify(data.books.map((book) => book.id)),
        JSON.stringify(data.books.map((book) => book.name)),
        data.scope_filter,
        data.order_mode,
        items.length,
        data.created_by,
        data.parent_test_id || null,
        now,
        data.excluded_no_definition || 0,
        data.excluded_invalid_pinyin || 0,
      );
    const add = this.db
      .prepare(`INSERT INTO word_test_items(id,test_id,language,position,source_id,character_id,english_word_id,text,pinyin,phonetic,meaning_zh,meaning_en,strict_case,audio_refs,source_books_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    items.forEach((item, position) =>
      add.run(
        generateId(),
        id,
        data.language,
        position,
        item.source_id,
        item.character_id,
        item.english_word_id,
        item.text,
        item.pinyin,
        item.phonetic,
        item.meaning_zh,
        item.meaning_en,
        +Boolean(item.strict_case),
        item.audio_refs === null ? null : JSON.stringify(item.audio_refs),
        JSON.stringify(item.source_books),
      ),
    );
    return { id };
  }
  item(testId, itemId, actor) {
    const test = this.row(testId, actor),
      item = this.db
        .prepare('SELECT * FROM word_test_items WHERE test_id = ? AND id = ?')
        .get(testId, itemId);
    if (!item) throw fail(404, '题目不属于本次测试');
    return { test, item };
  }
  answerReply(testId, itemId, actor) {
    const { test, item } = this.item(testId, itemId, actor);
    return { id: item.id, child_id: test.child_id, item: publicItem(item), test: publicTest(test) };
  }
  answer(testId, itemId, data, actor) {
    const { test } = this.item(testId, itemId, actor);
    requireId(data.request_id);
    const spelling = test.language === 'en' && test.skill === 'write';
    if (
      spelling
        ? typeof data.typed_answer !== 'string' || data.typed_answer.length > 1000
        : !['correct', 'wrong'].includes(data.result)
    )
      throw fail(400, '答题内容无效或过长');
    const body = {
      request_id: data.request_id,
      test_id: testId,
      item_id: itemId,
      ...(spelling ? { typed_answer: data.typed_answer } : { result: data.result }),
    };
    return this.db.transaction(() =>
      formSubmission(
        this.db,
        { body, user: actor },
        'word-test-answer',
        test.child_id,
        () => {
          const current = this.item(testId, itemId, actor);
          if (current.test.status === 'completed' || current.item.result !== null)
            throw fail(409, '本题已确认，首次答案不可修改，请读取已保存结果');
          const result = spelling
            ? compareSpellingAnswer(data.typed_answer, current.item.text, Boolean(current.item.strict_case))
                .is_correct
              ? 'correct'
              : 'wrong'
            : data.result;
          const now = new Date().toISOString();
          this.db
            .prepare(
              'UPDATE word_test_items SET typed_answer=?,result=?,answer_request_id=?,answered_by=?,answered_at=? WHERE id=?',
            )
            .run(spelling ? data.typed_answer : null, result, data.request_id, actor.role, now, itemId);
          const counts = this.db
            .prepare(
              "SELECT COUNT(*) answered,COALESCE(SUM(result='correct'),0) correct FROM word_test_items WHERE test_id=? AND result IS NOT NULL",
            )
            .get(testId);
          const completed = counts.answered === current.test.total_count;
          this.db
            .prepare(
              'UPDATE word_tests SET answered_count=?,correct_count=?,status=?,completed_at=? WHERE id=?',
            )
            .run(
              counts.answered,
              counts.correct,
              completed ? 'completed' : 'in_progress',
              completed ? now : null,
              testId,
            );
          return this.answerReply(testId, itemId, actor);
        },
        (id) => {
          const item = this.db.prepare('SELECT test_id FROM word_test_items WHERE id=?').get(id);
          return item ? this.answerReply(item.test_id, id, actor) : null;
        },
      ),
    )();
  }
  retryWrong(id, data, actor) {
    const source = this.get(id, actor);
    requireId(data.request_id);
    return this.db.transaction(() =>
      this.submission(
        'word-test-retry',
        { request_id: data.request_id, parent_test_id: id },
        actor,
        source.child_id,
        () => {
          if (source.status !== 'completed') throw fail(409, '请先完成本次测试');
          const wrong = source.items.filter((item) => item.result === 'wrong');
          if (!wrong.length) throw fail(400, '没有错题，无需复测');
          const created = this.insert(
            {
              ...source,
              parent_test_id: id,
              created_by: actor.role,
              title: `错题复测 · ${source.title}`,
              order_mode: 'ordered',
              books: source.book_ids.map((id, i) => ({ id, name: source.book_names[i] })),
              excluded_no_definition: 0,
              excluded_invalid_pinyin: 0,
            },
            wrong,
          );
          return this.get(created.id, actor);
        },
      ),
    )();
  }
  markWrong(id, actor) {
    return this.db.transaction(() => {
      const test = this.get(id, actor);
      if (test.status !== 'completed') throw fail(409, '请先完成本次测试');
      const sources = new Map();
      for (const item of test.items.filter((item) => item.result === 'wrong'))
        sources.set(
          item.source_id,
          Boolean(sources.get(item.source_id) || item.character_id || item.english_word_id),
        );
      const result = { added: 0, already: 0, deleted: 0 };
      for (const [sourceId, live] of sources) {
        if (!live) {
          result.deleted++;
          continue;
        }
        const table = test.language === 'zh' ? 'characters' : 'english_words',
          row = this.db.prepare(`SELECT child_id,categories FROM ${table} WHERE id=?`).get(sourceId);
        if (!row) {
          result.deleted++;
          continue;
        }
        if (row.child_id !== test.child_id) throw fail(403, '不能标记其他孩子的词条');
        const categories = parse(row.categories);
        if (categories.includes('error_prone')) {
          result.already++;
          continue;
        }
        const next =
          test.language === 'en'
            ? normalizeEnglishCategories([...categories, 'error_prone'])
            : CATEGORIES.filter((key) => key === 'error_prone' || categories.includes(key));
        this.db
          .prepare(
            `UPDATE ${table} SET categories=?${test.language === 'en' ? ', version=version+1' : ''} WHERE id=?`,
          )
          .run(JSON.stringify(next), sourceId);
        result.added++;
      }
      return result;
    })();
  }
}
module.exports = WordTestsService;
