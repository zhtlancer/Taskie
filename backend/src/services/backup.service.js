const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { initDb } = require('../db');

// Only genuine older schemas may have their newer tables created by initDb.
const REQUIRED_TABLES = ['children', 'task_templates', 'daily_tasks', 'point_logs', 'badge_definitions', 'child_badges', 'mistake_records', 'settings', 'characters'];
const PERIOD_TABLES = ['periods', 'period_paused_templates', 'period_tasks', 'period_task_logs'];
const TABLES = [...REQUIRED_TABLES, 'template_children', 'reward_items', 'reward_redemptions', ...PERIOD_TABLES];
const MAX_SIZE = 256 * 1024 * 1024;
const fail = message => Object.assign(new Error(message), { statusCode: 400 });
const safeName = name => typeof name === 'string' && /^[\w-]+\.(?:jpg|jpeg|png|webp)$/i.test(name);

class BackupService {
  constructor(db, uploadDir, backupDir, retention = 7) {
    this.db = db;
    this.uploadDir = path.resolve(uploadDir);
    this.backupDir = path.resolve(backupDir);
    this.retention = Math.max(1, Math.min(100, Math.floor(Number(retention) || 7)));
    this.lastError = null;
    fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
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
    // Serialization and file reads are synchronous: application writes cannot
    // interleave with the database snapshot and its referenced photos.
    const photos = {};
    let size = 0;
    for (const { photo_path } of this.db.prepare("SELECT DISTINCT photo_path FROM mistake_records WHERE photo_path LIKE '/uploads/%'").all()) {
      const name = photo_path.slice('/uploads/'.length);
      if (!safeName(name)) throw fail('照片路径无效，无法备份');
      const file = path.join(this.uploadDir, name);
      if (!fs.existsSync(file)) throw fail(`照片 ${name} 不存在，备份未创建`);
      size += fs.statSync(file).size;
      if (size > MAX_SIZE / 1.5) throw fail('备份数据超过 256 MiB，请使用 NAS 文件备份');
      photos[name] = fs.readFileSync(file).toString('base64');
    }
    const database = this.db.serialize().toString('base64');
    const data = Buffer.from(JSON.stringify({ format: 'taskie-backup', version: 1, created_at: new Date().toISOString(), reason, database, photos }));
    if (data.length > MAX_SIZE) throw fail('备份数据超过 256 MiB，请使用 NAS 文件备份');
    const name = `backup-${new Date().toISOString().replace(/[:.Z]/g, '-')}-${randomUUID()}.taskie.gz`;
    const target = path.join(this.backupDir, name);
    fs.writeFileSync(`${target}.tmp`, gzipSync(data), { mode: 0o600 });
    fs.renameSync(`${target}.tmp`, target);
    this.lastError = null;
    for (const old of this.list().filter(item => item.name !== name).slice(this.retention - 1)) fs.unlinkSync(this.getPath(old.name));
    return this.list().find(item => item.name === name);
  }

  restore(buffer) {
    let data, candidate;
    try {
      data = JSON.parse(gunzipSync(buffer, { maxOutputLength: MAX_SIZE }).toString());
      if (data.format !== 'taskie-backup' || data.version !== 1 || typeof data.database !== 'string' || !data.photos || Array.isArray(data.photos)) throw fail('不是有效的 Taskie 备份包');
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
      if (!candidate.prepare("SELECT value FROM settings WHERE key = 'parent_pin_hash'").get()) throw fail('备份缺少家长账号');
      initDb(candidate);
      for (const [name, value] of Object.entries(data.photos)) {
        if (!safeName(name) || typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw fail('备份照片路径或内容无效');
      }
      for (const { photo_path } of candidate.prepare("SELECT photo_path FROM mistake_records WHERE photo_path LIKE '/uploads/%'").all()) {
        if (!Object.hasOwn(data.photos, photo_path.slice('/uploads/'.length))) throw fail('备份缺少关联照片');
      }
    } catch (error) {
      if (candidate) candidate.close();
      throw fail(error.statusCode ? error.message : '备份包损坏或无法读取');
    }

    const staging = `${this.uploadDir}.restore-${randomUUID()}`;
    const previous = `${this.uploadDir}.previous-${randomUUID()}`;
    const saved = path.join(this.backupDir, `.restore-${randomUUID()}.sqlite`);
    let moved = false, installed = false, attached = false;
    try {
      fs.mkdirSync(staging, { recursive: true });
      for (const [name, content] of Object.entries(data.photos)) fs.writeFileSync(path.join(staging, name), Buffer.from(content, 'base64'), { mode: 0o600 });
      fs.writeFileSync(saved, candidate.serialize(), { mode: 0o600 });
      candidate.close();
      candidate = null;
      const recovery = this.create('before-restore');
      const secrets = this.db.prepare("SELECT key, value FROM settings WHERE key IN ('jwt_secret')").all();
      this.db.prepare('ATTACH DATABASE ? AS recovery').run(saved);
      attached = true;
      this.db.pragma('foreign_keys = OFF');
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
        if (this.db.pragma('foreign_key_check').length) throw fail('恢复数据关联检查失败');
      })();
      moved = false;
      return { success: true, recovery_backup: recovery.name, requires_login: true };
    } catch (error) {
      if (moved) {
        if (installed) fs.renameSync(this.uploadDir, staging);
        fs.renameSync(previous, this.uploadDir);
      }
      throw error;
    } finally {
      if (candidate) candidate.close();
      if (attached) this.db.exec('DETACH DATABASE recovery');
      this.db.pragma('foreign_keys = ON');
      fs.rmSync(staging, { recursive: true, force: true });
      if (!moved) fs.rmSync(previous, { recursive: true, force: true });
      fs.rmSync(saved, { force: true });
    }
  }
}

module.exports = BackupService;
