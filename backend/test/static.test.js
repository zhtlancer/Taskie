const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const buildApp = require('../src/app');
const { getDb } = require('../src/db');

test('the built app serves stroke data with long caching and a real 404, and pages fall back to index.html', async t => {
  const dist = fs.mkdtempSync(path.join(__dirname, '../uploads/dist-'));
  fs.mkdirSync(path.join(dist, 'hanzi-data'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(dist, 'hanzi-data', '学.json'), '{"strokes":[]}');
  fs.writeFileSync(path.join(dist, 'sw.js'), '// sw');
  const app = buildApp({ logger: false, db: getDb(':memory:'), uploadDir: path.join(dist, 'uploads'), clientDistDir: dist,
    jwtSecret: 'test', backupDir: path.join(dist, 'backups'), backupIntervalHours: 0, deviceAuth: false,
    authorizedTokensFile: path.join(dist, 'authorized_tokens') });
  t.after(async () => { await app.close(); fs.rmSync(dist, { recursive: true, force: true }); });

  const strokes = await app.inject({ method: 'GET', url: `/hanzi-data/${encodeURIComponent('学')}.json` });
  assert.equal(strokes.statusCode, 200);
  assert.deepEqual(strokes.json(), { strokes: [] });
  assert.equal(strokes.headers['cache-control'], 'public, max-age=2592000');
  const sw = await app.inject({ method: 'GET', url: '/sw.js' });
  assert.equal(sw.statusCode, 200);
  assert.equal(sw.headers['service-worker-allowed'], '/');
  assert.equal(sw.headers['cache-control'], 'no-cache, no-store, must-revalidate');
  const missing = await app.inject({ method: 'GET', url: `/hanzi-data/${encodeURIComponent('龘')}.json` });
  assert.equal(missing.statusCode, 404);
  assert.doesNotMatch(missing.body, /<title>/);
  const page = await app.inject({ method: 'GET', url: '/child/x/characters' });
  assert.match(page.body, /<title>app<\/title>/);
  assert.notEqual(page.headers['cache-control'], 'public, max-age=2592000');
});

test('the manifest and icons load without device authorization, while the app and its scripts stay locked', async t => {
  const dist = fs.mkdtempSync(path.join(__dirname, '../uploads/dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>app</title>');
  const assets = ['manifest.webmanifest', 'favicon.svg', 'favicon.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
  for (const name of [...assets, 'sw.js']) fs.writeFileSync(path.join(dist, name), name);
  const app = buildApp({ logger: false, db: getDb(':memory:'), uploadDir: path.join(dist, 'uploads'), clientDistDir: dist,
    jwtSecret: 'test', backupDir: path.join(dist, 'backups'), backupIntervalHours: 0, deviceAuth: true,
    authorizedTokensFile: path.join(dist, 'authorized_tokens') });
  t.after(async () => { await app.close(); fs.rmSync(dist, { recursive: true, force: true }); });

  for (const name of assets) {
    const res = await app.inject({ method: 'GET', url: `/${name}` });
    assert.equal(res.statusCode, 200, name);
    assert.equal(res.body, name);
  }
  for (const url of ['/sw.js', '/', '/index.html', '/api/children', '/icon-192.png/../index.html']) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
  }
});
