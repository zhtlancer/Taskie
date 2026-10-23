const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { initDb, TIMING_COLUMNS, WEEKLY_EXTRA_COLUMNS } = require('../db');
const { PhotoStore, fileEntry } = require('./photo-store');
const { Worker } = require('node:worker_threads');
const { MAX_PHOTO_SIZE } = require('../utils/photo-limits');
const { tarStream, TarReader } = require('../utils/tar');

// Only genuine older schemas may have their newer tables created by initDb.
const REQUIRED_TABLES = ['children', 'task_templates', 'daily_tasks', 'point_logs', 'badge_definitions', 'child_badges', 'mistake_records', 'settings', 'characters'];
const PERIOD_TABLES = ['periods', 'period_paused_templates', 'period_tasks', 'period_task_logs'];
const SCHEDULE_TABLES = ['timetables', 'timetable_slots', 'timetable_lessons', 'outside_classes', 'outside_class_children', 'outside_class_exceptions'];
const STUDY_TABLES = ['word_study_plans', 'word_study_states', 'word_study_days', 'word_study_batches', 'word_study_items', 'word_study_attempts'];
const HOMEWORK_TABLES = ['homework_records', 'homework_course_points', 'homework_sessions', 'homework_session_days'];
const TABLES = [...REQUIRED_TABLES, 'template_children', 'reward_items', 'reward_redemptions', ...PERIOD_TABLES, 'task_skip_requests', ...SCHEDULE_TABLES, 'makeup_days', 'task_backfill_events', 'task_day_snapshots', ...STUDY_TABLES, ...HOMEWORK_TABLES, 'study_legacy_corrections', 'outside_class_attendance', 'outside_class_fees', 'outside_class_changes', 'outside_class_revisions', 'photo_expectations'];
// Backups (format v2) hold the database and a manifest of its photos; the photos themselves are kept
// once in backups/photos and move between servers as separate photo packages. This limit therefore
// applies to the database alone. Older v1 archives with embedded photos still restore under it.
const MAX_SIZE = 256 * 1024 * 1024;
// A gzip archive is never larger than its JSON, so accepting MAX_SIZE uploads lets every backup this
// service creates be restored through the app.
const MAX_UPLOAD_SIZE = MAX_SIZE;
// Photo packages are streamed, so they have no practical size limit; one photo is at most 10 MiB.
const MAX_PHOTO_PACKAGE_SIZE = 64 * 1024 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { statusCode: 400 });
const safeName = name => typeof name === 'string' && /^[\w-]+\.(?:jpg|jpeg|png|webp)$/i.test(name);

class BackupService {
  constructor(db, uploadDir, backupDir, retention = 7) {
    this.db = db;
    this.uploadDir = path.resolve(uploadDir);
    this.backupDir = path.resolve(backupDir);
    this.retention = Math.max(1, Math.min(100, Math.floor(Number(retention) || 7)));
    this.uploadIndexPath = path.join(this.backupDir, '.upload-index.json');
    try { this.uploadIndex = JSON.parse(fs.readFileSync(this.uploadIndexPath, 'utf8')); } catch { this.uploadIndex = {}; }
    this.manifestReads = new Map();
    this.lastError = null;
    this.lastWarning = null;
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    this.photos = new PhotoStore(path.join(this.backupDir, 'photos'));
    this.recoverInterruptedRestore();
  }

  saveUploadIndex() {
    fs.writeFileSync(`${this.uploadIndexPath}.tmp`, JSON.stringify(this.uploadIndex), { mode: 0o600 });
    fs.renameSync(`${this.uploadIndexPath}.tmp`, this.uploadIndexPath);
  }

  referencedPhotos(db = this.db) {
    return db.prepare("SELECT DISTINCT photo_path FROM mistake_records WHERE photo_path LIKE '/uploads/%'").all()
      .map(({ photo_path }) => photo_path.slice('/uploads/'.length));
  }

  expectations() {
    return new Map(this.db.prepare('SELECT name, size, sha256 FROM photo_expectations').all().map(p => [p.name, p]));
  }

