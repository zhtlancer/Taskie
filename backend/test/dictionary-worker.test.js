const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DictionaryService } = require('../src/services/dictionary');
const { createTestApp, cleanupTestApp } = require('./helper');

function resources(t, count = 1) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-dictionary-worker-'));
  const dictDir = path.join(root, 'dicts');
  const cacheDir = path.join(root, 'cache');
  fs.mkdirSync(dictDir);
  const file = path.join(dictDir, 'test-oald8.dsl');
  fs.writeFileSync(file, 'apple\n\t[m1]{{d}}a fruit{{/d}}[/m]\n' +
    Array.from({ length: count - 1 }, (_, i) => `entry${i}\n\t[m1]{{d}}meaning ${i}{{/d}}[/m]\n`).join(''));
  const service = new DictionaryService({ dictDir, cacheDir });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, dictDir, cacheDir, file, service };
}

const tempFiles = cacheDir => fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter(name => name.endsWith('.tmp')) : [];
const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('concurrent cold lookups and rebuilds share one worker, report progress and finish with one atomic index', async t => {
  const { service, cacheDir } = resources(t);
  const lookup = service.lookup('apple');
  const job = service.rebuildIndex();
  assert.equal(service.rebuildIndex(), job);
  const suggest = service.suggest('ap');
  const article = service.getArticles('apple');
  assert.equal(service.status().indexing, true);
  assert.equal(service.status().index_ready, false);
  await Promise.resolve();
  assert.ok(service.buildWorker.threadId > 0, 'the parser must run outside the main thread');
  const progress = [];
  service.buildWorker.on('message', message => { if (message.type === 'progress') progress.push(message.progress); });
  const [match, built, suggestions, articles] = await Promise.all([lookup, job, suggest, article]);
  assert.equal(match.exact_matches[0].definition_en, 'a fruit');
  assert.equal(built.sources[0].entry_count, 1);
  assert.deepEqual(suggestions.items, ['apple']);
  assert.equal(articles.articles.length, 1);
  assert.ok(progress.some(row => row.phase === 'entries' && row.processed === 1));
  assert.ok(progress.some(row => row.phase === 'checking'));
  assert.equal(service.status().index_ready, true);
  assert.equal(service.status().indexing, false);
  assert.equal(service.status().progress, null);
  assert.deepEqual(tempFiles(cacheDir), []);
});

test('a manual rebuild keeps a current index readable until the replacement is published', async t => {
  const { service } = resources(t);
  await service.lookup('apple');
  const oldDb = service.indexDb;
  const job = service.rebuildIndex();
  assert.equal(service.status().index_ready, true);
  assert.equal(service.status().indexing, true);
  assert.equal(oldDb.open, true);
  const match = await service.lookup('apple');
  assert.equal(match.exact_matches[0].word, 'apple');
  assert.equal(service.buildPromise, job, 'current lookups must not wait for the rebuild');
  assert.equal(service.indexDb, oldDb);
  await job;
  assert.equal(oldDb.open, false);
  assert.equal((await service.lookup('apple')).index_ready, true);
});

test('worker parsing failures preserve the previous cache and expose only safe, retryable diagnostics', async t => {
  const { service, dictDir, cacheDir } = resources(t);
  await service.lookup('apple');
  const before = digest(service.indexPath);
  const oldDb = service.indexDb;
  const broken = path.join(dictDir, 'test-bgl.BGL');
  fs.writeFileSync(broken, 'broken BGL');
  await assert.rejects(service.rebuildIndex(), /Invalid BGL/);
  assert.equal(digest(service.indexPath), before);
  assert.equal(oldDb.open, true);
  assert.equal(service.status().last_error.code, 'DICTIONARY_INVALID');
  assert.equal(JSON.stringify(service.status()).includes(dictDir), false);
  assert.equal(service.status().indexing, false);
  assert.deepEqual(tempFiles(cacheDir), []);
  fs.unlinkSync(broken);
  assert.equal((await service.lookup('apple')).exact_matches[0].word, 'apple');
  await service.rebuildIndex();
  assert.equal(service.status().last_error, null);
});

test('resources changed during a build are never published; the next lookup builds against the new source', async t => {
  const { service, file, cacheDir } = resources(t);
  await service.lookup('apple');
  const before = digest(service.indexPath);
  const job = service.rebuildIndex();
  await Promise.resolve();
  service.buildWorker.once('message', () => fs.writeFileSync(file, 'pear\n\t[m1]{{d}}a newly installed fruit{{/d}}[/m]\n'));
  await assert.rejects(job, error => error.code === 'DICTIONARY_CHANGED');
  assert.equal(digest(service.indexPath), before);
  assert.equal(service.status().index_ready, false);
  assert.equal(service.status().last_error.code, 'DICTIONARY_CHANGED');
  assert.deepEqual(tempFiles(cacheDir), []);
  const result = await service.lookup('pear');
  assert.equal(result.exact_matches[0].definition_en, 'a newly installed fruit');
  assert.equal((await service.lookup('apple')).exact_matches.length, 0);
});

