const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { initDb, TIMING_COLUMNS, WEEKLY_EXTRA_COLUMNS } = require('../db');
const { PhotoStore, hashFile, cloneFile } = require('./photo-store');
const { tarStream, TarReader } = require('../utils/tar');

// Only genuine older schemas may have their newer tables created by initDb.
const REQUIRED_TABLES = ['children', 'task_templates', 'daily_tasks', 'point_logs', 'badge_definitions', 'child_badges', 'mistake_records', 'settings', 'characters'];
const PERIOD_TABLES = ['periods', 'period_paused_templates', 'period_tasks', 'period_task_logs'];
const SCHEDULE_TABLES = ['timetables', 'timetable_slots', 'timetable_lessons', 'outside_classes', 'outside_class_children', 'outside_class_exceptions'];
const STUDY_TABLES = ['word_study_plans', 'word_study_states', 'word_study_days', 'word_study_batches', 'word_study_items', 'word_study_attempts'];
const HOMEWORK_TABLES = ['homework_records', 'homework_course_points', 'homework_sessions', 'homework_session_days'];
const TABLES = [...REQUIRED_TABLES, 'template_children', 'reward_items', 'reward_redemptions', ...PERIOD_TABLES, 'task_skip_requests', ...SCHEDULE_TABLES, 'makeup_days', 'task_backfill_events', 'task_day_snapshots', ...STUDY_TABLES, ...HOMEWORK_TABLES, 'study_legacy_corrections', 'outside_class_attendance', 'outside_class_fees', 'outside_class_changes'];
// Backups (format v2) hold the database and a manifest of its photos; the photos themselves are kept
// once in backups/photos and move between servers as separate photo packages. This limit therefore
// applies to the database alone. Older v1 archives with embedded photos still restore under it.
const MAX_SIZE = 256 * 1024 * 1024;
// A gzip archive is never larger than its JSON, so accepting MAX_SIZE uploads lets every backup this
// service creates be restored through the app.
const MAX_UPLOAD_SIZE = MAX_SIZE;
// Photo packages are streamed, so they have no practical size limit; one photo is at most 10 MiB.
const MAX_PHOTO_PACKAGE_SIZE = 64 * 1024 * 1024 * 1024;
const MAX_PHOTO_SIZE = 20 * 1024 * 1024;
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

  // Photos the current records refer to whose files are not in the upload directory, e.g. after
  // restoring a backup on a new server before its photo package was imported.
  missingPhotos() {
    return this.referencedPhotos().filter(name => safeName(name) && !fs.existsSync(path.join(this.uploadDir, name)));
  }

  readArchive(file) {
    return JSON.parse(gunzipSync(fs.readFileSync(file), { maxOutputLength: MAX_SIZE }).toString());
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
    // the photos it refers to. Only photos new since the last backup are read (to hash them).
    const manifest = [];
    const missing = [];
    for (const name of this.referencedPhotos()) {
      if (!safeName(name)) throw fail('照片路径无效，无法备份');
      const file = path.join(this.uploadDir, name);
      // A photo already lost on disk must not stop every later backup of the remaining data.
      if (!fs.existsSync(file)) { missing.push(name); continue; }
      manifest.push(this.photos.add(name, file));
    }
    this.photos.save();
    const database = this.db.serialize().toString('base64');
    const data = Buffer.from(JSON.stringify({ format: 'taskie-backup', version: 2, created_at: new Date().toISOString(), reason, database, photo_manifest: manifest, missing_photos: missing }));
    if (data.length > MAX_SIZE) throw fail('备份数据超过 256 MiB，请使用 NAS 文件备份');
    const name = `backup-${new Date().toISOString().replace(/[:.Z]/g, '-')}-${randomUUID()}.taskie.gz`;
    const target = path.join(this.backupDir, name);
    fs.writeFileSync(`${target}.tmp`, gzipSync(data), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
    this.lastError = null;
    this.lastWarning = missing.length ? `${missing.length} 张错题照片文件已丢失，备份中只保留了它们的记录：${missing.slice(0, 5).join('、')}${missing.length > 5 ? ' 等' : ''}` : null;
    for (const old of this.list().filter(item => item.name !== name).slice(this.retention - 1)) fs.unlinkSync(this.getPath(old.name));
    this.prunePhotos();
    return this.list().find(item => item.name === name);
  }

  // Stored photos stay while the current data or any retained backup refers to them.
  prunePhotos() {
    const keep = new Set(this.referencedPhotos());
    for (const item of this.list()) {
      try {
        for (const photo of this.readArchive(path.join(this.backupDir, item.name)).photo_manifest || []) keep.add(photo.name);
      } catch (error) {
        console.error('    [Backup] 读取备份清单失败，本次不清理照片:', item.name, error.message);
        return;
      }
    }
    this.photos.prune(keep);
    this.photos.save();
  }

  // A tar of the photos the current records refer to, optionally only those added since a time,
  // streamed straight from disk.
  exportPhotos(since = null) {
    const after = since ? Date.parse(since) : null;
    const entries = this.referencedPhotos().filter(safeName).map(name => ({ name, file: path.join(this.uploadDir, name) }))
      .filter(({ file }) => { try { return after === null || fs.statSync(file).mtimeMs > after; } catch { return false; } })
      .sort((a, b) => a.name.localeCompare(b.name));
    return tarStream(entries);
  }

  // Adds photos from a package that the current records refer to but are missing. Existing photos are
  // never replaced, so importing an old or unrelated package is harmless.
  async importPhotos(stream) {
    const result = { imported: 0, present: 0, unused: 0, skipped: 0 };
    const referenced = new Set(this.referencedPhotos());
    const reader = new TarReader((name, content) => {
      if (!safeName(name)) { result.skipped++; return; }
      if (!referenced.has(name)) { result.unused++; return; }
      const file = path.join(this.uploadDir, name);
      if (fs.existsSync(file)) { result.present++; return; }
      const temp = path.join(this.uploadDir, `.import-${randomUUID()}`);
      fs.writeFileSync(temp, content, { mode: 0o600 });
      fs.renameSync(temp, file);
      this.photos.add(name, file);
      result.imported++;
    }, { maxFileSize: MAX_PHOTO_SIZE });
    try {
      for await (const chunk of stream) reader.push(chunk);
      if (stream.truncated) throw Object.assign(new Error('照片包过大'), { statusCode: 413 });
      reader.end();
    } finally {
      this.photos.save();
    }
    result.skipped += reader.skipped;
    return { ...result, missing: this.missingPhotos().length };
  }

  restore(buffer) {
    let data, candidate;
    try {
      data = JSON.parse(gunzipSync(buffer, { maxOutputLength: MAX_SIZE }).toString());
      const validManifest = list => Array.isArray(list) && list.every(p => p && safeName(p.name) && Number.isSafeInteger(p.size) && p.size >= 0 && /^[0-9a-f]{64}$/.test(p.sha256));
      if (data.format !== 'taskie-backup' || ![1, 2].includes(data.version) || typeof data.database !== 'string' ||
        (data.version === 1 && (!data.photos || Array.isArray(data.photos))) || (data.version === 2 && !validManifest(data.photo_manifest)) ||
        (data.missing_photos !== undefined && (!Array.isArray(data.missing_photos) || !data.missing_photos.every(safeName)))) throw fail('不是有效的 Taskie 备份包');
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
      if (!candidate.prepare("SELECT value FROM settings WHERE key = 'parent_pin_hash'").get()) throw fail('备份缺少家长账号');
      initDb(candidate);
      for (const [name, value] of Object.entries(data.photos || {})) {
        if (!safeName(name) || typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw fail('备份照片路径或内容无效');
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
