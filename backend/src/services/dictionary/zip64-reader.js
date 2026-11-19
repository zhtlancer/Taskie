const fs = require('node:fs');
const zlib = require('node:zlib');

const EOCD_SIG = 0x06054b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const CD_FILE_SIG = 0x02014b50;
const LOCAL_FILE_SIG = 0x04034b50;

function readExact(fd, length, position) {
  const buf = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const read = fs.readSync(fd, buf, offset, length - offset, position + offset);
    if (read <= 0) throw new Error('Unexpected EOF reading ZIP archive');
    offset += read;
  }
  return buf;
}

function locateCentralDirectory(fd, fileSize) {
  const tailSize = Math.min(fileSize, 65558);
  const tailOffset = fileSize - tailSize;
  const tail = readExact(fd, tailSize, tailOffset);

  let eocdPos = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      const commentLen = tail.readUInt16LE(i + 20);
      if (i + 22 + commentLen <= tail.length) {
        eocdPos = i;
        break;
      }
    }
  }
  if (eocdPos < 0) throw new Error('ZIP End-of-Central-Directory not found');

  let totalEntries = tail.readUInt16LE(eocdPos + 10);
  let cdSize = tail.readUInt32LE(eocdPos + 12);
  let cdOffset = tail.readUInt32LE(eocdPos + 16);

  const locatorFilePos = tailOffset + eocdPos - 20;
  if (locatorFilePos >= 0) {
    const locator = readExact(fd, 20, locatorFilePos);
    if (locator.readUInt32LE(0) === ZIP64_LOCATOR_SIG) {
      const z64EocdOffset = Number(locator.readBigUInt64LE(8));
      const z64 = readExact(fd, 56, z64EocdOffset);
      if (z64.readUInt32LE(0) !== ZIP64_EOCD_SIG) throw new Error('Invalid ZIP64 EOCD signature');
      totalEntries = Number(z64.readBigUInt64LE(32));
      cdSize = Number(z64.readBigUInt64LE(40));
      cdOffset = Number(z64.readBigUInt64LE(48));
    }
  }

  return { totalEntries, cdSize, cdOffset };
}

/**
 * Iterate Central Directory entries in a ZIP or ZIP64 archive without loading entry payloads.
 */
function scanZipCentralDirectory(zipPath, onEntry) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const { cdSize, cdOffset } = locateCentralDirectory(fd, size);
    const cd = readExact(fd, cdSize, cdOffset);
    let pos = 0;
    let count = 0;
    while (pos + 46 <= cd.length) {
      if (cd.readUInt32LE(pos) !== CD_FILE_SIG) break;
      const flags = cd.readUInt16LE(pos + 8);
      const method = cd.readUInt16LE(pos + 10);
      let compSize = cd.readUInt32LE(pos + 20);
      let uncompSize = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      let localHeaderOffset = cd.readUInt32LE(pos + 42);

      const utf8 = (flags & 0x0800) !== 0;
      const nameBuf = cd.subarray(pos + 46, pos + 46 + nameLen);
      const filename = nameBuf.toString(utf8 ? 'utf8' : 'latin1');

      if (compSize === 0xffffffff || uncompSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        const extra = cd.subarray(pos + 46 + nameLen, pos + 46 + nameLen + extraLen);
        let ep = 0;
        while (ep + 4 <= extra.length) {
          const headerId = extra.readUInt16LE(ep);
          const dataSize = extra.readUInt16LE(ep + 2);
          ep += 4;
          if (headerId === 0x0001 && ep + dataSize <= extra.length) {
            let fp = ep;
            if (uncompSize === 0xffffffff && fp + 8 <= ep + dataSize) {
              uncompSize = Number(extra.readBigUInt64LE(fp));
              fp += 8;
            }
            if (compSize === 0xffffffff && fp + 8 <= ep + dataSize) {
              compSize = Number(extra.readBigUInt64LE(fp));
              fp += 8;
            }
            if (localHeaderOffset === 0xffffffff && fp + 8 <= ep + dataSize) {
              localHeaderOffset = Number(extra.readBigUInt64LE(fp));
            }
            break;
          }
          ep += dataSize;
        }
      }

      if (!filename.endsWith('/')) {
        onEntry({
          filename,
          method,
          compSize,
          uncompSize,
          localHeaderOffset
        });
        count += 1;
      }
      pos += 46 + nameLen + extraLen + commentLen;
    }
    return count;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract a single entry payload from a ZIP/ZIP64 file using its Central Directory metadata.
 */
function readZipEntry(zipPath, meta) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const localHeader = readExact(fd, 30, meta.localHeaderOffset);
    if (localHeader.readUInt32LE(0) !== LOCAL_FILE_SIG) {
      throw new Error('Invalid ZIP local header signature');
    }
    const nameLen = localHeader.readUInt16LE(26);
    const extraLen = localHeader.readUInt16LE(28);
    const dataPos = meta.localHeaderOffset + 30 + nameLen + extraLen;
    const raw = readExact(fd, meta.compSize, dataPos);
    if (meta.method === 0) return raw;
    if (meta.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`Unsupported ZIP compression method: ${meta.method}`);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Unwrap OALD8 RIFF WAVE containers holding MP3 frames (wFormatTag = 0x55) to raw audio/mpeg,
 * and keep PCM WAV / MP3 / image resources in browser-native formats without external tools.
 */
function unwrapMediaResource(filename, buffer) {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return { contentType: 'image/jpeg', ext: 'jpg', buffer };
  }
  if (lower.endsWith('.png')) {
    return { contentType: 'image/png', ext: 'png', buffer };
  }
  if (lower.endsWith('.webp')) {
    return { contentType: 'image/webp', ext: 'webp', buffer };
  }
  if (lower.endsWith('.mp3')) {
    return { contentType: 'audio/mpeg', ext: 'mp3', buffer };
  }
  if (lower.endsWith('.ogg')) {
    return { contentType: 'audio/ogg', ext: 'ogg', buffer };
  }

  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') {
    let pos = 12;
    let formatTag = null;
    let dataChunk = null;
    while (pos + 8 <= buffer.length) {
      const id = buffer.toString('ascii', pos, pos + 4);
      const size = buffer.readUInt32LE(pos + 4);
      const bodyStart = pos + 8;
      const bodyEnd = Math.min(buffer.length, bodyStart + size);
      if (id === 'fmt ' && size >= 2 && bodyEnd - bodyStart >= 2) {
        formatTag = buffer.readUInt16LE(bodyStart);
      } else if (id === 'data') {
        dataChunk = buffer.subarray(bodyStart, bodyEnd);
      }
      pos = bodyStart + size + (size % 2);
    }

    if (formatTag === 0x55 && dataChunk && dataChunk.length >= 2) {
      return { contentType: 'audio/mpeg', ext: 'mp3', buffer: dataChunk };
    }
    return { contentType: 'audio/wav', ext: 'wav', buffer };
  }

  if (buffer.length >= 3 && (buffer.toString('ascii', 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0))) {
    return { contentType: 'audio/mpeg', ext: 'mp3', buffer };
  }

  return { contentType: 'application/octet-stream', ext: 'bin', buffer };
}

module.exports = {
  scanZipCentralDirectory,
  readZipEntry,
  unwrapMediaResource
};
