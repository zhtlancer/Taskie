const fs = require('node:fs');
const zlib = require('node:zlib');

const POS_MAP = {
  0x30: 'n.',
  0x31: 'adj.',
  0x32: 'v.',
  0x33: 'adv.',
  0x34: 'int.',
  0x35: 'pron.',
  0x36: 'prep.',
  0x37: 'conj.',
  0x38: 'n.',
  0x39: 'pref.',
  0x3a: 'art.'
};

function decodeBE(buf, count) {
  let value = 0;
  for (let i = 0; i < count; i++) value = (value * 256) + buf[i];
  return value;
}

function decodeHtmlAndCharset(text) {
  if (!text) return '';
  return text
    .replace(/<charset\s+c=T>([0-9a-fA-F;]+)<\/charset>/gi, (_, hexList) => (
      hexList
        .split(';')
        .filter(Boolean)
        .map(h => String.fromCharCode(parseInt(h, 16)))
        .join('')
    ))
    .replace(/<br\s*\/?>/gi, '; ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[\x00-\x1f]/g, '')
    .trim();
}

function parseMeta(metaRaw, dec) {
  let posLabel = null;
  let phonetic = null;
  let i = 0;
  while (i < metaRaw.length) {
    const tag = metaRaw[i];
    if (tag === 0x02 && i + 1 < metaRaw.length) {
      posLabel = POS_MAP[metaRaw[i + 1]] || posLabel;
      i += 2;
      continue;
    }
    if (tag === 0x1b && i + 1 < metaRaw.length) {
      // Phonetic field consumes remaining bytes up to control marker or end.
      const rawPhonetic = decodeHtmlAndCharset(dec.decode(metaRaw.subarray(i + 1)));
      if (rawPhonetic && !/\uFFFD/.test(rawPhonetic) && !/穚/.test(rawPhonetic)) {
        phonetic = rawPhonetic.replace(/^[\x00-\x1f\s]+/, '').trim();
      }
      break;
    }
    i += 1;
  }
  return { pos: posLabel, phonetic };
}

function parseTailInflections(tailRaw, dec) {
  const forms = [];
  let p = 0;
  while (p < tailRaw.length) {
    const len = tailRaw[p++];
    if (!len || p + len > tailRaw.length) break;
    const token = dec.decode(tailRaw.subarray(p, p + len)).trim();
    p += len;
    if (!token || token.startsWith('/') || /\$\d+\$/.test(token)) continue;
    if (/^[A-Za-z0-9'\-\s]+$/.test(token)) forms.push(token);
  }
  return forms;
}

/**
 * Parse all word entries from a Babylon .BGL dictionary file (sync, memory-bounded stream).
 */
function parseBglFile(filePath, onEntry) {
  const raw = fs.readFileSync(filePath);
  let gzPos = -1;
  for (let i = 4; i < Math.min(raw.length - 3, 512); i++) {
    if (raw[i] === 0x1f && raw[i + 1] === 0x8b && raw[i + 2] === 0x08) {
      gzPos = i;
      break;
    }
  }
  if (gzPos < 0) throw new Error(`Invalid BGL file header: ${filePath}`);
  const uncompressed = zlib.gunzipSync(raw.subarray(gzPos));
  const dec = new TextDecoder('gb18030');

  let pos = 0;
  let count = 0;
  while (pos < uncompressed.length) {
    const b = uncompressed[pos++];
    const type = b & 0x0f;
    const lenCode = b >> 4;
    let len;
    if (lenCode >= 4) len = lenCode - 4;
    else {
      const byteLen = lenCode + 1;
      len = decodeBE(uncompressed.subarray(pos, pos + byteLen), byteLen);
      pos += byteLen;
    }
    const data = uncompressed.subarray(pos, pos + len);
    pos += len;

    if (type !== 1 && type !== 10) continue;
    let dp = 0;
    const hLen = data[dp++];
    if (dp + hLen + 2 > data.length) continue;
    const rawHeadword = dec.decode(data.subarray(dp, dp + hLen)).trim();
    dp += hLen;
    const defLen = decodeBE(data.subarray(dp, dp + 2), 2);
    dp += 2;
    if (dp + defLen > data.length) continue;
    const defBuf = data.subarray(dp, dp + defLen);
    dp += defLen;
    const tailBuf = data.subarray(dp);

    const headword = rawHeadword.replace(/\$\d+\$$/, '').trim();
    if (!headword) continue;

    const sepIdx = defBuf.indexOf(0x14);
    const mainRaw = sepIdx >= 0 ? defBuf.subarray(0, sepIdx) : defBuf;
    const metaRaw = sepIdx >= 0 ? defBuf.subarray(sepIdx + 1) : Buffer.alloc(0);

    const definition = decodeHtmlAndCharset(dec.decode(mainRaw));
    if (!definition) continue;

    const { pos: posLabel, phonetic } = parseMeta(metaRaw, dec);
    const inflections = parseTailInflections(tailBuf, dec);

    onEntry({
      headword,
      pos: posLabel,
      phonetic,
      definition,
      inflections,
      order: count
    });
    count += 1;
  }
  return count;
}

function summarizeBglEntries(entries) {
  if (!entries || !entries.length) return '';
  const parts = [];
  const seen = new Set();
  for (const entry of entries) {
    // "#" separates domain/homograph senses inside BGL main string; keep the primary domain first.
    const cleanMain = String(entry.definition || '')
      .split('#')[0]
      .replace(/\s*;\s*/g, '；')
      .replace(/\s*,\s*/g, '，')
      .trim();
    if (!cleanMain) continue;
    const line = entry.pos ? `${entry.pos} ${cleanMain}` : cleanMain;
    if (seen.has(line)) continue;
    seen.add(line);
    parts.push(line);
  }
  const combined = parts.join('；');
  if (combined.length <= 96) return combined;
  return `${combined.slice(0, 93).replace(/[；，,;\s]+$/, '')}…`;
}

module.exports = {
  parseBglFile,
  summarizeBglEntries,
  decodeHtmlAndCharset
};
