// Runs in a worker and writes only its private, disposable index file.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { identityKey, canonicalKey } = require('../../utils/english-word');
const { parseBglFile } = require('./bgl-parser');
const { scanDslEntries } = require('./dsl-parser');
const { scanZipCentralDirectory } = require('./zip64-reader');

function buildIndex({ sources, tmpPath, indexVersion }, onProgress) {
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
        onProgress({ dict_id: s.dictId, phase: 'entries', processed: 0 });
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
          if (entryCount % 5000 === 0) onProgress({ dict_id: s.dictId, phase: 'entries', processed: entryCount });
        });
        onProgress({ dict_id: 'bgl', phase: 'entries', processed: entryCount });
        insertSrc.run('bgl', s.name, s.filePath, null, s.fileSize, s.mtimeMs, s.zipSize, s.zipMtimeMs, entryCount, 0);
      }

      for (const dictId of ['oald8', 'mw11']) {
        const s = sources[dictId];
        if (!s) continue;
        let entryCount = 0;
        onProgress({ dict_id: s.dictId, phase: 'entries', processed: 0 });
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
          if (entryCount % 5000 === 0) onProgress({ dict_id: s.dictId, phase: 'entries', processed: entryCount });
        });

        onProgress({ dict_id: dictId, phase: 'entries', processed: entryCount });
        let mediaCount = 0;
        if (s.zipPath && fs.existsSync(s.zipPath)) {
          onProgress({ dict_id: dictId, phase: 'media', processed: 0 });
          scanZipCentralDirectory(s.zipPath, item => {
            const name = path.basename(item.filename);
            insertMedia.run(dictId, name.toLowerCase(), name, item.method, item.compSize, item.uncompSize, item.localHeaderOffset);
            mediaCount += 1;
            if (mediaCount % 10000 === 0) onProgress({ dict_id: dictId, phase: 'media', processed: mediaCount });
          });
        }
        insertSrc.run(dictId, s.name, s.filePath, s.zipPath || null, s.fileSize, s.mtimeMs, s.zipSize, s.zipMtimeMs, entryCount, mediaCount);
      }

      onProgress({ phase: 'finalizing', processed: 0 });
      db.exec(`
        CREATE INDEX idx_hw_exact ON headwords(headword_exact);
        CREATE INDEX idx_hw_ci ON headwords(headword_ci);
        CREATE INDEX idx_infl_form ON inflections(form_ci);
      `);
      db.pragma(`user_version = ${indexVersion}`);
    });

    runBuild();
    onProgress({ phase: 'checking', processed: 0 });
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Invalid dictionary index');
    return db.prepare('SELECT dict_id, entry_count, media_count FROM dict_sources').all();
  } finally { db.close(); }
}

module.exports = { buildIndex };
