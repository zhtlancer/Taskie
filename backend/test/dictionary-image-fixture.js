const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { wav, zip } = require('./dictionary-audio-fixture');

async function writeImageFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const image = await sharp({ create: { width: 900, height: 90, channels: 3, background: '#2468ac' } }).png().toBuffer();
  const jpeg = await sharp(image).jpeg().toBuffer();
  const gif = await sharp(image).gif().toBuffer();
  const webp = await sharp(image).webp().toBuffer();
  fs.writeFileSync(path.join(dir, 'test-oald8.dsl'), [
    'picture', '\t[m0][b]picture[/b] [c orange] noun[/c] [s]picture_gb.wav[/s][/m]',
    '\t[m1]{{d}}a dictionary illustration{{/d}} ↑<<next>>[/m]',
    '\t[m4][s]table.png[/s] [s]missing.jpg[/s] [s]invalid.jpg[/s][/m]',
    'next', '\t[m0][b]next[/b][/m]', '\t[m1]a different article [s]other.jpg[/s] [ref]picture[/ref][/m]',
    'longword', `\t[m4][ref]${'longword'.repeat(10)}[/ref] ${'a'.repeat(200)} [s]table.png[/s][/m]`, ''
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'test-mw11.dsl'), 'picture\n\t[m1][trn]an illustration[/trn][s]other.jpg[/s][/m]\n');
  const media = { 'picture_gb.wav': wav(), 'table.png': image, 'other.jpg': jpeg, 'sample.gif': gif, 'sample.webp': webp, 'invalid.jpg': Buffer.from('<svg onload="alert(1)"/>'), 'bad.png': Buffer.from('not a PNG') };
  const zipPath = path.join(dir, 'test-oald8.dsl.files.zip');
  fs.writeFileSync(zipPath, zip(media));
  fs.writeFileSync(path.join(dir, 'test-mw11.dsl.files.zip'), zip({'other.jpg':jpeg}));
  return { image, jpeg, media, zipPath };
}

module.exports = { writeImageFixture };
