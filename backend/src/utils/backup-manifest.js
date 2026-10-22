const fs = require('node:fs');
const { Gunzip } = require('fflate');
const { StringDecoder } = require('node:string_decoder');

// Read a retained archive synchronously without materializing its base64 database or v1 photos.
// The projection retains only JSON structure and small metadata strings. Feeding 1 KiB compressed
// chunks bounds the inflate output even for highly compressible legacy photo payloads.
function readManifest(file, maxSize) {
  let output = '', token = '', inString = false, escaped = false, keep = false, isKey = false;
  let last = '', total = 0, crc = 0xffffffff;
  const stack = [], decoder = new StringDecoder('utf8');
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const consume = text => {
    for (const ch of text) {
      if (inString) {
        if (!escaped && ch === '"') {
          const value = keep ? token : '';
          output += `"${value}"`;
          if (isKey) stack.at(-1).key = JSON.parse(`"${value}"`);
          inString = false; last = 'string';
        } else {
          if (keep) { token += ch; if (token.length > 1024) throw new Error('备份清单字符串过长'); }
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
        }
      } else if (ch === '"') {
        isKey = stack.at(-1)?.type === '{' && (last === '{' || last === ',');
        keep = isKey || !(stack.length === 1 && stack[0].key === 'database' || stack.length === 2 && stack[0].key === 'photos');
        token = ''; inString = true;
      } else {
        output += ch;
        if (ch === '{' || ch === '[') stack.push({ type: ch });
        else if (ch === '}' || ch === ']') stack.pop();
        if (!/\s/.test(ch)) last = ch;
      }
    }
    if (output.length > 16 * 1024 * 1024) throw new Error('备份清单过大');
  };
  const gunzip = new Gunzip(chunk => {
    total += chunk.length;
    if (total > maxSize) throw new Error('备份解压数据过大');
    for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    consume(decoder.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
  });
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(1024), footer = Buffer.alloc(8);
    if (size < 18) throw new Error('备份压缩数据不完整');
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
      if (!count) throw new Error('备份读取不完整');
      offset += count;
      gunzip.push(buffer.subarray(0, count), offset === size);
    }
    consume(decoder.end());
    fs.readSync(fd, footer, 0, 8, size - 8);
    if (footer.readUInt32LE(0) !== ((crc ^ 0xffffffff) >>> 0) || footer.readUInt32LE(4) !== total) throw new Error('备份压缩校验失败');
  } finally { fs.closeSync(fd); }
  const data = JSON.parse(output);
  if (data.format !== 'taskie-backup' || ![1, 2].includes(data.version)) throw new Error('备份格式无效');
  return {
    photos: data.version === 1 ? Object.keys(data.photos || {}) : (data.photo_manifest || []).map(p => p.name),
    manifest: data.photo_manifest || []
  };
}

module.exports = { readManifest };
