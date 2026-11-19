const fs = require('node:fs');
const zlib = require('node:zlib');
const { IMAGE_NAME } = require('./image-resource');

const TONE_MAP = {
  red: 'accent',
  orangered: 'warn',
  orange: 'pos',
  darkcyan: 'phonetic',
  teal: 'phonetic',
  darkmagenta: 'section',
  darkslateblue: 'section',
  rosybrown: 'muted',
  darkgray: 'muted',
  dimgray: 'muted',
  darkslategray: 'strong'
};

function parseDictzipHeader(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const probeLen = Math.min(stat.size, 65536);
    const head = Buffer.allocUnsafe(probeLen);
    const read = fs.readSync(fd, head, 0, probeLen, 0);
    const buf = head.subarray(0, read);

    if (buf.length < 10 || buf[0] !== 0x1f || buf[1] !== 0x8b || buf[2] !== 0x08) {
      return { kind: 'plain', encoding: detectEncodingFromBom(buf), bomBytes: bomLength(buf) };
    }

    const flg = buf[3];
    let p = 10;
    let chlen = 0;
    let chcnt = 0;
    let chunkSizes = null;

    if (flg & 0x04) {
      const xlen = buf.readUInt16LE(p);
      p += 2;
      const extraEnd = Math.min(buf.length, p + xlen);
      while (p + 4 <= extraEnd) {
        const si1 = String.fromCharCode(buf[p], buf[p + 1]);
        const subLen = buf.readUInt16LE(p + 2);
        p += 4;
        if (si1 === 'RA' && p + 6 <= extraEnd) {
          chlen = buf.readUInt16LE(p + 2);
          chcnt = buf.readUInt16LE(p + 4);
          const needed = 6 + chcnt * 2;
          if (p + needed <= buf.length) {
            chunkSizes = new Array(chcnt);
            for (let i = 0; i < chcnt; i++) {
              chunkSizes[i] = buf.readUInt16LE(p + 6 + i * 2);
            }
          }
        }
        p += subLen;
      }
    }
    if (flg & 0x08) while (p < buf.length && buf[p++] !== 0);
    if (flg & 0x10) while (p < buf.length && buf[p++] !== 0);
    if (flg & 0x02) p += 2;

    if (chunkSizes && chlen > 0) {
      const chunkOffsets = new Array(chcnt + 1);
      chunkOffsets[0] = p;
      for (let i = 0; i < chcnt; i++) {
        chunkOffsets[i + 1] = chunkOffsets[i] + chunkSizes[i];
      }
      // Inspect start of chunk 0 to determine BOM / encoding.
      const c0 = zlib.inflateRawSync(buf.subarray(chunkOffsets[0], chunkOffsets[1]), {
        finishFlush: zlib.constants.Z_SYNC_FLUSH
      });
      return {
        kind: 'dictzip',
        chlen,
        chcnt,
        chunkSizes,
        chunkOffsets,
        encoding: detectEncodingFromBom(c0),
        bomBytes: bomLength(c0)
      };
    }

    const full = zlib.gunzipSync(fs.readFileSync(filePath));
    return {
      kind: 'gzip',
      encoding: detectEncodingFromBom(full),
      bomBytes: bomLength(full)
    };
  } finally {
    fs.closeSync(fd);
  }
}

function bomLength(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 2;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 3;
  return 0;
}

function detectEncodingFromBom(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf16le';
  return 'utf8';
}

