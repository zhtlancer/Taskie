const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');

const { identityKey, canonicalKey } = require('../../utils/english-word');
const { parseBglFile, summarizeBglEntries } = require('./bgl-parser');
const {
  parseDictzipHeader,
  readDslSlice,
  scanDslEntries,
  extractDslSummary,
  parseDslArticleToAst
} = require('./dsl-parser');
const {
  scanZipCentralDirectory,
  readZipEntry,
  unwrapMediaResource
} = require('./zip64-reader');

const INDEX_VERSION = 2;
const DICT_LABELS = {
  bgl: '巴比伦英汉词典',
  oald8: '牛津高阶英英词典 (OALD8)',
  mw11: '韦氏大学词典 (MW 11)'
};

function findFirstMatch(dir, matcher, depth = 0) {
  if (!dir || !fs.existsSync(dir)) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && matcher(entry.name)) return full;
    if (entry.isDirectory() && depth < 1) {
      const nested = findFirstMatch(full, matcher, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function discoverSources(dictDir) {
  if (!dictDir || !fs.existsSync(dictDir)) return {};
  const sources = {};

  const bglPath = findFirstMatch(dictDir, name => /Babylon_English_Chinese.*\.BGL$/i.test(name) || /^test-bgl\.BGL$/i.test(name));
  if (bglPath) sources.bgl = { dictId: 'bgl', name: DICT_LABELS.bgl, filePath: bglPath, zipPath: null };

  const oaldDsl = findFirstMatch(dictDir, name => (
    /Oxford_Advanced_Learners_Dictionary\.dsl(?:\.dz)?$/i.test(name) || /^test-oald8\.dsl(?:\.dz)?$/i.test(name)
  ) && !/_abrv\.dsl/i.test(name));
  if (oaldDsl) {
    const oaldZip = findFirstMatch(path.dirname(oaldDsl), name => /Oxford_Advanced_Learners_Dictionary\.dsl\.files\.zip$/i.test(name) || /^test-oald8\.dsl\.files\.zip$/i.test(name), 0);
    sources.oald8 = { dictId: 'oald8', name: DICT_LABELS.oald8, filePath: oaldDsl, zipPath: oaldZip };
  }

  const mwDsl = findFirstMatch(dictDir, name => /MWCollegiate11\.dsl(?:\.dz)?$/i.test(name) || /^test-mw11\.dsl(?:\.dz)?$/i.test(name));
  if (mwDsl) {
    const mwZip = findFirstMatch(path.dirname(mwDsl), name => /MWCollegiate11\.dsl\.files\.zip$/i.test(name) || /^test-mw11\.dsl\.files\.zip$/i.test(name), 0);
    sources.mw11 = { dictId: 'mw11', name: DICT_LABELS.mw11, filePath: mwDsl, zipPath: mwZip };
  }

  return sources;
}

function fingerprintSources(sources) {
  const result = {};
  for (const [id, src] of Object.entries(sources)) {
    const stat = fs.statSync(src.filePath);
    const zipStat = src.zipPath && fs.existsSync(src.zipPath) ? fs.statSync(src.zipPath) : null;
    result[id] = {
      ...src,
      fileSize: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
      zipSize: zipStat ? zipStat.size : 0,
      zipMtimeMs: zipStat ? Math.trunc(zipStat.mtimeMs) : 0
    };
  }
  return result;
}

function sourceVersion(source) {
  return createHash('sha256').update(JSON.stringify([
    INDEX_VERSION, source.filePath, source.fileSize, source.mtimeMs,
    source.zipPath, source.zipSize, source.zipMtimeMs
  ])).digest('hex');
}

function audioUrl(dictId, file, source) {
  return `/api/dictionary/audio/${encodeURIComponent(dictId)}/${encodeURIComponent(file)}?v=${sourceVersion(source)}`;
}

class DictionaryService {
  constructor(opts = {}) {
    this.dictDir = opts.dictDir ?? null;
    this.cacheDir = opts.cacheDir ?? null;
    this.indexPath = this.cacheDir ? path.join(this.cacheDir, 'dict_index.sqlite') : null;
    this.audioCacheDir = this.cacheDir ? path.join(this.cacheDir, 'audio') : null;
    this.maxAudioCacheBytes = opts.maxAudioCacheBytes ?? (128 * 1024 * 1024);
    this.maxAudioCacheFiles = opts.maxAudioCacheFiles ?? 4000;
    this.autoBuild = opts.autoBuild !== false;
    this.indexDb = null;
    this.dslHeaders = new Map();
    this.buildPromise = null;
  }

  close() {
    if (this.indexDb) {
      try { this.indexDb.close(); } catch {}
      this.indexDb = null;
    }
    this.dslHeaders.clear();
  }

  getSources() {
    if (!this.dictDir || !fs.existsSync(this.dictDir)) return {};
    return fingerprintSources(discoverSources(this.dictDir));
  }

  status() {
    const sources = this.getSources();
    const sourceList = Object.values(sources).map(s => ({
      dict_id: s.dictId,
      name: s.name,
      has_media: Boolean(s.zipPath)
    }));
    if (!sourceList.length) {
      return {
        available: false,
        index_ready: false,
        dictionaries: [],
        reason: '未配置或未发现本地离线词典文件，可手动填写释义添加单词'
      };
    }
    const ready = this.isIndexCurrent(sources);
    return {
      available: true,
      index_ready: ready,
      indexing: Boolean(this.buildPromise),
      dictionaries: sourceList,
      reason: ready ? null : '正在准备或等待构建词典索引'
    };
  }

  isIndexCurrent(sources = this.getSources()) {
    const ids = Object.keys(sources);
    if (!ids.length || !this.indexPath || !fs.existsSync(this.indexPath)) return false;
    try {
      const db = this.openIndexDb();
      if (!db) return false;
      const version = db.pragma('user_version', { simple: true });
      if (version !== INDEX_VERSION) return false;
      const rows = db.prepare('SELECT dict_id, file_path, zip_path, file_size, mtime_ms, zip_size, zip_mtime_ms FROM dict_sources').all();
      if (rows.length !== ids.length) return false;
      const byId = new Map(rows.map(r => [r.dict_id, r]));
      for (const id of ids) {
        const s = sources[id];
        const row = byId.get(id);
        if (!row) return false;
        if (row.file_path !== s.filePath || (row.zip_path || null) !== (s.zipPath || null)) return false;
        if (row.file_size !== s.fileSize || row.mtime_ms !== s.mtimeMs) return false;
        if (row.zip_size !== s.zipSize || row.zip_mtime_ms !== s.zipMtimeMs) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  openIndexDb() {
    if (this.indexDb) return this.indexDb;
    if (!this.indexPath || !fs.existsSync(this.indexPath)) return null;
    this.indexDb = new Database(this.indexPath, { readonly: true });
    return this.indexDb;
  }

  async ensureIndex() {
    const sources = this.getSources();
    if (!Object.keys(sources).length) return null;
    if (this.isIndexCurrent(sources)) return this.openIndexDb();
    if (!this.autoBuild) return null;
    await this.rebuildIndex();
    return this.openIndexDb();
  }

  async rebuildIndex() {
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = (async () => {
      const sources = this.getSources();
      if (!Object.keys(sources).length) {
        return { built: false, reason: '未发现词典文件' };
      }
      if (!this.indexPath) {
        throw new Error('Dictionary cacheDir is not configured');
      }
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const tmpPath = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
      this.close();

      const db = new Database(tmpPath);
      try {
        db.pragma('journal_mode = OFF');
        db.pragma('synchronous = OFF');
        db.pragma('temp_store = MEMORY');
        db.exec(`
          CREATE TABLE dict_sources (
            dict_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            zip_path TEXT,
            file_size INTEGER NOT NULL,
            mtime_ms INTEGER NOT NULL,
            zip_size INTEGER NOT NULL,
            zip_mtime_ms INTEGER NOT NULL,
            entry_count INTEGER NOT NULL DEFAULT 0,
            media_count INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE bgl_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            headword TEXT NOT NULL,
            pos TEXT,
            phonetic TEXT,
            definition TEXT NOT NULL,
            inflections TEXT,
            entry_order INTEGER NOT NULL DEFAULT 0
          );
          CREATE TABLE dsl_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dict_id TEXT NOT NULL,
            headword TEXT NOT NULL,
            body_offset INTEGER NOT NULL,
            body_length INTEGER NOT NULL
          );
          CREATE TABLE headwords (
            headword_exact TEXT NOT NULL,
            headword_ci TEXT NOT NULL,
            dict_id TEXT NOT NULL,
            ref_id INTEGER NOT NULL
          );
          CREATE TABLE inflections (
            form_ci TEXT NOT NULL,
            base_exact TEXT NOT NULL,
            base_ci TEXT NOT NULL
          );
          CREATE TABLE media_files (
            dict_id TEXT NOT NULL,
            filename_ci TEXT NOT NULL,
            filename TEXT NOT NULL,
            method INTEGER NOT NULL,
            comp_size INTEGER NOT NULL,
            uncomp_size INTEGER NOT NULL,
            local_offset INTEGER NOT NULL,
            PRIMARY KEY (dict_id, filename_ci)
          );
        `);

        const insertBgl = db.prepare('INSERT INTO bgl_entries (headword, pos, phonetic, definition, inflections, entry_order) VALUES (?, ?, ?, ?, ?, ?)');
        const insertDsl = db.prepare('INSERT INTO dsl_entries (dict_id, headword, body_offset, body_length) VALUES (?, ?, ?, ?)');
        const insertHw = db.prepare('INSERT INTO headwords (headword_exact, headword_ci, dict_id, ref_id) VALUES (?, ?, ?, ?)');
        const insertInfl = db.prepare('INSERT INTO inflections (form_ci, base_exact, base_ci) VALUES (?, ?, ?)');
        const insertMedia = db.prepare('INSERT OR IGNORE INTO media_files (dict_id, filename_ci, filename, method, comp_size, uncomp_size, local_offset) VALUES (?, ?, ?, ?, ?, ?, ?)');
        const insertSrc = db.prepare('INSERT INTO dict_sources (dict_id, name, file_path, zip_path, file_size, mtime_ms, zip_size, zip_mtime_ms, entry_count, media_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');

        const runBuild = db.transaction(() => {
          if (sources.bgl) {
            const s = sources.bgl;
            let entryCount = 0;
            parseBglFile(s.filePath, entry => {
              const exact = identityKey(entry.headword);
              const ci = canonicalKey(entry.headword);
              if (!exact) return;
              const info = insertBgl.run(
                exact,
                entry.pos || null,
                entry.phonetic || null,
                entry.definition,
                entry.inflections.length ? JSON.stringify(entry.inflections) : null,
                entry.order
              );
              insertHw.run(exact, ci, 'bgl', Number(info.lastInsertRowid));
              for (const form of entry.inflections) {
                const formCi = canonicalKey(form);
                if (formCi && formCi !== ci) insertInfl.run(formCi, exact, ci);
              }
              entryCount += 1;
            });
            insertSrc.run('bgl', s.name, s.filePath, null, s.fileSize, s.mtimeMs, s.zipSize, s.zipMtimeMs, entryCount, 0);
          }

          for (const dictId of ['oald8', 'mw11']) {
            const s = sources[dictId];
            if (!s) continue;
            let entryCount = 0;
            scanDslEntries(s.filePath, entry => {
              const primaryHw = identityKey(entry.headwords[0] || '');
              if (!primaryHw) return;
              const info = insertDsl.run(dictId, primaryHw, entry.bodyOffset, entry.bodyLength);
              const refId = Number(info.lastInsertRowid);
              const seenHw = new Set();
              for (const rawHw of entry.headwords) {
                const exact = identityKey(rawHw);
                if (!exact || seenHw.has(exact)) continue;
                seenHw.add(exact);
                insertHw.run(exact, canonicalKey(exact), dictId, refId);
              }
              entryCount += 1;
            });

            let mediaCount = 0;
            if (s.zipPath && fs.existsSync(s.zipPath)) {
              scanZipCentralDirectory(s.zipPath, item => {
                const name = path.basename(item.filename);
                insertMedia.run(dictId, name.toLowerCase(), name, item.method, item.compSize, item.uncompSize, item.localHeaderOffset);
                mediaCount += 1;
              });
            }
            insertSrc.run(dictId, s.name, s.filePath, s.zipPath || null, s.fileSize, s.mtimeMs, s.zipSize, s.zipMtimeMs, entryCount, mediaCount);
          }

          db.exec(`
            CREATE INDEX idx_hw_exact ON headwords(headword_exact);
            CREATE INDEX idx_hw_ci ON headwords(headword_ci);
            CREATE INDEX idx_infl_form ON inflections(form_ci);
          `);
          db.pragma(`user_version = ${INDEX_VERSION}`);
        });

        runBuild();
        db.close();
        fs.renameSync(tmpPath, this.indexPath);
      } catch (err) {
        try { db.close(); } catch {}
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
        throw err;
      }

      const statRows = this.openIndexDb().prepare('SELECT dict_id, entry_count, media_count FROM dict_sources').all();
      return { built: true, sources: statRows };
    })();

    try {
      return await this.buildPromise;
    } finally {
      this.buildPromise = null;
    }
  }

  getDslHeader(dictId, filePath) {
    if (!this.dslHeaders.has(dictId)) {
      this.dslHeaders.set(dictId, parseDictzipHeader(filePath));
    }
    return this.dslHeaders.get(dictId);
  }

  loadGroupDetails(db, sources, headwordExact) {
    const hwRows = db.prepare('SELECT dict_id, ref_id FROM headwords WHERE headword_exact = ?').all(headwordExact);
    if (!hwRows.length) return null;

    const bglIds = [];
    const dslByDict = { oald8: [], mw11: [] };
    for (const row of hwRows) {
      if (row.dict_id === 'bgl') bglIds.push(row.ref_id);
      else if (dslByDict[row.dict_id]) dslByDict[row.dict_id].push(row.ref_id);
    }

    const bglRows = bglIds.length
      ? db.prepare(`SELECT * FROM bgl_entries WHERE id IN (${bglIds.map(() => '?').join(',')}) ORDER BY entry_order`).all(...bglIds)
      : [];

    const dslSummaries = {};
    const audio = [];
    const audioKeys = new Set();
    const forms = [];
    const posList = [];

    for (const dictId of ['oald8', 'mw11']) {
      const ids = dslByDict[dictId];
      if (!ids.length || !sources[dictId]) continue;
      const rows = db.prepare(`SELECT id, headword, body_offset, body_length FROM dsl_entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      const header = this.getDslHeader(dictId, sources[dictId].filePath);
      dslSummaries[dictId] = [];
      for (const r of rows) {
        const rawBody = readDslSlice(sources[dictId].filePath, r.body_offset, r.body_length, header);
        const sum = extractDslSummary(rawBody, dictId);
        dslSummaries[dictId].push(sum);
        for (const p of sum.pos_list) if (!posList.includes(p)) posList.push(p);
        for (const f of sum.forms) if (!forms.includes(f)) forms.push(f);
        for (const a of sum.audio) {
          const key = `${a.dict_id}:${a.file.toLowerCase()}`;
          if (audioKeys.has(key)) continue;
          audioKeys.add(key);
          audio.push({
            id: key,
            dict_id: a.dict_id,
            file: a.file,
            accent: a.accent,
            label: a.accent === 'uk' ? '英音' : a.accent === 'us' ? '美音' : '朗读',
            url: audioUrl(a.dict_id, a.file, sources[a.dict_id])
          });
        }
      }
    }

    for (const r of bglRows) {
      if (r.pos && !posList.includes(r.pos)) posList.push(r.pos);
      if (r.inflections) {
        try {
          for (const f of JSON.parse(r.inflections)) {
            if (f && !forms.includes(f)) forms.push(f);
          }
        } catch {}
      }
    }

    const oaldFirst = dslSummaries.oald8?.[0] || {};
    const mwFirst = dslSummaries.mw11?.[0] || {};
    const bglFirstPhonetic = bglRows.find(r => r.phonetic)?.phonetic || null;

    const phoneticUk = oaldFirst.phonetic_uk || null;
    const phoneticUs = oaldFirst.phonetic_us || null;
    const phoneticFallback = phoneticUk || phoneticUs || mwFirst.phonetic || bglFirstPhonetic || null;

    const shortZh = summarizeBglEntries(bglRows);
    const shortEn = oaldFirst.short_en || mwFirst.short_en || '';

    // Keep dictionary senses separate; definitions from different dictionaries are not translations.
    const senses = [];
    const addSense = (dictId, pos, zh, en) => {
      if (senses.length >= 30) return;
      senses.push({ id: `dict-${dictId}-${senses.length}`, pos: pos ? pos.slice(0, 60) : null,
        definition_zh: zh ? zh.slice(0, 400) : null, definition_en: en ? en.slice(0, 400) : null,
        example: null, source: { dict_id: dictId, name: DICT_LABELS[dictId], headword: headwordExact } });
    };
    for (const row of bglRows) {
      for (const definition of String(row.definition || '').split('#').map(value => value.trim()).filter(Boolean)) {
        addSense('bgl', row.pos, definition, null);
      }
    }
    for (const dictId of ['oald8', 'mw11']) {
      for (const summary of dslSummaries[dictId] || []) {
        for (const definition of summary.definitions || []) addSense(dictId, summary.pos_list.join(' / '), null, definition);
      }
    }

    const dictionaries = [];
    if (dslSummaries.oald8?.length) dictionaries.push({ dict_id: 'oald8', name: DICT_LABELS.oald8, count: dslSummaries.oald8.length });
    if (dslSummaries.mw11?.length) dictionaries.push({ dict_id: 'mw11', name: DICT_LABELS.mw11, count: dslSummaries.mw11.length });
    if (bglRows.length) dictionaries.push({ dict_id: 'bgl', name: DICT_LABELS.bgl, count: bglRows.length });

    return {
      word: headwordExact,
      identity_key: identityKey(headwordExact),
      canonical_key: canonicalKey(headwordExact),
      phonetic: phoneticFallback,
      phonetic_uk: phoneticUk,
      phonetic_us: phoneticUs,
      pos: posList.join(' / ') || null,
      pos_list: posList,
      senses,
      definition_zh: shortZh,
      definition_en: shortEn,
      forms: forms.slice(0, 12),
      audio,
      dictionaries
    };
  }

  async lookup(rawQuery) {
    const queryExact = identityKey(rawQuery);
    const queryCi = canonicalKey(rawQuery);
    if (!queryExact) {
      return {
        available: true,
        index_ready: false,
        query: '',
        exact_matches: [],
        suggestions: []
      };
    }

    const sources = this.getSources();
    if (!Object.keys(sources).length) {
      return {
        available: false,
        index_ready: false,
        query: queryExact,
        exact_matches: [],
        suggestions: [],
        reason: '未配置或未发现本地离线词典文件，可手动填写释义添加单词'
      };
    }

    const db = await this.ensureIndex();
    if (!db) {
      return {
        available: true,
        index_ready: false,
        query: queryExact,
        exact_matches: [],
        suggestions: [],
        reason: '词典索引尚未构建'
      };
    }

    const variantRows = db.prepare('SELECT DISTINCT headword_exact FROM headwords WHERE headword_ci = ?').all(queryCi);
    // Keep case-exact match first ("May" before "may" when querying "May"), then remaining case variants.
    const sortedVariants = variantRows
      .map(r => r.headword_exact)
      .sort((a, b) => {
        if (a === queryExact && b !== queryExact) return -1;
        if (b === queryExact && a !== queryExact) return 1;
        return a.localeCompare(b);
      });

    const exactMatches = [];
    for (const hw of sortedVariants.slice(0, 6)) {
      const detail = this.loadGroupDetails(db, sources, hw);
      if (detail) exactMatches.push(detail);
    }

    const suggestions = [];
    const seenSug = new Set(sortedVariants.map(v => v.toLowerCase()));
    const inflRows = db.prepare('SELECT DISTINCT base_exact FROM inflections WHERE form_ci = ? LIMIT 8').all(queryCi);
    for (const r of inflRows) {
      if (!seenSug.has(r.base_exact.toLowerCase())) {
        seenSug.add(r.base_exact.toLowerCase());
        suggestions.push({ word: r.base_exact, reason: '原形词' });
      }
    }

    if (queryCi.length >= 2 && exactMatches.length === 0) {
      const upperBound = `${queryCi}\uffff`;
      const prefixRows = db.prepare(`
        SELECT DISTINCT headword_exact, headword_ci
        FROM headwords
        WHERE headword_ci >= ? AND headword_ci < ?
        ORDER BY length(headword_ci), headword_ci
        LIMIT 12
      `).all(queryCi, upperBound);
      for (const r of prefixRows) {
        if (!seenSug.has(r.headword_ci)) {
          seenSug.add(r.headword_ci);
          suggestions.push({ word: r.headword_exact, reason: '相近词条' });
        }
      }
    }

    return {
      available: true,
      index_ready: true,
      query: queryExact,
      exact_matches: exactMatches,
      suggestions: suggestions.slice(0, 12)
    };
  }

  async suggest(rawPrefix, limit = 10) {
    const prefix = canonicalKey(rawPrefix);
    if (!prefix) return { available: Boolean(this.indexDb || Object.keys(this.getSources()).length), items: [] };
    const db = await this.ensureIndex();
    if (!db) return { available: false, items: [] };
    const cap = Math.max(1, Math.min(20, Number(limit) || 10));
    const rows = db.prepare(`
      SELECT DISTINCT headword_exact, headword_ci
      FROM headwords
      WHERE headword_ci >= ? AND headword_ci < ?
      ORDER BY length(headword_ci), headword_ci
      LIMIT ?
    `).all(prefix, `${prefix}\uffff`, cap);
    return {
      available: true,
      items: rows.map(r => r.headword_exact)
    };
  }

  async getArticles(rawWord, requestedDictId = 'all') {
    const wordExact = identityKey(rawWord);
    const wordCi = canonicalKey(rawWord);
    if (!wordExact) return { available: true, word: '', articles: [] };

    const sources = this.getSources();
    if (!Object.keys(sources).length) {
      return { available: false, word: wordExact, articles: [], reason: '未配置或未发现本地离线词典' };
    }
    const db = await this.ensureIndex();
    if (!db) {
      return { available: true, word: wordExact, articles: [], reason: '词典索引尚未构建' };
    }

    const exactRows = db.prepare('SELECT dict_id, ref_id, headword_exact FROM headwords WHERE headword_exact = ?').all(wordExact);
    const hwRows = exactRows.length
      ? exactRows
      : db.prepare('SELECT dict_id, ref_id, headword_exact FROM headwords WHERE headword_ci = ?').all(wordCi);

    const targetDicts = requestedDictId && requestedDictId !== 'all'
      ? [requestedDictId]
      : ['oald8', 'mw11', 'bgl'];

    const articles = [];
    for (const dictId of targetDicts) {
      const ids = hwRows.filter(r => r.dict_id === dictId).map(r => r.ref_id);
      if (!ids.length) continue;

      if (dictId === 'bgl') {
        const rows = db.prepare(`SELECT * FROM bgl_entries WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY entry_order`).all(...ids);
        articles.push({
          dict_id: 'bgl',
          name: DICT_LABELS.bgl,
          entries: rows.map(r => ({
            headword: r.headword,
            pos: r.pos,
            phonetic: r.phonetic,
            senses: String(r.definition || '').split('#').map(s => s.trim()).filter(Boolean),
            inflections: r.inflections ? JSON.parse(r.inflections) : []
          }))
        });
      } else if (sources[dictId]) {
        const rows = db.prepare(`SELECT headword, body_offset, body_length FROM dsl_entries WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
        const header = this.getDslHeader(dictId, sources[dictId].filePath);
        articles.push({
          dict_id: dictId,
          name: DICT_LABELS[dictId],
          entries: rows.map(r => {
            const rawBody = readDslSlice(sources[dictId].filePath, r.body_offset, r.body_length, header);
            return {
              headword: r.headword,
              blocks: parseDslArticleToAst(rawBody, dictId).map(block => ({
                ...block,
                nodes: block.nodes.map(node => node.type === 'audio'
                  ? { ...node, url: audioUrl(dictId, node.file, sources[dictId]) }
                  : node)
              }))
            };
          })
        });
      }
    }

    return {
      available: true,
      word: hwRows[0]?.headword_exact || wordExact,
      articles
    };
  }

  async getAudio(dictId, rawFilename) {
    if (dictId !== 'oald8' && dictId !== 'mw11') {
      throw { status: 400, message: '不支持的词典音频来源' };
    }
    const cleanName = path.basename(String(rawFilename || '')).toLowerCase();
    if (!cleanName || !/^[a-z0-9._-]+$/.test(cleanName)) {
      throw { status: 400, message: '音频文件名无效' };
    }

    const sources = this.getSources();
    const src = sources[dictId];
    if (!src || !src.zipPath || !fs.existsSync(src.zipPath)) {
      throw { status: 404, message: '词典发音包不可用' };
    }
    const db = await this.ensureIndex();
    if (!db) {
      throw { status: 503, message: '词典索引尚未就绪' };
    }

    const meta = db.prepare(`
      SELECT filename, method, comp_size, uncomp_size, local_offset
      FROM media_files
      WHERE dict_id = ? AND filename_ci = ?
    `).get(dictId, cleanName);
    if (!meta) {
      throw { status: 404, message: '发音文件不存在' };
    }

    const cacheKey = createHash('sha1').update(`${sourceVersion(src)}:${dictId}:${meta.filename}`).digest('hex');
    if (this.audioCacheDir) {
      for (const [ext, contentType] of [['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['ogg', 'audio/ogg']]) {
        const candidate = path.join(this.audioCacheDir, `${cacheKey}.${ext}`);
        if (fs.existsSync(candidate)) {
          const now = new Date();
          try { fs.utimesSync(candidate, now, now); } catch {}
          return { contentType, buffer: fs.readFileSync(candidate), cached: true };
        }
      }
    }

    const rawBytes = readZipEntry(src.zipPath, {
      filename: meta.filename,
      method: meta.method,
      compSize: meta.comp_size,
      uncompSize: meta.uncomp_size,
      localHeaderOffset: meta.local_offset
    });
    const decoded = unwrapMediaResource(meta.filename, rawBytes);

    if (this.audioCacheDir) {
      try {
        fs.mkdirSync(this.audioCacheDir, { recursive: true });
        const target = path.join(this.audioCacheDir, `${cacheKey}.${decoded.ext}`);
        const tmp = `${target}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, decoded.buffer);
        fs.renameSync(tmp, target);
        this.pruneAudioCache();
      } catch {}
    }

    return { contentType: decoded.contentType, buffer: decoded.buffer, cached: false };
  }

  pruneAudioCache() {
    if (!this.audioCacheDir || !fs.existsSync(this.audioCacheDir)) return;
    const files = fs.readdirSync(this.audioCacheDir)
      .filter(name => !name.endsWith('.tmp'))
      .map(name => {
        const full = path.join(this.audioCacheDir, name);
        const st = fs.statSync(full);
        return { full, size: st.size, mtimeMs: st.mtimeMs };
      });
    let totalBytes = files.reduce((s, f) => s + f.size, 0);
    let count = files.length;
    if (totalBytes <= this.maxAudioCacheBytes && count <= this.maxAudioCacheFiles) return;
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of files) {
      if (totalBytes <= this.maxAudioCacheBytes && count <= this.maxAudioCacheFiles) break;
      try {
        fs.unlinkSync(f.full);
        totalBytes -= f.size;
        count -= 1;
      } catch {}
    }
  }
}

module.exports = {
  DictionaryService,
  DICT_LABELS
};
