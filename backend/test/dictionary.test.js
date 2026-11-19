const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const { DictionaryService } = require('../src/services/dictionary');
const { unwrapMediaResource } = require('../src/services/dictionary/zip64-reader');
const { identityKey, canonicalKey, compareSpellingAnswer, validateEnglishWord } = require('../src/utils/english-word');

function makeSyntheticBglBlock(headword, definitionBytes, posByte = 0x30, inflections = []) {
  const hwBuf = Buffer.from(headword, 'latin1');
  const mainBuf = Buffer.isBuffer(definitionBytes) ? definitionBytes : Buffer.from(definitionBytes, 'utf8');
  const metaBuf = Buffer.from([0x14, 0x02, posByte]);
  const defBuf = Buffer.concat([mainBuf, metaBuf]);
  const tailParts = inflections.map(form => {
    const b = Buffer.from(form, 'latin1');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  const defLenBE = Buffer.from([(defBuf.length >> 8) & 0xff, defBuf.length & 0xff]);
  const payload = Buffer.concat([Buffer.from([hwBuf.length]), hwBuf, defLenBE, defBuf, ...tailParts]);

  const len = payload.length;
  let header;
  if (len <= 11) {
    header = Buffer.from([((len + 4) << 4) | 0x01]);
  } else if (len < 256) {
    header = Buffer.from([0x01, len]);
  } else {
    header = Buffer.from([0x11, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([header, payload]);
}

function makeFakeWavMp3(mp3Bytes) {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(0x55, 0); // WAVE_FORMAT_MPEGLAYER3
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(16000, 4);

  const fmtHeader = Buffer.concat([Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), fmt]);
  const dataSize = Buffer.alloc(4);
  dataSize.writeUInt32LE(mp3Bytes.length, 0);
  const pad = mp3Bytes.length % 2 ? Buffer.from([0]) : Buffer.alloc(0);
  const dataHeader = Buffer.concat([Buffer.from('data'), dataSize, mp3Bytes, pad]);

  const body = Buffer.concat([Buffer.from('WAVE'), fmtHeader, dataHeader]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, body]);
}

function makeFakePcmWav() {
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(11025, 4);
  fmt.writeUInt16LE(8, 14);
  const body = Buffer.concat([
    Buffer.from('WAVE'),
    Buffer.from('fmt '),
    Buffer.from([16, 0, 0, 0]),
    fmt,
    Buffer.from('data'),
    Buffer.from([4, 0, 0, 0, 128, 128, 128, 128])
  ]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, body]);
}

function buildMinimalZip(entries) {
  const chunks = [];
  const cd = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    chunks.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    cd.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

test('english-word normalization preserves case in identityKey and normalizes smart apostrophes', () => {
  assert.equal(identityKey('  May '), 'May');
  assert.equal(identityKey('don’t'), "don't");
  assert.equal(identityKey('look   after'), 'look after');
  assert.equal(canonicalKey('May'), 'may');
  assert.equal(validateEnglishWord("don’t"), "don't");
  assert.throws(() => validateEnglishWord('12345'));

  const sp1 = compareSpellingAnswer("don’t", "don't");
  assert.equal(sp1.is_correct, true);
  assert.equal(sp1.exact_case, true);

  const sp2 = compareSpellingAnswer('Apple', 'apple');
  assert.equal(sp2.is_correct, true);
  assert.equal(sp2.exact_case, false);
});

test('DictionaryService indexes synthetic BGL + DSL + ZIP media and serves lookup, articles and unwrapped audio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-dict-test-'));
  const dictDir = path.join(dir, 'dicts');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(dictDir, { recursive: true });

  // 1. Synthetic BGL (GB18030 encoded payloads matching real Babylon BGL)
  const bglBlocks = Buffer.concat([
    makeSyntheticBglBlock('apple$1$', Buffer.from([0xc6, 0xbb, 0xb9, 0xfb]), 0x30, ['apples']), // 苹果
    makeSyntheticBglBlock('May$2$', Buffer.from([0xce, 0xe5, 0xd4, 0xc2]), 0x30, []), // 五月
    makeSyntheticBglBlock('may$3$', Buffer.from([0xbf, 0xc9, 0xc4, 0xdc, 0xa3, 0xbb, 0xbf, 0xc9, 0xd2, 0xd4]), 0x32, ['might']), // 可能；可以
    makeSyntheticBglBlock("don't$4$", Buffer.from([0xbd, 0xfb, 0xbc, 0xc9]), 0x30, []) // 禁忌
  ]);
  const bglHeader = Buffer.from([0x12, 0x34, 0x00, 0x01, 0x00, 0x00]);
  fs.writeFileSync(path.join(dictDir, 'test-bgl.BGL'), Buffer.concat([bglHeader, zlib.gzipSync(bglBlocks)]));

  // 2. Synthetic OALD8 DSL.dz + media ZIP
  const oaldText = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([
      '#NAME "OALD8 Test"',
      'apple',
      '\t[m0][b]apple[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[ˈæpl\\][/c] [s]z_apple_gb.wav[/s] [p]NAmE[/p] [c darkcyan]\\[ˈæpl\\][/c] [s]z_apple_us.wav[/s][/m]',
      '\t[m1]{{d}}a round fruit with crisp flesh{{/d}}[/m]',
      '\t[m2][ex]{{x}}an apple pie{{/x}}[/ex] ↑<<pie>>[/m]',
      'May',
      '\t[m0][b]May[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[meɪ\\][/c][/m]',
      '\t[m1]{{d}}the fifth month of the year{{/d}}[/m]',
      'may',
      '\t[m0][b]may[/b] [c orange] modal verb[/c] [p]BrE[/p] [c darkcyan]\\[meɪ\\][/c][/m]',
      '\t[m1]{{ud}}used to say that sth is possible{{/ud}}[/m]'
    ].join('\n'), 'utf16le')
  ]);
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl.dz'), zlib.gzipSync(oaldText));

  const fakeMp3 = Buffer.from([0xff, 0xf3, 0x38, 0xc4, 0x00, 0x11, 0x22, 0x33]);
  const fakeWavMp3 = makeFakeWavMp3(fakeMp3);
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl.files.zip'), buildMinimalZip([
    { name: 'z_apple_gb.wav', data: fakeWavMp3 },
    { name: 'z_apple_us.wav', data: fakeWavMp3 }
  ]));

  // 3. Synthetic MW DSL.dz + PCM WAV zip
  const mwText = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([
      'ap{·}ple',
      '\t[b]I.[/b] [s]apple001.wav[/s] [com]\\\\ˈa-pəl\\\\[/com] [i][c][com]noun[/com][/c][/i]',
      '\t[m1][trn][b]:[/b] the fleshy fruit of a tree — compare [ref]pear[/ref][/trn][/m]',
      'look after',
      '\t[i][c][com]phrasal verb[/com][/c][/i]',
      '\t[m1][trn][b]:[/b] to take care of[/trn][/m]'
    ].join('\n'), 'utf16le')
  ]);
  fs.writeFileSync(path.join(dictDir, 'test-mw11.dsl.dz'), zlib.gzipSync(mwText));
  const pcmWav = makeFakePcmWav();
  fs.writeFileSync(path.join(dictDir, 'test-mw11.dsl.files.zip'), buildMinimalZip([
    { name: 'apple001.wav', data: pcmWav }
  ]));

  try {
    const service = new DictionaryService({ dictDir, cacheDir });
    const built = await service.rebuildIndex();
    assert.equal(built.built, true);

    const status = service.status();
    assert.equal(status.available, true);
    assert.equal(status.index_ready, true);
    assert.equal(status.dictionaries.length, 3);

    // Case-exact lookup: May puts "May" before "may"
    const mayRes = await service.lookup('May');
    assert.equal(mayRes.exact_matches.length, 2);
    assert.equal(mayRes.exact_matches[0].word, 'May');
    assert.match(mayRes.exact_matches[0].definition_zh, /五月/);
    assert.equal(mayRes.exact_matches[1].word, 'may');

    // Inflection lookup for "apples" suggests "apple"
    const applesRes = await service.lookup('apples');
    assert.equal(applesRes.exact_matches.length, 0);
    assert.ok(applesRes.suggestions.some(s => s.word === 'apple'));

    // Apostrophe & multi-source merge
    const appleRes = await service.lookup('apple');
    assert.equal(appleRes.exact_matches.length, 1);
    const apple = appleRes.exact_matches[0];
    assert.equal(apple.phonetic_uk, 'ˈæpl');
    assert.equal(apple.definition_zh, 'n. 苹果');
    assert.match(apple.definition_en, /round fruit/i);
    assert.equal(apple.audio.length, 3);

    // Multi-word phrase & smart apostrophe lookup
    const lookRes = await service.lookup('  look   after ');
    assert.equal(lookRes.exact_matches[0].word, 'look after');
    const dontRes = await service.lookup('don’t');
    assert.equal(dontRes.exact_matches[0].word, "don't");

    // Full original dictionary AST includes cross-ref links
    const articles = await service.getArticles('apple', 'all');
    assert.equal(articles.articles.length, 3);
    const oaldNodes = articles.articles.find(a => a.dict_id === 'oald8').entries[0].blocks.flatMap(b => b.nodes);
    assert.ok(oaldNodes.some(n => n.type === 'ref' && n.target === 'pie'));

    // Unwrapped audio: OALD8 WAV-MP3 -> audio/mpeg raw MP3; MW -> audio/wav
    const ukAudio = await service.getAudio('oald8', 'z_apple_gb.wav');
    assert.equal(ukAudio.contentType, 'audio/mpeg');
    assert.deepEqual(ukAudio.buffer, fakeMp3);
    assert.equal(ukAudio.cached, true, 'lookup verifies and warms the selected clip');

    const ukAudioCached = await service.getAudio('oald8', 'z_apple_gb.wav');
    assert.equal(ukAudioCached.cached, true);
    assert.equal(ukAudioCached.contentType, 'audio/mpeg');

    const mwAudio = await service.getAudio('mw11', 'apple001.wav');
    assert.equal(mwAudio.contentType, 'audio/wav');
    assert.deepEqual(mwAudio.buffer, pcmWav);

    service.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('DictionaryService degrades cleanly when DICT_DIR is missing', async () => {
  const service = new DictionaryService({ dictDir: '/nonexistent/path/dicts', cacheDir: os.tmpdir() });
  assert.equal(service.status().available, false);
  const res = await service.lookup('apple');
  assert.equal(res.available, false);
  assert.deepEqual(res.exact_matches, []);
});

test('ZIP-only updates rebuild media offsets and invalidate disk/browser audio versions across restarts', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-dict-update-'));
  const dictDir = path.join(dir, 'dicts');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(dictDir, { recursive: true });
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl'), 'apple\n\t[s]z_apple_gb.wav[/s]\n');
  const zip = path.join(dictDir, 'test-oald8.dsl.files.zip');
  const oldWav = makeFakePcmWav();
  fs.writeFileSync(zip, buildMinimalZip([{ name: 'z_apple_gb.wav', data: oldWav }]));
  let service = new DictionaryService({ dictDir, cacheDir });
  t.after(() => { service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const before = await service.lookup('apple');
  const beforeUrl = before.exact_matches[0].audio[0].url;
  assert.deepEqual((await service.getAudio('oald8', 'z_apple_gb.wav')).buffer, oldWav);

  const newWav = Buffer.from(oldWav);
  newWav[newWav.length - 1] = 140;
  fs.writeFileSync(zip, buildMinimalZip([
    { name: 'added.wav', data: newWav },
    { name: 'z_apple_gb.wav', data: newWav }
  ]));
  const updatedAt = new Date(Date.now() + 2000);
  fs.utimesSync(zip, updatedAt, updatedAt);
  assert.equal(service.status().index_ready, false);
  const after = await service.lookup('apple');
  const afterUrl = after.exact_matches[0].audio[0].url;
  assert.notEqual(afterUrl, beforeUrl);
  const audio = await service.getAudio('oald8', 'z_apple_gb.wav');
  assert.equal(audio.cached, true);
  assert.deepEqual(audio.buffer, newWav);
  assert.deepEqual((await service.getAudio('oald8', 'added.wav')).buffer, newWav);
  const article = await service.getArticles('apple');
  const node = article.articles[0].entries[0].blocks.flatMap(b => b.nodes).find(n => n.type === 'audio');
  assert.equal(new URL(node.url, 'http://localhost').pathname, new URL(afterUrl, 'http://localhost').pathname);
  service.close();
  service = new DictionaryService({ dictDir, cacheDir });
  assert.equal(service.status().index_ready, true);
  assert.deepEqual((await service.getAudio('oald8', 'z_apple_gb.wav')).buffer, newWav);

  // A replacement with unchanged size must also invalidate the index and audio cache.
  const nextVersion = new Date(updatedAt.getTime() + 2000);
  fs.utimesSync(zip, nextVersion, nextVersion);
  assert.equal(service.status().index_ready, false);
  const touchedUrl = (await service.lookup('apple')).exact_matches[0].audio[0].url;
  assert.equal(touchedUrl, afterUrl, 'identical audio keeps its stable content reference after repacking or touching');
  assert.deepEqual((await service.getAudio('oald8', 'z_apple_gb.wav')).buffer, newWav);
});

test('unwrapMediaResource recognizes raw MP3 and PCM WAV cleanly', () => {
  const mp3 = Buffer.from([0xff, 0xf3, 0x38, 0xc4, 0x01, 0x02]);
  const res1 = unwrapMediaResource('a.wav', makeFakeWavMp3(mp3));
  assert.equal(res1.contentType, 'audio/mpeg');
  assert.equal(res1.ext, 'mp3');
  assert.deepEqual(res1.buffer, mp3);

  const pcm = makeFakePcmWav();
  const res2 = unwrapMediaResource('b.wav', pcm);
  assert.equal(res2.contentType, 'audio/wav');
  assert.equal(res2.ext, 'wav');
  assert.deepEqual(res2.buffer, pcm);
});

test('offline index command builds disposable cache without creating a business database', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-dict-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dictDir = path.join(root, 'dicts');
  fs.mkdirSync(dictDir);
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl'), 'apple\n\t[m1]{{d}}a fruit{{/d}}[/m]\n');
  const businessDb = path.join(root, 'business.sqlite');
  const cacheDir = path.join(root, 'cache');
  const command = path.resolve(__dirname, '../src/dictionary-index.js');
  const env = { ...process.env, NODE_ENV: 'test', DICT_DIR: dictDir, DICT_CACHE_DIR: cacheDir, DATABASE_PATH: businessDb };
  const result = spawnSync(process.execPath, [command], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(cacheDir, 'dict_index.sqlite')));
  assert.equal(fs.existsSync(businessDb), false);
  const disabled = spawnSync(process.execPath, [command], { env: { ...env, DICT_DIR: 'off' }, encoding: 'utf8' });
  assert.equal(disabled.status, 1);
  assert.match(disabled.stderr, /未发现词典文件/);
  assert.equal(fs.existsSync(businessDb), false);
});
