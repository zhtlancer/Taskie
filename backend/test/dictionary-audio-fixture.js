const fs = require('node:fs');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');

function wav(sample = 128, seconds = 0.1) {
  const data = Buffer.alloc(Math.round(8000 * seconds), sample), result = Buffer.alloc(44 + data.length);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(8000, 24); result.writeUInt32LE(8000, 28); result.writeUInt16LE(1, 32);
  result.writeUInt16LE(8, 34); result.write('data', 36); result.writeUInt32LE(data.length, 40); data.copy(result, 44);
  return result;
}

function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of Object.entries(entries)) {
    const filename = Buffer.from(name), compressed = deflateRawSync(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8);
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(8, 10); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42); central.push(directory, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function writeAudioFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const header = (pos, phonetic, filename) => `[m0][c orange] ${pos}[/c] [p]BrE[/p] [c darkcyan]\\[${phonetic}\\][/c] [s]${filename}[/s]`;
  fs.writeFileSync(path.join(dir, 'test-oald8.dsl'), `record\n\t${header('noun', 'ˈrekɔːd', 'record_n_gb.wav')}\n\t[m1]{{d}}a written account{{/d}}[/m]\n\t${header('verb', 'rɪˈkɔːd', 'record_v_gb.wav')}\n\t[m1]{{d}}to store information{{/d}}[/m]\n`);
  const media = { 'record_n_gb.wav': wav(128), 'record_v_gb.wav': wav(140) };
  const zipPath = path.join(dir, 'test-oald8.dsl.files.zip'); fs.writeFileSync(zipPath, zip(media));
  return { media, zipPath };
}

module.exports = { wav, zip, writeAudioFixture };
