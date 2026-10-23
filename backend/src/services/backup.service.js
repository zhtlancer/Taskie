const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { PhotoStore, fileEntry } = require('./photo-store');
const { Worker } = require('node:worker_threads');
const { MAX_PHOTO_SIZE } = require('../utils/photo-limits');
const { tarStream, TarReader } = require('../utils/tar');

const { TABLES } = require('./backup-format');
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
    for (const leftover of [journal.previous, journal.staging, journal.saved, journal.archive].filter(Boolean)) fs.rmSync(leftover, { recursive: true, force: true });
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
      const entry = await this.inspectExportPhoto(name, photo);
      if (entry) entries.push({ name, photo: photo || { size: entry.size, sha256: entry.sha256 }, file: entry.file, sha256: entry.sha256 });
      else {
        const row = details.get(name);
        entries.skipped.push({ name, subject: row?.subject || '', description: row?.description || '', created_at: row?.created_at || null,
          reason: [this.photos.path(name), path.join(this.uploadDir, name)].some(file => fs.existsSync(file)) ? 'mismatch' : 'absent' });
      }
    }
    return entries;
  }

  async inspectExportPhoto(name, photo) {
    // Ticket/status inspection reuses fingerprints. Changed or uncached files are hashed
    // once here; the actual download always verifies fresh bytes before emitting a header.
    for (const [file, cache, key] of [[this.photos.path(name), this.photos.index, name],
      [path.join(this.uploadDir, name), this.uploadIndex, path.join(this.uploadDir, name)]]) {
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile() || stat.size > MAX_PHOTO_SIZE || photo && stat.size !== photo.size) continue;
        const entry = await fileEntry(file, cache, key);
        if (entry && (!photo || entry.size === photo.size && entry.sha256 === photo.sha256)) return { file, ...entry };
      } catch { /* Try the other copy. Actual export never trusts cached bytes. */ }
    }
    return null;
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
    const { manifests, unreadable } = await this.readableRetainedManifests();
    for (const retained of manifests) for (const name of retained.photos) names.add(name);
    return { last_complete_at: state.last_complete_at, exported_count: [...names].filter(name => exported.has(name)).length,
      pending_count: [...names].filter(name => !exported.has(name)).length,
      ...(unreadable.length ? { unreadable_backups: unreadable } : {}) };
  }

  // Recovery and status remain usable when one archive is damaged. Export and pruning
  // stay strict: an unreadable manifest must never silently omit or delete its photos.
  async readableRetainedManifests() {
    const manifests = [], unreadable = [];
    for (const item of this.list()) {
      try { manifests.push(await this.retainedManifest(item.name)); }
      catch (error) {
        unreadable.push(item.name);
        console.warn('    [Backup] 无法读取备份清单，跳过该清单:', item.name, error.message);
      }
    }
    return { manifests, unreadable };
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
    const current = new Set(this.referencedPhotos()), referenced = new Set(current), expected = this.expectations();
    // A deleted mistake may still be part of a retained backup. Its manifest remains the
    // authoritative source for both whether the photo is wanted and which bytes are trusted.
    const { manifests, unreadable } = await this.readableRetainedManifests();
    for (const retained of manifests) {
      for (const name of retained.photos) referenced.add(name);
      for (const photo of retained.manifest) {
        const previous = expected.get(photo.name);
        if (previous && (previous.size !== photo.size || previous.sha256 !== photo.sha256)) {
          throw fail('照片清单存在同名不同内容，请检查备份');
        }
        expected.set(photo.name, photo);
      }
    }
    const pending = [];
    const reader = new TarReader((name, content) => pending.push({ name, content }), { maxFileSize: MAX_PHOTO_SIZE });
    const install = async (name, content) => {
      if (!safeName(name)) { result.skipped++; return; }
      if (!referenced.has(name)) {
        // An unreadable backup may still need this photo; do not call it unnecessary.
        if (unreadable.length) result.skipped++; else result.unused++;
        return;
      }
      const photo = expected.get(name);
      // A legacy missing_photos entry has no trusted bytes or digest. Never guess by filename.
      if (!photo) { result.unverified++; return; }
      if (content.length !== photo.size || createHash('sha256').update(content).digest('hex') !== photo.sha256) { result.mismatch++; return; }
      if (!current.has(name)) {
        // Retained-only photos belong in the store so retention can reclaim them later.
        // Force a fresh digest before add(), including when its metadata cache is stale.
        const stored = await this.photos.entry(name, true);
        if (stored && stored.size === photo.size && stored.sha256 === photo.sha256) { result.present++; return; }
        const temp = path.join(this.photos.dir, `.import-${randomUUID()}`);
        try {
          fs.writeFileSync(temp, content, { mode: 0o600 });
          await this.photos.add(name, temp, photo);
        } finally { fs.rmSync(temp, { force: true }); }
        result.imported++;
        return;
      }
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
    return { ...result, missing, ...(unreadable.length ? { unreadable_backups: unreadable } : {}) };
  }

  restore(buffer) { return this.exclusive(() => this.restoreSnapshot(buffer)); }

  async restoreSnapshot(buffer) {
    const restoreId = randomUUID();
    const staging = `${this.uploadDir}.restore-${restoreId}`;
    const previous = `${this.uploadDir}.previous-${restoreId}`;
    const saved = path.join(this.backupDir, `.restore-${restoreId}.sqlite`);
    const archive = path.join(this.backupDir, `.restore-${restoreId}.taskie.gz`);
    let moved = false, installed = false, attached = false, journaled = false;
    // A v2 backup's photos come from the photo store or the current upload directory, checked against
    // its manifest; photos found in neither are reported and can be added later from a photo package.
    try {
      fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(archive, buffer, { mode: 0o600 });
      const data = await new Promise((resolve, reject) => {
        const worker = new Worker(path.join(__dirname, '../utils/restore-worker.js'), { workerData: {
          archive, saved, staging, maxSize: MAX_SIZE, currentSchemaVersion: this.db.pragma('user_version', { simple: true })
        } });
        let message, workerError;
        worker.once('message', value => { message = value; });
        worker.once('error', error => { workerError = error; });
        worker.once('exit', code => {
          if (workerError || code || !message) reject(fail('备份包损坏或无法读取'));
          else if (message.error) reject(fail(message.error));
          else resolve(message.result);
        });
      });
      const unavailable = [...data.missing_photos];
      for (const photo of data.photo_manifest || []) {
        let source;
        for (const file of [this.photos.path(photo.name), path.join(this.uploadDir, photo.name)]) {
          if (await this.matches(file, photo, true)) { source = file; break; }
        }
        if (!source) { unavailable.push(photo.name); continue; }
        await fs.promises.copyFile(source, path.join(staging, photo.name), fs.constants.COPYFILE_FICLONE);
        if (!await this.matches(path.join(staging, photo.name), photo, true)) throw fail('照片在恢复时被修改');
      }
      const recovery = await this.createSnapshot('before-restore');
      const secrets = this.db.prepare("SELECT key, value FROM settings WHERE key IN ('jwt_secret')").all();
      this.db.prepare('ATTACH DATABASE ? AS recovery').run(saved);
      attached = true;
      this.db.pragma('foreign_keys = OFF');
      this.writeJournal({ id: restoreId, previous, staging, saved, archive });
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
      if (attached) this.db.exec('DETACH DATABASE recovery');
      this.db.pragma('foreign_keys = ON');
      await fs.promises.rm(staging, { recursive: true, force: true });
      if (!moved) await fs.promises.rm(previous, { recursive: true, force: true });
      await fs.promises.rm(saved, { force: true });
      await fs.promises.rm(archive, { force: true });
      // Done or rolled back: nothing is left for a restart to finish.
      if (journaled && !moved) fs.rmSync(this.journalPath, { force: true });
    }
  }
}

module.exports = BackupService;
module.exports.MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE;
module.exports.MAX_PHOTO_PACKAGE_SIZE = MAX_PHOTO_PACKAGE_SIZE;
