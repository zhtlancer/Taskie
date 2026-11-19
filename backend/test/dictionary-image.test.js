const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTestApp, cleanupTestApp } = require('./helper');
const { writeImageFixture } = require('./dictionary-image-fixture');
const { zip } = require('./dictionary-audio-fixture');
const { MAX_IMAGE_BYTES, imageContentType } = require('../src/services/dictionary/image-resource');
const { parseDslArticleToAst } = require('../src/services/dictionary/dsl-parser');
const { readZipEntry, scanZipCentralDirectory } = require('../src/services/dictionary/zip64-reader');

async function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-image-test-'));
  const dictDir = path.join(root, 'dicts');
  const data = await writeImageFixture(dictDir);
  const ctx = createTestApp({dictDir,dictCacheDir:path.join(root,'cache'),...options});
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); fs.rmSync(root,{recursive:true,force:true}); });
  await ctx.app.ready();
  return {...ctx,...data,dictionary:ctx.app.services.dictionaryService};
}

test('article AST exposes controlled raster images and preserves audio/links/text without executable markup', () => {
  const raw = '[m4][s]Table.PNG[/s] [s]../private.jpg[/s] [s]https://evil/a.png[/s] [s]bad.svg[/s] [s]sound.wav[/s] [ref]next[/ref] <script>alert(1)</script>[/m]';
  const nodes = parseDslArticleToAst(raw,'oald8').flatMap(block=>block.nodes);
  assert.deepEqual(nodes.filter(node=>node.type==='image').map(node=>node.file),['Table.PNG']);
  assert.equal(nodes.find(node=>node.type==='audio').file,'sound.wav');
  assert.equal(nodes.find(node=>node.type==='ref').target,'next');
  assert.ok(nodes.some(node=>node.type==='text' && node.text.includes('<script>')));
  assert.equal(nodes.some(node=>'html' in node),false);
});

test('authenticated parent and child image reads preserve original bytes, MIME, version and missing-image fallback', async t => {
  const ctx=await fixture(t);
  const article=(await ctx.app.inject({method:'GET',url:'/api/dictionary/article?word=picture'})).json();
  const images=article.articles.flatMap(dict=>dict.entries.flatMap(entry=>entry.blocks.flatMap(block=>block.nodes))).filter(node=>node.type==='image');
  const node=images.find(node=>node.file==='table.png');
  assert.match(node.url,/^\/api\/dictionary\/image\/oald8\/table.png\?v=[a-f0-9]{64}$/);
  const image=await ctx.app.inject({method:'GET',url:node.url});
  assert.equal(image.statusCode,200); assert.equal(image.headers['content-type'],'image/png');
  assert.match(image.headers['cache-control'],/^private/); assert.equal(image.headers['x-content-type-options'],'nosniff');
  assert.deepEqual(image.rawPayload,ctx.image);
  assert.equal((await ctx.rawInject({method:'GET',url:node.url})).statusCode,401);
  const child=ctx.app.services.childrenService.createChild({name:'插图阅读'});
  const authorization=`Bearer ${ctx.app.jwt.sign({role:'child',child_id:child.id,epoch:ctx.app.sessionEpoch()})}`;
  assert.equal((await ctx.app.inject({method:'GET',url:node.url,headers:{authorization}})).statusCode,200);
  for (const [file,type] of [['other.jpg','image/jpeg'],['sample.gif','image/gif'],['sample.webp','image/webp']]) {
    assert.equal((await ctx.dictionary.getImage('oald8',file)).contentType,type);
  }
  assert.deepEqual((await ctx.dictionary.getImage('mw11','other.jpg')).buffer,ctx.jpeg);
  assert.equal((await ctx.app.inject({method:'GET',url:images.find(node=>node.file==='missing.jpg').url})).statusCode,404);
  assert.equal((await ctx.app.inject({method:'GET',url:images.find(node=>node.file==='invalid.jpg').url})).statusCode,422);
  const oldVersion=new URL(node.url,'http://localhost').searchParams.get('v');
  fs.writeFileSync(ctx.zipPath,zip({...ctx.media,'extra.jpg':ctx.jpeg}));
  const future=new Date(Date.now()+5000);fs.utimesSync(ctx.zipPath,future,future);
  assert.equal((await ctx.app.inject({method:'GET',url:node.url})).statusCode,409);
  const next=await ctx.dictionary.getArticles('picture');
  const newNode=next.articles[0].entries[0].blocks.flatMap(block=>block.nodes).find(node=>node.type==='image');
  assert.notEqual(new URL(newNode.url,'http://localhost').searchParams.get('v'),oldVersion);
  assert.equal((await ctx.app.inject({method:'GET',url:newNode.url})).statusCode,200);
});

test('image endpoint rejects traversal, unsupported formats, corrupt data and oversized resources', async t => {
  const ctx=await fixture(t);
  for (const [dict,file] of [['bgl','table.png'],['oald8','../table.png'],['oald8','a/b.png'],['oald8','..\\table.png'],['oald8','evil.svg'],['oald8','https://evil/a.png']]) {
    await assert.rejects(ctx.dictionary.getImage(dict,file),err=>err.status===400);
  }
  assert.equal((await ctx.app.inject({method:'GET',url:'/api/dictionary/image/oald8/..%2Ftable.png'})).statusCode,400);
  assert.equal((await ctx.app.inject({method:'GET',url:'/api/dictionary/image/oald8/table.png?v=x&v=y'})).statusCode,400);
  assert.equal((await ctx.app.inject({method:'GET',url:'/api/dictionary/image/oald8/bad.png'})).statusCode,422);
  const huge=zip({'large.png':Buffer.alloc(MAX_IMAGE_BYTES+1,1)});
  fs.writeFileSync(ctx.zipPath,huge);
  const future=new Date(Date.now()+5000);fs.utimesSync(ctx.zipPath,future,future);
  assert.equal((await ctx.app.inject({method:'GET',url:'/api/dictionary/image/oald8/large.png'})).statusCode,413);
  // Forge the uncompressed size in an isolated ZIP: the runtime decompression cap must also apply.
  const zipPath=path.join(path.dirname(ctx.zipPath),'large.zip');fs.writeFileSync(zipPath,huge);
  let meta;scanZipCentralDirectory(zipPath,value=>{meta=value;});
  assert.throws(()=>readZipEntry(zipPath,meta,{maxBytes:MAX_IMAGE_BYTES}),err=>err.status===413);
  assert.throws(()=>readZipEntry(zipPath,{...meta,uncompSize:1},{maxBytes:MAX_IMAGE_BYTES}),err=>err.status===413);
});

test('image resources remain behind device authorization as well as login', async t => {
  const ctx=await fixture(t,{deviceAuth:true});
  const response=await ctx.app.inject({method:'GET',url:'/api/dictionary/image/oald8/table.png'});
  assert.equal(response.statusCode,401);
  assert.equal(response.json().code,'DEVICE_NOT_AUTHORIZED');
});

test('signature-only corrupt images and excessive decoded pixel dimensions are rejected', async () => {
  const sharp=require('sharp');
  await assert.rejects(imageContentType('broken.png',Buffer.from([137,80,78,71,13,10,26,10])),err=>err.status===422);
  const image=await sharp({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer();
  // A valid IHDR claiming 42M pixels exercises the metadata limit without allocating those pixels.
  image.writeUInt32BE(7000,16);image.writeUInt32BE(6000,20);
  image.writeUInt32BE(require('node:zlib').crc32(image.subarray(12,29)),29);
  assert.equal((await sharp(image).metadata()).width,7000);
  await assert.rejects(imageContentType('large.png',image),err=>err.status===422);
});
