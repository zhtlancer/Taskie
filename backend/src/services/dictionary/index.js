const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const Database = require('better-sqlite3');
const { dictionaryFailure } = require('./issues');
const { MAX_IMAGE_BYTES, IMAGE_NAME, imageContentType } = require('./image-resource');
const { audioUrl: referenceAudioUrl } = require('../../utils/english-audio');

const { identityKey, canonicalKey } = require('../../utils/english-word');
const { summarizeBglEntries } = require('./bgl-parser');
const {
  parseDictzipHeader,
  readDslSlice,
  extractDslSummary,
  extractDslSections,
  parseDslArticleToAst
} = require('./dsl-parser');
const {
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
    this.buildWorker = null;
    this.buildProgress = null;
    this.lastBuildError = null;
    this.indexStamp = null;
    this.closed = false;
  }

  releaseIndex() {
    if (this.indexDb) {
      try { this.indexDb.close(); } catch {}
      this.indexDb = null;
    }
    this.dslHeaders.clear();
    this.indexStamp = null;
  }

  close() {
    this.closed = true;
    this.releaseIndex();
    if (!this.closePromise) this.closePromise = (async () => {
      await this.buildWorker?.terminate();
      await this.buildPromise?.catch(() => {});
    })();
    return this.closePromise;
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
        indexing: Boolean(this.buildPromise),
        progress: this.buildProgress,
        last_error: this.lastBuildError,
        dictionaries: [],
        reason: '未配置或未发现本地离线词典文件，可手动填写释义添加单词'
      };
    }
    const ready = this.isIndexCurrent(sources);
    return {
      available: true,
      index_ready: ready,
      indexing: Boolean(this.buildPromise),
      progress: this.buildProgress,
      last_error: this.lastBuildError,
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
    if (this.closed) return null;
    if (!this.indexPath || !fs.existsSync(this.indexPath)) {
      this.releaseIndex();
      return null;
    }
    // A separate offline indexer may have atomically replaced the cache file.
    const stat = fs.statSync(this.indexPath);
    const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    if (this.indexDb && stamp !== this.indexStamp) this.releaseIndex();
    if (this.indexDb) return this.indexDb;
    this.indexDb = new Database(this.indexPath, { readonly: true });
    this.indexStamp = stamp;
    return this.indexDb;
  }

  async ensureIndex() {
    if (this.closed) throw Object.assign(new Error('Dictionary service is closed'), { code: 'DICTIONARY_CLOSED' });
    let sources = this.getSources();
    if (!Object.keys(sources).length) return null;
    if (this.isIndexCurrent(sources)) return { db: this.openIndexDb(), sources };
    if (!this.autoBuild) return null;
    await this.rebuildIndex();
    sources = this.getSources();
    if (this.closed) throw Object.assign(new Error('Dictionary service is closed'), { code: 'DICTIONARY_CLOSED' });
    if (!this.isIndexCurrent(sources)) throw Object.assign(new Error('Dictionary changed during indexing'), { code: 'DICTIONARY_CHANGED' });
    return { db: this.openIndexDb(), sources };
  }

  rebuildIndex() {
    if (this.buildPromise) return this.buildPromise;
    this.buildProgress = { phase: 'starting', processed: 0 };
    this.lastBuildError = null;
    // Defer setup until buildPromise is assigned, so even concurrent first lookups share one job.
    this.buildPromise = Promise.resolve().then(async () => {
      if (this.closed) throw Object.assign(new Error('Dictionary service is closed'), { code: 'DICTIONARY_CLOSED' });
      const sources = this.getSources();
      if (!Object.keys(sources).length) return { built: false, reason: '未发现词典文件' };
      if (!this.indexPath) throw new Error('Dictionary cacheDir is not configured');
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const tmpPath = `${this.indexPath}.${randomUUID()}.tmp`;
      let worker;
      try {
        const rows = await new Promise((resolve, reject) => {
          worker = new Worker(path.join(__dirname, 'index-worker.js'), {
            workerData: { sources, tmpPath, indexVersion: INDEX_VERSION }
          });
          this.buildWorker = worker;
          worker.on('message', message => {
            if (message.type === 'progress') this.buildProgress = message.progress;
            if (message.type === 'complete') resolve(message.sources);
            if (message.type === 'failed') reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
          });
          worker.once('error', reject);
          worker.once('exit', code => reject(Object.assign(new Error(`Dictionary index worker exited (${code})`), {
            code: this.closed ? 'DICTIONARY_CLOSED' : 'DICTIONARY_BUILD_FAILED'
          })));
        });
        await worker.terminate();
        if (this.closed) throw Object.assign(new Error('Dictionary service is closed'), { code: 'DICTIONARY_CLOSED' });
        if (JSON.stringify(this.getSources()) !== JSON.stringify(sources)) {
          throw Object.assign(new Error('Dictionary changed during indexing'), { code: 'DICTIONARY_CHANGED' });
        }
        // Keep the previous index open until a fully built, verified replacement is ready.
        this.releaseIndex();
        fs.renameSync(tmpPath, this.indexPath);
        return { built: true, sources: rows };
      } finally {
        // A terminated worker must stop writing before its private file is removed.
        await worker?.terminate();
        this.buildWorker = null;
        fs.rmSync(tmpPath, { force: true });
      }
    }).catch(error => {
      this.lastBuildError = dictionaryFailure(error);
      throw error;
    }).finally(() => {
      this.buildPromise = null;
      this.buildProgress = null;
    });
    return this.buildPromise;
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
    const pronunciations = [];
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
        const overall = extractDslSummary(rawBody, dictId);
        for (const f of overall.forms) if (!forms.includes(f)) forms.push(f);
        const sections = extractDslSections(rawBody, dictId);
        const meanings = sections.filter(section => section.summary.definitions.length);
        for (const section of meanings.length ? meanings : sections.filter(section => section.summary.audio.length).slice(0, 1)) {
          const sum = section.summary;
          const entryKey = createHash('sha256').update(`${dictId}:${headwordExact}:${section.raw}`).digest('hex');
          const refs = [];
          for (const a of sum.audio) {
            try {
              const decoded = this.readAudio(db, sources, dictId, a.file.toLowerCase());
              refs.push({ dict_id: dictId, file: a.file, accent: a.accent, headword: headwordExact,
                entry_key: entryKey, sha256: createHash('sha256').update(decoded.buffer).digest('hex'),
                phonetic: (a.accent === 'us' ? sum.phonetic_us : sum.phonetic_uk || sum.phonetic)?.slice(0, 80) || null });
            } catch { /* Missing or unsupported clips do not prevent reading the dictionary. */ }
          }
          sum.audio_refs = refs;
          dslSummaries[dictId].push(sum);
          for (const p of sum.pos_list) if (!posList.includes(p)) posList.push(p);
          if (refs.length && pronunciations.length < 24) pronunciations.push({ id: entryKey, dict_id: dictId,
            name: DICT_LABELS[dictId], pos: sum.pos_list.join(' / '), phonetic: sum.phonetic,
            description: sum.short_en, audio_refs: refs });
          for (const ref of refs) {
            const key = `${ref.dict_id}:${ref.file.toLowerCase()}`;
            if (audioKeys.has(key)) continue;
            audioKeys.add(key);
            audio.push({ ...ref, id: key, label: ref.accent === 'uk' ? '英音' : ref.accent === 'us' ? '美音' : ref.accent === 'mw' ? '韦氏朗读' : '朗读', url: referenceAudioUrl(ref) });
          }
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

    const oaldFirst = dslSummaries.oald8?.find(s => s.audio_refs.length || s.definitions.length) || {};
    const mwFirst = dslSummaries.mw11?.find(s => s.audio_refs.length || s.definitions.length) || {};
    const bglFirstPhonetic = bglRows.find(r => r.phonetic)?.phonetic || null;

    const phoneticUk = oaldFirst.phonetic_uk || null;
    const phoneticUs = oaldFirst.phonetic_us || null;
    const phoneticFallback = phoneticUk || phoneticUs || mwFirst.phonetic || bglFirstPhonetic || null;

    const shortZh = summarizeBglEntries(bglRows);
    const shortEn = oaldFirst.short_en || mwFirst.short_en || '';

    // Keep dictionary senses separate; definitions from different dictionaries are not translations.
    const senses = [];
    const preferred = pronunciations.filter(group => group.dict_id === 'oald8');
    const fallback = preferred.length ? preferred : pronunciations.filter(group => group.dict_id === 'mw11');
    const defaultSummaries = preferred.length ? dslSummaries.oald8 : dslSummaries.mw11;
    const defaultRefs = fallback.length === 1 && defaultSummaries?.length === 1 ? fallback[0].audio_refs : [];
    const addSense = (dictId, pos, zh, en, refs = defaultRefs) => {
      if (senses.length >= 30) return;
      senses.push({ id: `dict-${dictId}-${senses.length}`, pos: pos ? pos.slice(0, 60) : null,
        definition_zh: zh ? zh.slice(0, 400) : null, definition_en: en ? en.slice(0, 400) : null,
        example: null, audio_refs: refs, source: { dict_id: dictId, name: DICT_LABELS[dictId], headword: headwordExact } });
    };
    for (const row of bglRows) {
      for (const definition of String(row.definition || '').split('#').map(value => value.trim()).filter(Boolean)) {
        addSense('bgl', row.pos, definition, null);
      }
    }
    for (const dictId of ['oald8', 'mw11']) {
      for (const summary of dslSummaries[dictId] || []) {
        for (const definition of summary.definitions || []) addSense(dictId, summary.pos_list.join(' / '), null, definition, summary.audio_refs);
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
      pronunciations,
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

    const discovered = this.getSources();
    if (!Object.keys(discovered).length) {
      return {
        available: false,
        index_ready: false,
        query: queryExact,
        exact_matches: [],
        suggestions: [],
        reason: '未配置或未发现本地离线词典文件，可手动填写释义添加单词'
      };
    }

    const index = await this.ensureIndex();
    if (!index) {
      return {
        available: true,
        index_ready: false,
        query: queryExact,
        exact_matches: [],
        suggestions: [],
        reason: '词典索引尚未构建'
      };
    }

    const { db, sources } = index;
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
    const index = await this.ensureIndex();
    if (!index) return { available: false, items: [] };
    const { db } = index;
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

    const discovered = this.getSources();
    if (!Object.keys(discovered).length) {
      return { available: false, word: wordExact, articles: [], reason: '未配置或未发现本地离线词典' };
    }
    const index = await this.ensureIndex();
    if (!index) {
      return { available: true, word: wordExact, articles: [], reason: '词典索引尚未构建' };
    }

    const { db, sources } = index;
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
                nodes: block.nodes.map(node => node.type === 'audio' || node.type === 'image'
                  ? { ...node, url: node.type === 'audio' ? audioUrl(dictId, node.file, sources[dictId])
                    : `/api/dictionary/image/${dictId}/${encodeURIComponent(node.file)}?v=${sourceVersion(sources[dictId])}` }
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

  async getImage(dictId, filename, version) {
    if (!['oald8', 'mw11'].includes(dictId) || typeof filename !== 'string' || !IMAGE_NAME.test(filename)) {
      throw { status: 400, message: '词典图片来源或文件名无效' };
    }
    if (version !== undefined && (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version))) throw { status: 400, message: '词典图片版本无效' };
    const index = await this.ensureIndex();
    if (!index) throw { status: 404, message: '词典图片资源不可用' };
    const { db, sources } = index;
    const source = sources[dictId];
    if (!source?.zipPath) throw { status: 404, message: '词典图片资源不可用' };
    if (version && version !== sourceVersion(source)) throw { status: 409, message: '词典资源已更新，请重新读取原词典' };
    const meta = db.prepare('SELECT filename, method, comp_size, uncomp_size, local_offset FROM media_files WHERE dict_id = ? AND filename_ci = ?').get(dictId, filename.toLowerCase());
    if (!meta) throw { status: 404, message: '词典图片不存在' };
    const buffer = readZipEntry(source.zipPath, {
      method: meta.method, compSize: meta.comp_size, uncompSize: meta.uncomp_size, localHeaderOffset: meta.local_offset
    }, { maxBytes: MAX_IMAGE_BYTES });
    return { buffer, contentType: await imageContentType(meta.filename, buffer) };
  }

  async getAudio(dictId, rawFilename, expected = {}) {
    if (expected.sha256 !== undefined && (typeof expected.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.sha256))) throw { status: 400, message: '发音内容标识无效' };
    if (dictId !== 'oald8' && dictId !== 'mw11') {
      throw { status: 400, message: '不支持的词典音频来源' };
    }
    const cleanName = path.basename(String(rawFilename || '')).toLowerCase();
    if (!cleanName || !/^[a-z0-9._-]+$/.test(cleanName)) {
      throw { status: 400, message: '音频文件名无效' };
    }

    const discovered = this.getSources();
    const source = discovered[dictId];
    if (!source || !source.zipPath || !fs.existsSync(source.zipPath)) {
      throw { status: 404, message: '词典发音包不可用' };
    }
    const index = await this.ensureIndex();
    if (!index) {
      throw { status: 503, message: '词典索引尚未就绪' };
    }

    const { db, sources } = index;
    const src = sources[dictId];
    if (!src?.zipPath) throw { status: 404, message: '词典发音包不可用' };
    if (expected.version && expected.version !== sourceVersion(src)) throw { status: 409, message: '词典资源已更新，请重新查询当前词典发音' };
    const result = this.readAudio(db, sources, dictId, cleanName);
    if (expected.sha256 && createHash('sha256').update(result.buffer).digest('hex') !== expected.sha256) {
      throw { status: 409, message: '原学习发音已不可用，当前资源与保存的发音不同；可以继续文字练习' };
    }
    return result;
  }

  readAudio(db, sources, dictId, cleanName) {
    const src = sources[dictId];
    if (!src?.zipPath) throw { status: 404, message: '词典发音包不可用' };
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