function readChunkFromDictzip(fd, header, chunkIndex) {
  const start = header.chunkOffsets[chunkIndex];
  const size = header.chunkSizes[chunkIndex];
  const comp = Buffer.allocUnsafe(size);
  let read = 0;
  while (read < size) {
    const n = fs.readSync(fd, comp, read, size - read, start + read);
    if (n <= 0) break;
    read += n;
  }
  return zlib.inflateRawSync(comp.subarray(0, read), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
}

/**
 * Read a byte slice from a DSL / dictzip file without decoding unrelated entries.
 */
function readDslSlice(filePath, offset, length, cachedHeader = null) {
  const header = cachedHeader || parseDictzipHeader(filePath);
  if (header.kind === 'dictzip') {
    const startChunk = Math.floor(offset / header.chlen);
    const endChunk = Math.floor((offset + length - 1) / header.chlen);
    const fd = fs.openSync(filePath, 'r');
    try {
      const chunks = [];
      for (let ci = startChunk; ci <= endChunk && ci < header.chcnt; ci++) {
        chunks.push(readChunkFromDictzip(fd, header, ci));
      }
      const joined = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      const localStart = offset - (startChunk * header.chlen);
      return joined.subarray(localStart, localStart + length).toString(header.encoding);
    } finally {
      fs.closeSync(fd);
    }
  }
  if (header.kind === 'gzip') {
    const full = zlib.gunzipSync(fs.readFileSync(filePath));
    return full.subarray(offset, offset + length).toString(header.encoding);
  }
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = fs.readSync(fd, buf, read, length - read, offset + read);
      if (n <= 0) break;
      read += n;
    }
    return buf.subarray(0, read).toString(header.encoding);
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeDslHeadword(raw) {
  return raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();
}

/**
 * Stream/scan DSL entries chunk-by-chunk, invoking onEntry({ headwords, bodyOffset, bodyLength }).
 */
function scanDslEntries(filePath, onEntry) {
  const header = parseDictzipHeader(filePath);
  const step = header.encoding === 'utf16le' ? 2 : 1;

  let headwords = [];
  let bodyStart = -1;
  let bodyEnd = -1;
  let count = 0;

  const flushEntry = () => {
    if (headwords.length > 0 && bodyStart >= 0 && bodyEnd > bodyStart) {
      onEntry({
        headwords,
        bodyOffset: bodyStart,
        bodyLength: bodyEnd - bodyStart
      });
      count += 1;
    }
    headwords = [];
    bodyStart = -1;
    bodyEnd = -1;
  };

  const processLinesFromBuffer = (buf, baseByteOffset, isEof) => {
    let lineStart = 0;
    const limit = buf.length - (buf.length % step);
    for (let pos = 0; pos < limit; pos += step) {
      const code = step === 2 ? buf.readUInt16LE(pos) : buf[pos];
      if (code === 0x0a) {
        let lineEnd = pos;
        if (lineEnd - step >= lineStart) {
          const prev = step === 2 ? buf.readUInt16LE(lineEnd - step) : buf[lineEnd - 1];
          if (prev === 0x0d) lineEnd -= step;
        }
        handleLine(buf.subarray(lineStart, lineEnd).toString(header.encoding), baseByteOffset + lineStart, pos + step - lineStart);
        lineStart = pos + step;
      }
    }
    if (isEof && lineStart < limit) {
      handleLine(buf.subarray(lineStart, limit).toString(header.encoding), baseByteOffset + lineStart, limit - lineStart);
      lineStart = limit;
    }
    return buf.subarray(lineStart);
  };

  const handleLine = (line, absStart, totalByteLenWithEol) => {
    const clean = line.replace(/^\uFEFF/, '');
    if (!clean) {
      if (bodyStart >= 0) flushEntry();
      return;
    }
    if (clean.startsWith('#')) {
      if (bodyStart >= 0) flushEntry();
      return;
    }
    if (clean[0] === ' ' || clean[0] === '\t') {
      if (headwords.length > 0) {
        if (bodyStart < 0) bodyStart = absStart;
        bodyEnd = absStart + totalByteLenWithEol;
      }
      return;
    }
    if (bodyStart >= 0) flushEntry();
    const hw = normalizeDslHeadword(clean);
    if (hw) headwords.push(hw);
  };

  if (header.kind === 'dictzip') {
    const fd = fs.openSync(filePath, 'r');
    try {
      let leftover = Buffer.alloc(0);
      let globalPos = 0;
      for (let ci = 0; ci < header.chcnt; ci++) {
        const chunk = readChunkFromDictzip(fd, header, ci);
        const combined = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
        const nextLeftover = processLinesFromBuffer(combined, globalPos, ci === header.chcnt - 1);
        globalPos += combined.length - nextLeftover.length;
        leftover = nextLeftover.length ? Buffer.from(nextLeftover) : Buffer.alloc(0);
      }
    } finally {
      fs.closeSync(fd);
    }
  } else {
    const full = header.kind === 'gzip'
      ? zlib.gunzipSync(fs.readFileSync(filePath))
      : fs.readFileSync(filePath);
    processLinesFromBuffer(full, 0, true);
  }

  flushEntry();
  return { count, header };
}

function unescapeDslText(text) {
  return String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\\(.)/g, '$1');
}