test('service close cancels an active worker, joins it and removes private build files', async t => {
  const { service, cacheDir } = resources(t, 10000);
  const job = service.rebuildIndex();
  const rejected = assert.rejects(job, error => error.code === 'DICTIONARY_CLOSED');
  await Promise.resolve();
  const worker = service.buildWorker;
  await service.close();
  await rejected;
  assert.equal(worker.threadId, -1);
  assert.equal(service.buildPromise, null);
  assert.equal(service.buildWorker, null);
  assert.equal(fs.existsSync(service.indexPath), false);
  assert.deepEqual(tempFiles(cacheDir), []);
  await assert.rejects(service.lookup('apple'), error => error.code === 'DICTIONARY_CLOSED');
});

test('unexpected worker exit keeps a usable cache; external atomic replacement refreshes cached readers', async t => {
  const { service, dictDir, cacheDir, file } = resources(t);
  await service.lookup('apple');
  const before = digest(service.indexPath);
  const job = service.rebuildIndex();
  const rejected = assert.rejects(job, error => error.code === 'DICTIONARY_BUILD_FAILED');
  await Promise.resolve();
  await service.buildWorker.terminate();
  await rejected;
  assert.equal(digest(service.indexPath), before);
  assert.equal((await service.lookup('apple')).exact_matches[0].word, 'apple');
  const oldDb = service.indexDb;
  fs.writeFileSync(file, 'pear\n\t[m1]{{d}}a pear from the replacement{{/d}}[/m]\n');
  const offline = new DictionaryService({ dictDir, cacheDir });
  try { await offline.rebuildIndex(); } finally { await offline.close(); }
  assert.equal(service.status().index_ready, true);
  assert.equal(oldDb.open, false);
  assert.equal((await service.lookup('pear')).exact_matches[0].definition_en, 'a pear from the replacement');
});

test('disabled automatic building still allows explicit preparation and close before worker setup is safe', async t => {
  const { dictDir, cacheDir } = resources(t);
  const manual = new DictionaryService({ dictDir, cacheDir, autoBuild: false });
  try {
    assert.equal((await manual.lookup('apple')).index_ready, false);
    assert.equal(manual.buildPromise, null);
    await manual.rebuildIndex();
    assert.equal((await manual.lookup('apple')).exact_matches[0].word, 'apple');
  } finally { await manual.close(); }
  const closed = new DictionaryService({ dictDir, cacheDir });
  const job = closed.rebuildIndex();
  const rejected = assert.rejects(job, error => error.code === 'DICTIONARY_CLOSED');
  await closed.close();
  await rejected;
  assert.equal(closed.buildWorker, null);
  assert.deepEqual(tempFiles(cacheDir), []);
});

test('health, authenticated status and ordinary writes respond during a real large index build; child rebuild stays forbidden', async t => {
  const { dictDir, cacheDir } = resources(t, 100000);
  const ctx = createTestApp({ dictDir, dictCacheDir: cacheDir });
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); });
  await ctx.app.ready();
  const { dictionaryService: service, childrenService } = ctx.app.services;
  const child = childrenService.createChild({ name: '索引期间' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() })}` };
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/dictionary/rebuild-index', headers })).statusCode, 403);
  assert.equal((await ctx.rawInject({ method: 'GET', url: '/api/dictionary/status' })).statusCode, 401);
  const job = service.rebuildIndex();
  let completed = false;
  job.then(() => { completed = true; }, () => { completed = true; });
  let heartbeats = 0;
  const timer = setInterval(() => heartbeats++, 5);
  try {
    const health = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    const status = await ctx.app.inject({ method: 'GET', url: '/api/dictionary/status', headers });
    assert.equal(status.json().indexing, true);
    const saved = await ctx.app.inject({ method: 'POST', url: '/api/english-words', headers,
      payload: { child_id: child.id, word: 'manual', definition_zh: '手工录入不等待索引' } });
    assert.equal(saved.statusCode, 201);
    assert.equal(completed, false, 'business requests must finish while the parser is working');
    assert.equal((await job).sources[0].entry_count, 100000);
    assert.ok(heartbeats > 1, 'the main event loop must keep running throughout parsing');
  } finally { clearInterval(timer); await job.catch(() => {}); }
});

test('application shutdown cancels a build that an in-flight HTTP lookup is waiting for', async t => {
  const { dictDir, cacheDir } = resources(t, 100000);
  const ctx = createTestApp({ dictDir, dictCacheDir: cacheDir });
  t.after(async () => { await ctx.app.close(); cleanupTestApp(ctx); });
  await ctx.app.ready();
  const service = ctx.app.services.dictionaryService;
  let started;
  const workerStarted = new Promise(resolve => { started = resolve; });
  const original = service.rebuildIndex.bind(service);
  service.rebuildIndex = () => {
    const job = original();
    Promise.resolve().then(() => started(service.buildWorker));
    return job;
  };
  const request = ctx.app.inject({ method: 'GET', url: '/api/dictionary/lookup?word=apple' });
  const worker = await Promise.race([workerStarted, request.then(response => {
    throw new Error(`Lookup finished before its worker started: ${response.statusCode}`);
  })]);
  assert.ok(worker.threadId > 0);
  await ctx.app.close();
  const response = await request;
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, 'DICTIONARY_CLOSED');
  assert.equal(worker.threadId, -1);
  assert.deepEqual(tempFiles(cacheDir), []);
});
