const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { initDb, TIMING_COLUMNS, WEEKLY_EXTRA_COLUMNS } = require('../db');
const { PhotoStore, hashFile, cloneFile } = require('./photo-store');
const { readManifest } = require('../utils/backup-manifest');
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
    this.lastError = null;
    this.lastWarning = null;
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    this.photos = new PhotoStore(path.join(this.backupDir, 'photos'));
    this.recoverInterruptedRestore();
  }

  referencedPhotos(db = this.db) {
    return db.prepare("SELECT DISTINCT photo_path FROM mistake_records WHERE photo_path LIKE '/uploads/%'").all()
      .map(({ photo_path }) => photo_path.slice('/uploads/'.length));
  }

  expectations() {
    return new Map(this.db.prepare('SELECT name, size, sha256 FROM photo_expectations').all().map(p => [p.name, p]));
  }

  matches(file, photo) {
    try { return fs.statSync(file).size === photo.size && hashFile(file) === photo.sha256; } catch { return false; }
  }

  missingPhotos() {
    const expected = this.expectations(), seen = new Set();
    return this.db.prepare("SELECT photo_path, subject, description, created_at FROM mistake_records WHERE photo_path LIKE '/uploads/%' ORDER BY created_at, id").all()
      .flatMap(row => {
        const name = row.photo_path.slice('/uploads/'.length), file = path.join(this.uploadDir, name);
        if (seen.has(name)) return [];
        seen.add(name);
        const reason = !safeName(name) || !fs.existsSync(file) ? 'absent' : expected.has(name) && !this.matches(file, expected.get(name)) ? 'mismatch' : null;
        return reason ? [{ name, subject: row.subject, description: row.description, created_at: row.created_at, reason }] : [];
      });
  }

  retainedManifest(name) {
    const file = path.join(this.backupDir, name), stat = fs.statSync(file);
    const cache = `${file}.manifest.json`;
    try {
      const data = JSON.parse(fs.readFileSync(cache, 'utf8'));
      if (data.size === stat.size && data.mtime === stat.mtimeMs) return data;
    } catch { /* Old archives are scanned once with bounded memory. */ }
    const data = { ...readManifest(file, MAX_SIZE), size: stat.size, mtime: stat.mtimeMs };
    fs.writeFileSync(`${cache}.tmp`, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(`${cache}.tmp`, cache);
    return data;
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
    // Synchronous throughout: application writes cannot interleave with the database snapshot and
    // the photos it refers to. Recheck stored bytes before trusting or repairing a photo copy.
    const manifest = [];
    const missing = [];
    const expected = this.expectations();
    for (const name of this.referencedPhotos()) {
      if (!safeName(name)) throw fail('照片路径无效，无法备份');
      const file = path.join(this.uploadDir, name);
      // A photo already lost on disk must not stop every later backup of the remaining data.
      const known = expected.get(name);
      if (known && !this.matches(file, known)) { manifest.push(known); missing.push(name); continue; }
      if (!fs.existsSync(file)) { missing.push(name); continue; }
      const photo = this.photos.add(name, file);
      manifest.push(photo);
      this.db.prepare('INSERT OR REPLACE INTO photo_expectations VALUES (?, ?, ?)').run(name, photo.size, photo.sha256);
    }
    this.photos.save();
    const database = this.db.serialize().toString('base64');
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
    this.prunePhotos();
    return this.list().find(item => item.name === name);
  }

  // Stored photos stay while the current data or any retained backup refers to them.
  prunePhotos() {
    const keep = new Set(this.referencedPhotos());
    for (const item of this.list()) {
      try {
        for (const name of this.retainedManifest(item.name).photos) keep.add(name);
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

  exportEntries(scope = 'all') {
    if (!['all', 'new'].includes(scope)) throw fail('照片范围无效');
    const expected = this.expectations(), names = new Set(this.referencedPhotos());
    for (const item of this.list()) {
      const retained = this.retainedManifest(item.name);
      for (const name of retained.photos) names.add(name);
      for (const photo of retained.manifest) {
        const previous = expected.get(photo.name);
        if (previous && (previous.size !== photo.size || previous.sha256 !== photo.sha256)) throw fail('照片清单存在同名不同内容，请检查备份');
        expected.set(photo.name, photo);
      }
    }
    const exported = new Set(scope === 'new' ? this.exportState().names : []), entries = [];
    for (const name of [...names].filter(safeName).sort()) {
      if (exported.has(name)) continue;
      const photo = expected.get(name);
      let file = this.photos.path(name);
      if (!fs.existsSync(file)) file = path.join(this.uploadDir, name);
      if (!fs.existsSync(file)) continue; // No bytes to export; this name is never marked exported.
      if (photo && !this.matches(file, photo)) throw fail(`照片 ${name} 校验不一致，请先补齐正确的照片`);
      const entry = this.photos.add(name, file);
      if (photo && (entry.size !== photo.size || entry.sha256 !== photo.sha256)) throw fail(`照片 ${name} 校验不一致`);
      entries.push({ name, file: this.photos.path(name), sha256: entry.sha256 });
    }
    this.photos.save();
    return entries;
  }

  photoExportStatus() {
    const state = this.exportState(), exported = new Set(state.names);
    const names = new Set(this.referencedPhotos().filter(safeName));
    for (const item of this.list()) for (const name of this.retainedManifest(item.name).photos) names.add(name);
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
    const entries = this.exportEntries(scope);
    const stream = tarStream(entries);
    stream.photoNames = entries.map(e => e.name);
    return stream;
  }

  async importPhotos(stream) {
    const result = { imported: 0, present: 0, unused: 0, skipped: 0, mismatch: 0, unverified: 0 };
    const referenced = new Set(this.referencedPhotos()), expected = this.expectations();
    const reader = new TarReader((name, content) => {
      if (!safeName(name)) { result.skipped++; return; }
      if (!referenced.has(name)) { result.unused++; return; }
      const photo = expected.get(name);
      // A legacy missing_photos entry has no trusted bytes or digest. Never guess by filename.
      if (!photo) { result.unverified++; return; }
      if (content.length !== photo.size || createHash('sha256').update(content).digest('hex') !== photo.sha256) { result.mismatch++; return; }
      const file = path.join(this.uploadDir, name);
      if (this.matches(file, photo)) { this.photos.add(name, file); result.present++; return; }
      const temp = path.join(this.uploadDir, `.import-${randomUUID()}`);
      try {
        fs.writeFileSync(temp, content, { mode: 0o600 });
        fs.renameSync(temp, file);
        this.photos.add(name, file);
      } finally { fs.rmSync(temp, { force: true }); }
      result.imported++;
    }, { maxFileSize: MAX_PHOTO_SIZE });
    try {
      for await (const chunk of stream) reader.push(chunk);
      if (stream.truncated) throw Object.assign(new Error('照片包过大'), { statusCode: 413 });
      reader.end();
    } finally { this.photos.save(); }
    result.skipped += reader.skipped;
    return { ...result, missing: this.missingPhotos().length };
  }

  restore(buffer) {
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
        const source = [this.photos.path(photo.name), path.join(this.uploadDir, photo.name)].find(file => {
          try { return fs.statSync(file).size === photo.size && hashFile(file) === photo.sha256; } catch { return false; }
        });
        if (!source) { unavailable.push(photo.name); continue; }
        cloneFile(source, path.join(staging, photo.name));
      }
      fs.writeFileSync(saved, candidate.serialize(), { mode: 0o600 });
      candidate.close();
      candidate = null;
      const recovery = this.create('before-restore');
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