function stripAllDslMarkup(raw) {
  return unescapeDslText(
    String(raw || '')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\[s\][^\[]*\[\/s\]/g, '')
      .replace(/\[p\]([^\[]*)\[\/p\]/g, '$1')
      .replace(/\[ref\]([^\[]*)\[\/ref\]/g, '$1')
      .replace(/↑<<([^>]+)>>/g, '$1')
      .replace(/\[\/?(?:m\d*|b|i|u|c(?:\s+[^\]]*)?|sub|sup|ex|trn|com|\*)\]/g, '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDslSummary(rawBody, dictId) {
  const raw = String(rawBody || '');
  let phoneticUk = null;
  let phoneticUs = null;
  let phoneticAny = null;
  const posList = [];
  const audio = [];
  const audioSeen = new Set();
  const forms = [];

  if (dictId === 'oald8') {
    const lines = raw.split(/\r?\n/);
    const headerLine = lines[0] || '';
    const formsMatch = headerLine.match(/\[c rosybrown\]\\\[(\[c darkslategray\]\[b\].*?)\[c rosybrown\]\\\]/);
    if (formsMatch) {
      const formMatches = [...formsMatch[1].matchAll(/\[b\]([^\[]+)\[\/b\]/g)];
      for (const m of formMatches) {
        const f = stripAllDslMarkup(m[1]).replace(/·/g, '');
        if (f && !forms.includes(f)) forms.push(f);
      }
    }

    const posMatches = [...headerLine.matchAll(/\[c orange\]\s*([^[\]]+?)\[\/c\]/g)];
    for (const m of posMatches) {
      for (const part of m[1].split(',')) {
        const p = part.trim();
        if (p && !posList.includes(p)) posList.push(p);
      }
    }

    const ukMatch = headerLine.match(/\[p\]BrE\[\/p\][\s\S]{0,80}?\[c darkcyan\]\\\[([^\]]+)\\\]/);
    if (ukMatch) phoneticUk = unescapeDslText(ukMatch[1]).trim();
    const usMatch = headerLine.match(/\[p\](?:NAmE|AmE)\[\/p\][\s\S]{0,80}?\[c darkcyan\]\\\[([^\]]+)\\\]/);
    if (usMatch) phoneticUs = unescapeDslText(usMatch[1]).trim();

    // Extract headword pronunciation wav files cleanly from header line before cross-refs/conjugation notes.
    const primaryHeaderPart = headerLine.split(/\[c darkcyan\]\[b\]\s*see also|\(\[c rosybrown\]|\[c darkgray\]\(/i)[0] || headerLine;
    const soundSource = primaryHeaderPart;
    const soundRe = /(?:(\[p\](BrE|NAmE|AmE)\[\/p\])[\s\S]{0,120}?)?\[s\]([^[\]]+?\.wav)\[\/s\]/gi;
    for (const m of soundSource.matchAll(soundRe)) {
      const file = m[3].trim();
      if (audioSeen.has(file)) continue;
      audioSeen.add(file);
      const ctxAccent = (m[2] || '').toLowerCase();
      let accent = 'other';
      if (ctxAccent === 'name' || ctxAccent === 'ame' || /_us(?:_\d+)?\.wav$/i.test(file)) accent = 'us';
      else if (ctxAccent === 'bre' || /_(?:gb|uk)(?:_\d+)?\.wav$/i.test(file)) accent = 'uk';
      audio.push({ file, dict_id: dictId, accent });
      if (audio.length >= 4) break;
    }

    const defs = [];
    for (const m of raw.matchAll(/\{\{(?:d|ud)\}\}([\s\S]*?)\{\{\/(?:d|ud)\}\}/g)) {
      const clean = stripAllDslMarkup(m[1]);
      if (clean && !defs.includes(clean)) defs.push(clean);
      if (defs.length >= 30) break;
    }

    return {
      phonetic_uk: phoneticUk,
      phonetic_us: phoneticUs,
      phonetic: phoneticUk || phoneticUs || null,
      pos_list: posList,
      forms,
      audio,
      definitions: defs,
      short_en: defs.slice(0, 2).join('; ').slice(0, 180)
    };
  }

  // MWCollegiate11 summary extraction
  const primaryLine = raw.split(/\r?\n/)[0] || '';
  const phonMatch = primaryLine.match(/\[com\]\\\\([^\\[]+?)\\\\/);
  if (phonMatch) phoneticAny = unescapeDslText(phonMatch[1]).split(',')[0].trim();

  const posMatches = [...primaryLine.matchAll(/\[i\]\[c\]\[com\]([^[\]]+?)\[\/com\]/g)];
  for (const m of posMatches) {
    const p = m[1].trim();
    if (p && !posList.includes(p)) posList.push(p);
    if (posList.length >= 4) break;
  }

  for (const m of primaryLine.matchAll(/\[s\]([^[\]]+?\.wav)\[\/s\]/gi)) {
    const file = m[1].trim();
    if (audioSeen.has(file)) continue;
    audioSeen.add(file);
    audio.push({ file, dict_id: dictId, accent: 'mw' });
    if (audio.length >= 4) break;
  }

  const mwDefs = [];
  for (const m of raw.matchAll(/\[trn\]([\s\S]*?)\[\/trn\]/g)) {
    const clean = stripAllDslMarkup(m[1]).replace(/^:\s*/, '').trim();
    if (clean && !mwDefs.includes(clean)) mwDefs.push(clean);
    if (mwDefs.length >= 30) break;
  }

  return {
    phonetic_uk: null,
    phonetic_us: null,
    phonetic: phoneticAny,
    pos_list: posList,
    forms,
    audio,
    definitions: mwDefs,
    short_en: mwDefs.slice(0, 2).join('; ').slice(0, 180)
  };
}

/**
 * Parse raw DSL article body into XSS-safe structured AST blocks for safe Vue rendering.
 */
function parseDslArticleToAst(rawBody, dictId) {
  const lines = String(rawBody || '').split(/\r?\n/);
  const blocks = [];
  let lastAccent = dictId === 'oald8' ? 'uk' : 'mw';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let indent = 0;
    const mMatch = trimmed.match(/\[m(\d+)\]/);
    if (mMatch) indent = Math.min(4, parseInt(mMatch[1], 10));

    // Strip structural tags that don't affect inline tokens cleanly; tokenize inline formatting,
    // [s]audio[/s], [ref]...[/ref], and ↑<<...>> into plain JSON nodes.
    const nodes = [];
    const stack = [{ bold: false, italic: false, underline: false, sup: false, sub: false, tone: 'default', example: false }];
    const curStyle = () => stack[stack.length - 1];

    let i = 0;
    let buf = '';
    const pushBuf = () => {
      if (!buf) return;
      const clean = buf.replace(/\u00a0/g, ' ');
      if (clean) nodes.push({ type: 'text', text: clean, ...curStyle() });
      buf = '';
    };

    while (i < trimmed.length) {
      if (trimmed[i] === '\\' && i + 1 < trimmed.length) {
        buf += trimmed[i + 1];
        i += 2;
        continue;
      }

      if (trimmed.startsWith('↑<<', i)) {
        const end = trimmed.indexOf('>>', i + 3);
        if (end >= 0) {
          pushBuf();
          const target = stripAllDslMarkup(trimmed.slice(i + 3, end));
          if (target) nodes.push({ type: 'ref', target, label: target });
          i = end + 2;
          continue;
        }
      }

      if (trimmed[i] === '{' && trimmed[i + 1] === '{') {
        const end = trimmed.indexOf('}}', i + 2);
        if (end >= 0) {
          i = end + 2;
          continue;
        }
      }

      if (trimmed[i] === '[') {
        const end = trimmed.indexOf(']', i + 1);
        if (end >= 0) {
          const tag = trimmed.slice(i + 1, end).trim();

          if (tag === 's') {
            const close = trimmed.indexOf('[/s]', end + 1);
            if (close >= 0) {
              pushBuf();
              const file = trimmed.slice(end + 1, close).trim();
              if (/\.wav$/i.test(file)) {
                let accent = lastAccent;
                if (/_us(?:_\d+)?\.wav$/i.test(file)) accent = 'us';
                else if (/_(?:gb|uk)(?:_\d+)?\.wav$/i.test(file)) accent = 'uk';
                nodes.push({
                  type: 'audio',
                  file,
                  dict_id: dictId,
                  accent,
                  label: accent === 'us' ? '美音' : accent === 'uk' ? '英音' : '朗读'
                });
              } else if (IMAGE_NAME.test(file)) {
                nodes.push({ type: 'image', file, dict_id: dictId, label: '原词典图片' });
              }
              i = close + 4;
              continue;
            }
          }

          if (tag === 'ref') {
            const close = trimmed.indexOf('[/ref]', end + 1);
            if (close >= 0) {
              pushBuf();
              const target = stripAllDslMarkup(trimmed.slice(end + 1, close));
              if (target) nodes.push({ type: 'ref', target, label: target });
              i = close + 6;
              continue;
            }
          }

          if (tag === 'p') {
            const close = trimmed.indexOf('[/p]', end + 1);
            if (close >= 0) {
              pushBuf();
              const label = unescapeDslText(trimmed.slice(end + 1, close)).trim();
              if (/BrE/i.test(label)) lastAccent = 'uk';
              else if (/NAmE|AmE/i.test(label)) lastAccent = 'us';
              nodes.push({ type: 'badge', text: label });
              i = close + 4;
              continue;
            }
          }

          pushBuf();
          const prev = curStyle();
          if (tag.startsWith('/')) {
            if (stack.length > 1) stack.pop();
          } else if (/^m\d*$/.test(tag) || tag === '*' || tag === 'trn' || tag === 'com') {
            stack.push({ ...prev });
          } else if (tag === 'b') {
            stack.push({ ...prev, bold: true });
          } else if (tag === 'i') {
            stack.push({ ...prev, italic: true });
          } else if (tag === 'u') {
            stack.push({ ...prev, underline: true });
          } else if (tag === 'sup') {
            stack.push({ ...prev, sup: true });
          } else if (tag === 'sub') {
            stack.push({ ...prev, sub: true });
          } else if (tag === 'ex') {
            stack.push({ ...prev, example: true, italic: true });
          } else if (tag === 'c' || tag.startsWith('c ')) {
            const rawColor = tag.slice(1).trim().toLowerCase();
            stack.push({ ...prev, tone: TONE_MAP[rawColor] || prev.tone });
          } else {
            stack.push({ ...prev });
          }

          i = end + 1;
          continue;
        }
      }

      buf += trimmed[i++];
    }
    pushBuf();

    if (nodes.length > 0) blocks.push({ indent, nodes });
  }

  return blocks;
}

// Split homographs and POS-specific headers, excluding inflected forms and examples.
function extractDslSections(rawBody, dictId) {
  const sections = [];
  let lines = [];
  for (const line of String(rawBody || '').split(/\r?\n/)) {
    const prefix = line.split('[s]')[0];
    const boundary = dictId === 'oald8'
      ? /\[m0\]/.test(line) && (/\{\{id=/.test(line) ||
        (/\[c orange\]/.test(line) && /\[s\]/.test(line) && !stripAllDslMarkup(prefix).includes('(')))
      : /^\s*\[b\]\[c darkslategray\][IVX]+\./.test(line);
    if (boundary && lines.length) { sections.push(lines.join('\n')); lines = []; }
    lines.push(line);
  }
  if (lines.length) sections.push(lines.join('\n'));
  return sections.map(raw => ({ raw, summary: extractDslSummary(raw, dictId) }));
}

module.exports = {
  parseDictzipHeader,
  readDslSlice,
  scanDslEntries,
  extractDslSummary,
  extractDslSections,
  parseDslArticleToAst,
  normalizeDslHeadword,
  stripAllDslMarkup
};
