const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const fingerprint = stat => ({ size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, ino: stat.ino, dev: stat.dev });
const same = (a, b) => a && Object.keys(b).every(key => a[key] === b[key]);

// Cache metadata only: changing a file invalidates the digest. Integrity boundaries explicitly
// bypass this cache, including edits that preserve size, timestamps or a forged index.json.
async function fileEntry(file, cache, key, verify = false) {
  let stat;
  try { stat = await fs.promises.stat(file); } catch (error) {
    if (error.code === 'ENOENT') { delete cache[key]; return null; }
    throw error;
  }
  if (!stat.isFile()) return null;
  const stamp = fingerprint(stat), previous = cache[key];
  if (!verify && same(previous, stamp) && /^[a-f0-9]{64}$/.test(previous.sha256)) return { size: previous.size, sha256: previous.sha256 };
  const sha256 = await hashFile(file);
  if (!same(stamp, fingerprint(await fs.promises.stat(file)))) throw new Error('照片在校验时被修改');
  cache[key] = { ...stamp, sha256 };
  return { size: stamp.size, sha256 };
}

// Independent copies (CoW where supported), never hard links. Persist fingerprints so the first
// normal backup after restart also avoids re-reading unchanged photos.
class PhotoStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.indexPath = path.join(dir, 'index.json');
    try { this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf8')); } catch { this.index = {}; }
  }
  path(name) { return path.join(this.dir, name); }
  async entry(name, verify = false) {
    const previous = this.index[name];
    const entry = await fileEntry(this.path(name), this.index, name, verify);
    if (this.index[name] !== previous) this.dirty = true;
    return entry && { name, ...entry };
  }
  async add(name, source, sourceEntry) {
    const photo = sourceEntry || await fileEntry(source, {}, name);
    if (!photo) return null;
    const existing = await this.entry(name);
    if (existing && existing.size === photo.size && existing.sha256 === photo.sha256) return existing;
    const temp = path.join(this.dir, `.${randomUUID()}.tmp`);
    try {
      const before = fingerprint(await fs.promises.stat(source));
      await fs.promises.copyFile(source, temp, fs.constants.COPYFILE_FICLONE);
      if (!same(before, fingerprint(await fs.promises.stat(source)))) throw new Error('照片在复制时被修改');
      await fs.promises.rename(temp, this.path(name));
      // Reuse the digest only for this stable copy. Integrity operations still bypass the cache.
      const stamp = fingerprint(await fs.promises.stat(this.path(name)));
      this.index[name] = { ...stamp, sha256: photo.sha256 };
      this.dirty = true;
      return { name, size: photo.size, sha256: photo.sha256 };
    } finally { await fs.promises.rm(temp, { force: true }); }
  }
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
module.exports = { PhotoStore, hashFile, fileEntry };
