const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Mistake photos are never changed after upload, so backups keep each one once here instead of
// inside every daily archive. Copies are clones where the file system supports them (Btrfs, the
// Synology default, and XFS: no extra space, yet independent of the original) and full copies
// elsewhere; never hard links, which a file edited in place would change on both sides.
// index.json remembers each photo's size and SHA-256 so daily backups do not re-read every photo.
const cloneFile = (source, target) => fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);

class PhotoStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.indexPath = path.join(dir, 'index.json');
    try { this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch { this.index = {}; }
  }

  path(name) { return path.join(this.dir, name); }

  // The stored copy of a photo, with its size and hash, or null if it is not (correctly) here.
  entry(name) {
    const file = this.path(name);
    let stat;
    try { stat = fs.statSync(file); } catch { return null; }
    // Recheck bytes when using a stored object; a same-size external edit is still corruption.
    this.index[name] = { size: stat.size, sha256: hashFile(file) };
    this.dirty = true;
    return { name, ...this.index[name] };
  }

  add(name, source) {
    const existing = this.entry(name);
    if (existing && existing.size === fs.statSync(source).size && existing.sha256 === hashFile(source)) return existing;
    const temp = path.join(this.dir, `.${randomUUID()}.tmp`);
    cloneFile(source, temp);
    fs.renameSync(temp, this.path(name));
    delete this.index[name];
    return this.entry(name);
  }

  // Keep only the photos some retained backup or the current data still refers to.
  prune(keep) {
    for (const name of fs.readdirSync(this.dir)) {
      if (name === 'index.json' || keep.has(name)) continue;
      fs.rmSync(this.path(name), { force: true });
      if (this.index[name]) { delete this.index[name]; this.dirty = true; }
    }
    for (const name of Object.keys(this.index)) if (!keep.has(name)) { delete this.index[name]; this.dirty = true; }
  }

  save() {
    if (!this.dirty) return;
    const temp = `${this.indexPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.index), { mode: 0o600 });
    fs.renameSync(temp, this.indexPath);
    this.dirty = false;
  }
}

module.exports = { PhotoStore, hashFile, cloneFile };
