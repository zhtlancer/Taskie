// Minimal ustar support for photo packages: regular files only, streamed both ways so a package of any
// size never has to fit in memory. Standard tools (tar, 7-Zip, macOS Archive Utility) read and write it.
const fs = require('node:fs');
const { Readable } = require('node:stream');

const BLOCK = 512;
const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';

function header(name, size, mtime) {
  const block = Buffer.alloc(BLOCK);
  block.write(name, 0, 100, 'utf8');
  block.write(octal(0o644, 8), 100, 'ascii');
  block.write(octal(0, 8), 108, 'ascii');
  block.write(octal(0, 8), 116, 'ascii');
  block.write(octal(size, 12), 124, 'ascii');
  block.write(octal(Math.floor(mtime / 1000), 12), 136, 'ascii');
  block.fill(' ', 148, 156);
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(octal(sum, 7) + ' ', 148, 'ascii');
  return block;
}

// entries: [{ name, file }], read lazily as the stream is consumed.
function tarStream(entries) {
  return Readable.from((async function* () {
    for (const { name, file } of entries) {
      let stat;
      try { stat = fs.statSync(file); } catch { continue; } // removed meanwhile: leave it out
      yield header(name, stat.size, stat.mtimeMs);
      let written = 0;
      for await (const chunk of fs.createReadStream(file, { end: stat.size - 1 })) { written += chunk.length; yield chunk; }
      if (written !== stat.size) throw new Error(`照片 ${name} 在打包时被修改`);
      if (stat.size % BLOCK) yield Buffer.alloc(BLOCK - stat.size % BLOCK);
    }
    yield Buffer.alloc(BLOCK * 2);
  })(), { objectMode: false });
}

// Feeds chunks in; calls onFile(name, buffer) for each regular file up to maxFileSize. Larger files,
// directories and extended headers are skipped. The name is the last path component.
class TarReader {
  constructor(onFile, { maxFileSize }) {
    Object.assign(this, { onFile, maxFileSize, pending: Buffer.alloc(0), entry: null, ended: false, skipped: 0 });
  }

  push(chunk) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    for (;;) {
      if (this.ended) { this.pending = Buffer.alloc(0); return; }
      if (!this.entry) {
        if (this.pending.length < BLOCK) return;
        const block = this.pending.subarray(0, BLOCK);
        this.pending = this.pending.subarray(BLOCK);
        if (block.every(byte => byte === 0)) { this.ended = true; continue; }
        const field = (start, length) => block.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
        let sum = 0;
        for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
        if (parseInt(field(148, 8).trim(), 8) !== sum) throw Object.assign(new Error('照片包格式不正确（应为 .tar 文件）'), { statusCode: 400 });
        const size = parseInt(field(124, 12).trim() || '0', 8);
        const type = field(156, 1) || '0';
        const prefix = field(345, 155);
        const name = (prefix ? `${prefix}/` : '') + field(0, 100);
        const keep = type === '0' && size <= this.maxFileSize;
        if (!keep && type === '0') this.skipped++;
        this.entry = { name: name.split('/').pop(), size, padded: Math.ceil(size / BLOCK) * BLOCK, keep, parts: [], read: 0 };
        continue;
      }
      const { entry } = this;
      const take = Math.min(entry.padded - entry.read, this.pending.length);
      // Directories and empty files have no data blocks and complete at once.
      if (take === 0 && entry.padded > 0) return;
      if (entry.keep && entry.read < entry.size) entry.parts.push(this.pending.subarray(0, Math.min(take, entry.size - entry.read)));
      entry.read += take;
      this.pending = this.pending.subarray(take);
      if (entry.read < entry.padded) return;
      this.entry = null;
      if (entry.keep) this.onFile(entry.name, Buffer.concat(entry.parts));
    }
  }

  end() {
    if (this.entry) throw Object.assign(new Error('照片包不完整，可能没有下载完'), { statusCode: 400 });
  }
}

module.exports = { tarStream, TarReader };