  async matches(file, photo, verify = false) {
    try {
      const actual = await fileEntry(file, verify ? {} : this.uploadIndex, file, verify);
      return actual && actual.size === photo.size && actual.sha256 === photo.sha256;
    } catch { return false; }
  }

  async missingPhotos() {
    const expected = this.expectations(), seen = new Set(), missing = [];
    for (const row of this.db.prepare("SELECT photo_path, subject, description, created_at FROM mistake_records WHERE photo_path LIKE '/uploads/%' ORDER BY created_at, id").all()) {
      const name = row.photo_path.slice('/uploads/'.length), file = path.join(this.uploadDir, name);
      if (seen.has(name)) continue;
      seen.add(name);
      const reason = !safeName(name) || !fs.existsSync(file) ? 'absent' : expected.has(name) && !await this.matches(file, expected.get(name)) ? 'mismatch' : null;
      if (reason) missing.push({ name, subject: row.subject, description: row.description, created_at: row.created_at, reason });
    }
    return missing;
  }

  async retainedManifest(name) {
    const file = path.join(this.backupDir, name), stat = fs.statSync(file);
    const cache = `${file}.manifest.json`;
    try {
      const data = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (data.size === stat.size && data.mtime === stat.mtimeMs) return data;
    } catch { /* Scan old archives off the request thread, with bounded memory. */ }
    if (this.manifestReads.has(name)) return this.manifestReads.get(name);
    const pending = (async () => {
      const manifest = await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, '../utils/manifest-worker.js'), { workerData: { file, maxSize: MAX_SIZE } });
        let message, workerError;
        worker.once('message', value => { message = value; });
        worker.once('error', error => { workerError = error; });
        worker.once('exit', code => {
          if (workerError) reject(workerError);
          else if (code || !message) reject(new Error(`清单扫描失败 (${code})`));
          else if (message.error) reject(new Error(message.error));
          else resolve(message.result);
        });
      });
      const data = { ...manifest, size: stat.size, mtime: stat.mtimeMs };
      // A concurrent retention cleanup or replacement must not resurrect a stale cache.
      const current = await fs.promises.stat(file);
      if (current.size !== stat.size || current.mtimeMs !== stat.mtimeMs) throw fail('备份在扫描时被修改');
      fs.writeFileSync(`${cache}.tmp`, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(`${cache}.tmp`, cache);
      return data;
    })();
    this.manifestReads.set(name, pending);
    try { return await pending; } finally { this.manifestReads.delete(name); }
  }

  get journalPath() { return path.join(this.backupDir, '.restore-journal.json'); }

  // A restore swaps the photo directory and then commits the database. If the process died in
  // between (power cut, SIGKILL), the journal left behind tells this start which side to keep, so
  // records and photos always come from the same backup: a committed restore keeps the restored
  // photos, anything earlier puts the previous photos back.
  recoverInterruptedRestore() {
    let journal;
    try { journal = JSON.parse(fs.readFileSync(this.journalPath, 'utf8')); } catch (error) {
      if (error.code === 'ENOENT') return;
      console.error('    [Backup] 恢复日志无法读取，保留原样待人工检查:', this.journalPath);
      return;
    }
    const committed = this.db.prepare("SELECT value FROM settings WHERE key = 'last_restore_id'").get()?.value === journal.id;
    if (!committed && fs.existsSync(journal.previous)) {
      fs.rmSync(this.uploadDir, { recursive: true, force: true });
      fs.renameSync(journal.previous, this.uploadDir);
    }
    for (const leftover of [journal.previous, journal.staging, journal.saved]) fs.rmSync(leftover, { recursive: true, force: true });
    fs.rmSync(this.journalPath, { force: true });
    console.warn(committed
      ? '    [Backup] 上次恢复已写入数据库但未清理完，已保留恢复后的照片并清理临时文件'
      : '    [Backup] 上次恢复在写入数据库前中断，已放回恢复前的照片，数据库保持恢复前的内容');
  }

  writeJournal(journal) {
    const fd = fs.openSync(this.journalPath, 'w', 0o600);
    try { fs.writeSync(fd, JSON.stringify(journal)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }

  list() {
    return fs.readdirSync(this.backupDir).filter(name => /^backup-[\dT-]+-[\w-]+\.taskie\.gz$/.test(name)).map(name => {
      const stat = fs.statSync(path.join(this.backupDir, name));
      return { name, size: stat.size, created_at: stat.mtime.toISOString() };
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  getPath(name) {
    if (!this.list().some(item => item.name === name)) throw Object.assign(new Error('备份不存在'), { statusCode: 404 });
    return path.join(this.backupDir, name);
  }

  create(reason = 'manual') {
    // Serialize backup/restore jobs; reads and ordinary application requests can still run.
    return this.exclusive(() => this.createSnapshot(reason));
  }

  exclusive(operation) {
    const pending = (this.operation || Promise.resolve()).then(operation);
    this.operation = pending.catch(() => {});
    return pending;
  }

  async createSnapshot(reason) {
    // Capture references, expectations and database in the same synchronous turn, before photo I/O.
    const names = this.referencedPhotos();
    const snapshot = new Database(this.db.serialize());
    const manifest = [];
    const missing = [];
    const expected = this.expectations();
    try {
      for (const name of names) {
        if (!safeName(name)) throw fail('照片路径无效，无法备份');
        const file = path.join(this.uploadDir, name);
        // A photo already lost on disk must not stop every later backup of the remaining data.
        const known = expected.get(name);
        if (known && !await this.matches(file, known)) { manifest.push(known); missing.push(name); continue; }
        if (!fs.existsSync(file)) { missing.push(name); continue; }
        const source = await fileEntry(file, this.uploadIndex, file);
        if (!source) { missing.push(name); continue; }
        const photo = await this.photos.add(name, file, source);
        manifest.push(photo);
        snapshot.prepare('INSERT OR REPLACE INTO photo_expectations VALUES (?, ?, ?)').run(name, photo.size, photo.sha256);
        this.db.prepare('INSERT OR IGNORE INTO photo_expectations VALUES (?, ?, ?)').run(name, photo.size, photo.sha256);
      }
      this.photos.save();
      this.saveUploadIndex();
      const database = snapshot.serialize().toString('base64');
      const data = Buffer.from(JSON.stringify({ format: 'taskie-backup', version: 2, created_at: new Date().toISOString(), reason, database, photo_manifest: manifest, missing_photos: missing.filter(name => !manifest.some(p => p.name === name)) }));
      if (data.length > MAX_SIZE) throw fail('备份数据超过 256 MiB，请使用 NAS 文件备份');
      const name = `backup-${new Date().toISOString().replace(/[:.Z]/g, '-')}-${randomUUID()}.taskie.gz`;
      const target = path.join(this.backupDir, name);
      fs.writeFileSync(`${target}.tmp`, gzipSync(data), { mode: 0o600 });
      fs.renameSync(`${target}.tmp`, target);
      this.lastError = null;
      this.lastWarning = missing.length ? `${missing.length} 张错题照片文件已丢失或校验不一致，备份保留了它们的记录和已有校验清单：${missing.slice(0, 5).join('、')}${missing.length > 5 ? ' 等' : ''}` : null;
      for (const old of this.list().filter(item => item.name !== name).slice(this.retention - 1)) {
        fs.unlinkSync(this.getPath(old.name));
        fs.rmSync(path.join(this.backupDir, `${old.name}.manifest.json`), { force: true });
      }
      // New archives already have a manifest: do not decompress their database just to prune.
      const stat = fs.statSync(target);
      fs.writeFileSync(`${target}.manifest.json`, JSON.stringify({ photos: manifest.map(p => p.name), manifest, size: stat.size, mtime: stat.mtimeMs }), { mode: 0o600 });
      await this.prunePhotos();
      return this.list().find(item => item.name === name);
    } finally { snapshot.close(); }
  }

  // Stored photos stay while the current data or any retained backup refers to them.
  async prunePhotos() {
    const keep = new Set(this.referencedPhotos());
    for (const item of this.list()) {
      try {
        for (const name of (await this.retainedManifest(item.name)).photos) keep.add(name);
      } catch (error) {
        console.error('    [Backup] 读取备份清单失败，本次不清理照片:', item.name, error.message);
        return;
      }
    }
    this.photos.prune(keep);
    this.photos.save();
  }

  exportState() {
    try { return JSON.parse(fs.readFileSync(path.join(this.backupDir, '.photo-export.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return { last_complete_at: null, names: [] }; }
  }

  async exportEntries(scope = 'all') {
    if (!['all', 'new'].includes(scope)) throw fail('照片范围无效');
    const expected = this.expectations(), names = new Set(this.referencedPhotos());
    for (const item of this.list()) {
      const retained = await this.retainedManifest(item.name);
      for (const name of retained.photos) names.add(name);
      for (const photo of retained.manifest) {
        const previous = expected.get(photo.name);
        if (previous && (previous.size !== photo.size || previous.sha256 !== photo.sha256)) throw fail('照片清单存在同名不同内容，请检查备份');
        expected.set(photo.name, photo);
      }
    }
    const exported = new Set(scope === 'new' ? this.exportState().names : []), entries = [];
    const details = new Map(this.db.prepare("SELECT photo_path, subject, description, created_at FROM mistake_records ORDER BY created_at, id").all().map(row => [row.photo_path.slice('/uploads/'.length), row]));
    entries.skipped = [];
    for (const name of [...names].filter(safeName).sort()) {
      if (exported.has(name)) continue;
      const photo = expected.get(name);
      const entry = await this.exportPhoto(name, photo);
      if (entry) entries.push({ name, photo: photo || { size: entry.content.length, sha256: entry.sha256 }, file: entry.file, sha256: entry.sha256 });
      else {
        const row = details.get(name);
        entries.skipped.push({ name, subject: row?.subject || '', description: row?.description || '', created_at: row?.created_at || null,
          reason: [this.photos.path(name), path.join(this.uploadDir, name)].some(file => fs.existsSync(file)) ? 'mismatch' : 'absent' });
      }
    }
    return entries;
  }

  async exportPhoto(name, photo) {
    // Read at most one photo (10 MiB) at a time. Only verified, immutable buffers enter the tar;
    // a disk edit after verification cannot leak bad bytes or invalidate an already-sent header.
    for (const file of [this.photos.path(name), path.join(this.uploadDir, name)]) {
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile() || stat.size > MAX_PHOTO_SIZE || photo && stat.size !== photo.size) continue;
        const chunks = [], hash = createHash('sha256');
        let size = 0;
        for await (const chunk of fs.createReadStream(file)) {
          size += chunk.length;
          if (size > MAX_PHOTO_SIZE) throw new Error('照片过大');
          chunks.push(chunk); hash.update(chunk);
        }
        const sha256 = hash.digest('hex');
        if (size !== stat.size || photo && sha256 !== photo.sha256) continue;
        return { file, sha256, content: Buffer.concat(chunks), mtime: stat.mtimeMs };
      } catch { /* Try the other copy, then skip only this photo. */ }
    }
    return null;
  }

  async photoExportStatus() {
    const state = this.exportState(), exported = new Set(state.names);
    const names = new Set(this.referencedPhotos().filter(safeName));
    for (const item of this.list()) for (const name of (await this.retainedManifest(item.name)).photos) names.add(name);
    return { last_complete_at: state.last_complete_at, exported_count: [...names].filter(name => exported.has(name)).length,
      pending_count: [...names].filter(name => !exported.has(name)).length };
  }

  recordPhotoExport(names) {
    const state = this.exportState();
    const target = path.join(this.backupDir, '.photo-export.json');
    fs.writeFileSync(`${target}.tmp`, JSON.stringify({ last_complete_at: new Date().toISOString(), names: [...new Set([...state.names, ...names])] }), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
  }

  exportPhotos(scope = 'all') {
    const names = [];
    const entries = (async function* (service) {
      for (const entry of await service.exportEntries(scope)) {
        const loaded = await service.exportPhoto(entry.name, entry.photo);
        if (loaded) yield { name: entry.name, ...loaded };
      }
    })(this);
    const stream = tarStream(entries, { onEntry: name => names.push(name) });
    stream.photoNames = names;
    return stream;
  }

  importPhotos(stream) { return this.exclusive(() => this.importPhotoStream(stream)); }

  async importPhotoStream(stream) {
    const result = { imported: 0, present: 0, unused: 0, skipped: 0, mismatch: 0, unverified: 0 };
    const referenced = new Set(this.referencedPhotos()), expected = this.expectations();
    const pending = [];
    const reader = new TarReader((name, content) => pending.push({ name, content }), { maxFileSize: MAX_PHOTO_SIZE });
    const install = async (name, content) => {
      if (!safeName(name)) { result.skipped++; return; }
      if (!referenced.has(name)) { result.unused++; return; }
      const photo = expected.get(name);
      // A legacy missing_photos entry has no trusted bytes or digest. Never guess by filename.
      if (!photo) { result.unverified++; return; }
      if (content.length !== photo.size || createHash('sha256').update(content).digest('hex') !== photo.sha256) { result.mismatch++; return; }
      const file = path.join(this.uploadDir, name);
      if (await this.matches(file, photo, true)) { await this.photos.entry(name, true); await this.photos.add(name, file, photo); result.present++; return; }
      const temp = path.join(this.uploadDir, `.import-${randomUUID()}`);
      try {
        fs.writeFileSync(temp, content, { mode: 0o600 });
        fs.renameSync(temp, file);
        await this.photos.entry(name, true);
        await this.photos.add(name, file, photo);
      } finally { fs.rmSync(temp, { force: true }); }
      result.imported++;
    };
    try {
      for await (const chunk of stream) {
        // Bound parsing/copying work per turn, including a giant single input chunk.
        for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
          reader.push(chunk.subarray(offset, offset + 64 * 1024));
          for (const item of pending.splice(0)) await install(item.name, item.content);
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      if (stream.truncated) throw Object.assign(new Error('照片包过大'), { statusCode: 413 });
      reader.end();
    } finally { this.photos.save(); }
    result.skipped += reader.skipped;
    const missing = (await this.missingPhotos()).length;
    this.saveUploadIndex();
    return { ...result, missing };
  }

  restore(buffer) { return this.exclusive(() => this.restoreSnapshot(buffer)); }

  async restoreSnapshot(buffer) {
    let data, candidate;
    try {
      data = JSON.parse(gunzipSync(buffer, { maxOutputLength: MAX_SIZE }).toString());
      const validManifest = list => Array.isArray(list) && list.every(p => p && safeName(p.name) && Number.isSafeInteger(p.size) && p.size >= 0 && p.size <= MAX_PHOTO_SIZE && /^[0-9a-f]{64}$/.test(p.sha256));
      if (data.format !== 'taskie-backup' || ![1, 2].includes(data.version) || typeof data.database !== 'string' ||
        (data.version === 1 && (!data.photos || Array.isArray(data.photos))) || (data.version === 2 && (Object.hasOwn(data, 'photos') || !validManifest(data.photo_manifest) || new Set(data.photo_manifest.map(p => p.name)).size !== data.photo_manifest.length)) ||
        (data.missing_photos !== undefined && (!Array.isArray(data.missing_photos) || !data.missing_photos.every(safeName)))) throw fail('不是有效的 Taskie 备份包');
      if (data.version === 1 && (typeof data.photos !== 'object' || Object.hasOwn(data, 'photo_manifest'))) throw fail('备份照片格式混用');
      const photoNames = new Set(data.version === 2 ? data.photo_manifest.map(p => p.name) : Object.keys(data.photos));
      if ((data.missing_photos || []).some(name => photoNames.has(name)) || new Set(data.missing_photos || []).size !== (data.missing_photos || []).length) throw fail('备份照片清单重复或冲突');
      const database = Buffer.from(data.database, 'base64');
      if (database.subarray(0, 16).toString() !== 'SQLite format 3\0') throw fail('备份数据库无效');
      candidate = new Database(database);
      if (candidate.pragma('integrity_check', { simple: true }) !== 'ok' || candidate.pragma('foreign_key_check').length) throw fail('备份数据库完整性检查失败');
      const tables = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
      const schemaVersion = candidate.pragma('user_version', { simple: true });
      if (!REQUIRED_TABLES.every(t => tables.includes(t)) || schemaVersion > this.db.pragma('user_version', { simple: true })) throw fail('备份版本不兼容');
      if (schemaVersion >= 2 && (!tables.includes('template_children') ||
        !candidate.pragma('table_info(task_templates)').some(column => column.name === 'assign_all'))) {
        throw fail('备份缺少任务分配数据，无法恢复');
      }
      if (schemaVersion >= 3 && !['reward_items', 'reward_redemptions'].every(t => tables.includes(t))) {
        throw fail('备份缺少积分兑换数据，无法恢复');
      }
      if (schemaVersion >= 4 && !['source_template_id', 'template_created_at'].every(name =>
        candidate.pragma('table_info(daily_tasks)').some(column => column.name === name))) {
        throw fail('备份缺少任务历史快照，无法恢复');
      }
      if (schemaVersion >= 5 && (!PERIOD_TABLES.every(t => tables.includes(t)) ||
        !candidate.pragma('table_info(point_logs)').some(column => column.name === 'period_log_id'))) {
        throw fail('备份缺少假期数据，无法恢复');
      }
      if (schemaVersion >= 6 && !['activity_date', 'activity_title'].every(name =>
        candidate.pragma('table_info(point_logs)').some(column => column.name === name))) {
        throw fail('备份缺少积分历史快照，无法恢复');
      }
      if (schemaVersion >= 7 && !candidate.pragma('table_info(daily_tasks)').some(column => column.name === 'origin')) {
        throw fail('备份缺少临时任务数据，无法恢复');
      }
      const hasColumn = (table, name) => candidate.pragma(`table_info(${table})`).some(column => column.name === name);
      if (schemaVersion >= 8 && !(hasColumn('period_tasks', 'child_id') && hasColumn('period_task_logs', 'position') && hasColumn('daily_tasks', 'goal_id'))) {
        throw fail('备份缺少长期任务数据，无法恢复');
      }
      if (schemaVersion >= 9 && !hasColumn('characters', 'categories')) throw fail('备份缺少生字生词分类，无法恢复');
      if (schemaVersion >= 10 && !(tables.includes('task_skip_requests') &&
        ['skipped_at', 'skip_reason'].every(name => hasColumn('daily_tasks', name)))) {
        throw fail('备份缺少跳过申请数据，无法恢复');
      }
      if (schemaVersion >= 11 && !Object.entries(TIMING_COLUMNS).every(([table, columns]) =>
        Object.keys(columns).every(name => hasColumn(table, name)))) {
        throw fail('备份缺少任务用时数据，无法恢复');
      }
      if (schemaVersion >= 12 && !(SCHEDULE_TABLES.every(t => tables.includes(t)) && hasColumn('daily_tasks', 'class_id'))) {
        throw fail('备份缺少课程表数据，无法恢复');
      }
      if (schemaVersion >= 13 && !hasColumn('daily_tasks', 'class_lesson_date')) {
        throw fail('备份缺少课次数据，无法恢复');
      }
      if (schemaVersion >= 14 && !(tables.includes('makeup_days') && hasColumn('task_templates', 'carry_over') &&
        ['carry_over', 'due_date'].every(name => hasColumn('daily_tasks', name)))) {
        throw fail('备份缺少顺延和调休数据，无法恢复');
      }
      if (schemaVersion >= 15 && (!tables.includes('task_backfill_events') || !hasColumn('daily_tasks', 'completion_source'))) {
        throw fail('备份缺少家长补卡记录，无法恢复');
      }
      if (schemaVersion >= 16 && !Object.entries(WEEKLY_EXTRA_COLUMNS).every(([table, columns]) =>
        Object.keys(columns).every(name => hasColumn(table, name)))) {
        throw fail('备份缺少每周额外完成和奖励数据，无法恢复');
      }
      if (schemaVersion >= 17 && (!STUDY_TABLES.every(table => tables.includes(table)) ||
        !hasColumn('daily_tasks', 'study_day_id') || !hasColumn('point_logs', 'study_batch_id'))) {
        throw fail('备份缺少字词学习计划数据，无法恢复');
      }
      if (schemaVersion >= 18 && !tables.includes('task_day_snapshots')) throw fail('备份缺少每日任务快照，无法恢复');
      if (schemaVersion >= 19 && !['homework_records', 'homework_course_points'].every(table => tables.includes(table))) throw fail('备份缺少作业记录，无法恢复');
      if (schemaVersion >= 20 && !hasColumn('homework_records', 'course_key')) throw fail('备份缺少作业课程标识，无法恢复');
      if (schemaVersion >= 21 && (!HOMEWORK_TABLES.every(table => tables.includes(table)) || !hasColumn('daily_tasks', 'homework_legacy_seconds') || !hasColumn('homework_records', 'completion_requested_at'))) throw fail('备份缺少分次学习记录，无法恢复');
      if (schemaVersion >= 22 && !hasColumn('daily_tasks', 'revoked_at')) throw fail('备份缺少已取消任务标记，无法恢复');
      if (schemaVersion >= 23 && !hasColumn('daily_tasks', 'finish_on_actual_date')) throw fail('备份缺少完成时间归属，无法恢复');
      if (schemaVersion >= 24 && (!tables.includes('study_legacy_corrections') ||
        !['id', 'task_id', 'child_id', 'old_seconds', 'new_seconds', 'reason', 'actor', 'created_at'].every(name => hasColumn('study_legacy_corrections', name)))) throw fail('备份缺少旧累计更正记录，无法恢复');
      if (schemaVersion >= 25 && !hasColumn('daily_tasks', 'is_course_homework')) throw fail('备份缺少课程作业来源，无法恢复');
      if (schemaVersion >= 26 && !['last_timer_kind', 'last_timer_id'].every(name => hasColumn('children', name))) throw fail('备份缺少最近计时记录，无法恢复');
      if (schemaVersion >= 27 && !hasColumn('outside_classes', 'total_lessons')) throw fail('备份缺少课外班总课次，无法恢复');
      if (schemaVersion >= 28 && (!['class_id', 'child_id', 'lesson_date', 'actual_date', 'start_time', 'end_time', 'duration_minutes', 'status', 'charged', 'source', 'task_id', 'note', 'updated_at'].every(name => hasColumn('outside_class_attendance', name)) ||
        !['class_id', 'child_id', 'total_fee_cents', 'updated_at'].every(name => hasColumn('outside_class_fees', name)))) throw fail('备份缺少课外班出勤或学费记录，无法恢复');
      if (schemaVersion >= 29 && (!hasColumn('children', 'session_epoch') || !tables.includes('outside_class_changes') ||
        !['id', 'class_id', 'child_id', 'kind', 'lesson_date', 'old_value', 'new_value', 'created_at'].every(name => hasColumn('outside_class_changes', name)))) throw fail('备份缺少出勤学费修改记录或孩子会话版本，无法恢复');
      if (schemaVersion >= 30 && (!['photo_expectations', 'outside_class_revisions'].every(t => tables.includes(t)) ||
        !['name', 'size', 'sha256'].every(name => hasColumn('photo_expectations', name)) ||
        !['class_id', 'child_id', 'kind', 'lesson_date', 'revision'].every(name => hasColumn('outside_class_revisions', name)) || !hasColumn('period_task_logs', 'request_fingerprint'))) throw fail('备份缺少照片校验或独立版本数据，无法恢复');
      if (!candidate.prepare("SELECT value FROM settings WHERE key = 'parent_pin_hash'").get()) throw fail('备份缺少家长账号');
      initDb(candidate);
      for (const [name, value] of Object.entries(data.photos || {})) {
        if (!safeName(name) || typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw fail('备份照片路径或内容无效');
      }
      candidate.prepare('DELETE FROM photo_expectations').run();
      const expectation = candidate.prepare('INSERT INTO photo_expectations VALUES (?, ?, ?)');
      for (const photo of data.photo_manifest || []) expectation.run(photo.name, photo.size, photo.sha256);
      for (const [name, value] of Object.entries(data.photos || {})) {
        const content = Buffer.from(value, 'base64');
        if (content.length > MAX_PHOTO_SIZE) throw fail('备份单张照片超过 10 MiB');
        expectation.run(name, content.length, createHash('sha256').update(content).digest('hex'));
      }
      const listed = new Set([...Object.keys(data.photos || {}), ...(data.photo_manifest || []).map(p => p.name), ...(data.missing_photos || [])]);
      for (const name of this.referencedPhotos(candidate)) {
        if (!listed.has(name)) throw fail('备份缺少关联照片');
      }
    } catch (error) {
      if (candidate) candidate.close();
      throw fail(error.statusCode ? error.message : '备份包损坏或无法读取');
    }

    const restoreId = randomUUID();
    const staging = `${this.uploadDir}.restore-${restoreId}`;
    const previous = `${this.uploadDir}.previous-${restoreId}`;
    const saved = path.join(this.backupDir, `.restore-${restoreId}.sqlite`);
    let moved = false, installed = false, attached = false, journaled = false;
    // A v2 backup's photos come from the photo store or the current upload directory, checked against
    // its manifest; photos found in neither are reported and can be added later from a photo package.
    const unavailable = [...(data.missing_photos || [])];
    try {
      fs.mkdirSync(staging, { recursive: true });
      for (const [name, content] of Object.entries(data.photos || {})) fs.writeFileSync(path.join(staging, name), Buffer.from(content, 'base64'), { mode: 0o600 });
      for (const photo of data.photo_manifest || []) {
        let source;
        for (const file of [this.photos.path(photo.name), path.join(this.uploadDir, photo.name)]) {
          if (await this.matches(file, photo, true)) { source = file; break; }
        }
        if (!source) { unavailable.push(photo.name); continue; }
        await fs.promises.copyFile(source, path.join(staging, photo.name), fs.constants.COPYFILE_FICLONE);
        if (!await this.matches(path.join(staging, photo.name), photo, true)) throw fail('照片在恢复时被修改');
      }
      fs.writeFileSync(saved, candidate.serialize(), { mode: 0o600 });
      candidate.close();
      candidate = null;
      const recovery = await this.createSnapshot('before-restore');
      const secrets = this.db.prepare("SELECT key, value FROM settings WHERE key IN ('jwt_secret')").all();
      this.db.prepare('ATTACH DATABASE ? AS recovery').run(saved);
      attached = true;
      this.db.pragma('foreign_keys = OFF');
      this.writeJournal({ id: restoreId, previous, staging, saved });
      journaled = true;
      fs.renameSync(this.uploadDir, previous);
      moved = true;
      fs.renameSync(staging, this.uploadDir);
      installed = true;
      this.uploadIndex = {};
      this.db.transaction(() => {
        for (const table of TABLES) {
          const columns = this.db.pragma(`table_info(${table})`).map(c => `"${c.name}"`).join(',');
          this.db.exec(`DELETE FROM main.${table}; INSERT INTO main.${table} (${columns}) SELECT ${columns} FROM recovery.${table}`);
        }
        for (const { key, value } of secrets) this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, value);
        this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('auth_epoch',?)").run(randomUUID());
        // Marks this restore as committed for recoverInterruptedRestore.
        this.db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('last_restore_id',?)").run(restoreId);
        if (this.db.pragma('foreign_key_check').length) throw fail('恢复数据关联检查失败');
      })();
      moved = false;
      return { success: true, recovery_backup: recovery.name, requires_login: true, missing_photos: unavailable };
    } catch (error) {
      if (moved) {
        if (installed) fs.renameSync(this.uploadDir, staging);
        fs.renameSync(previous, this.uploadDir);
        moved = false;
      }
      throw error;
    } finally {
      if (candidate) candidate.close();
      if (attached) this.db.exec('DETACH DATABASE recovery');
      this.db.pragma('foreign_keys = ON');
      fs.rmSync(staging, { recursive: true, force: true });
      if (!moved) fs.rmSync(previous, { recursive: true, force: true });
      fs.rmSync(saved, { force: true });
      // Done or rolled back: nothing is left for a restart to finish.
      if (journaled && !moved) fs.rmSync(this.journalPath, { force: true });
    }
  }
}

module.exports = BackupService;
module.exports.MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE;
module.exports.MAX_PHOTO_PACKAGE_SIZE = MAX_PHOTO_PACKAGE_SIZE;
