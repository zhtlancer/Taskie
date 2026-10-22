// Backend contract exercised with real Chromium downloads. The settings UI is migrated separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { TarReader, tarStream } = require('../backend/src/utils/tar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-photo-export-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
const names = file => {
  const result = [], reader = new TarReader(name => result.push(name), { maxFileSize: 1e7 });
  reader.push(fs.readFileSync(file)); reader.end(); return result.sort();
};
async function main() {
  await app.ready();
  const child = app.services.childrenService.createChild({ name: '照片导出专项' });
  const add = (name, content) => {
    fs.writeFileSync(path.join(dir, 'uploads', name), content);
    app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: name, photo_path: `/uploads/${name}` });
  };
  add('retained.jpg', 'retained'); app.backupService.create();
  db.prepare('DELETE FROM mistake_records').run(); fs.rmSync(path.join(dir, 'uploads', 'retained.jpg'));
  add('current.jpg', 'current');
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(token => {
    sessionStorage.setItem('taskie_parent_token', token);
    const now = Date.now(); Date.now = () => now + 365 * 86400000;
  }, app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto(base + '/parent/settings', { waitUntil: 'domcontentloaded' });
  const api = (url, body) => page.evaluate(async ({ url, body }) => {
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${sessionStorage.getItem('taskie_parent_token')}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { url, body });
  const download = async scope => {
    const ticket = await api('/api/backups/photos/export-ticket', { scope }); assert.equal(ticket.status, 200);
    const event = page.waitForEvent('download');
    await page.evaluate(url => { const a = document.createElement('a'); a.href = url; a.download = ''; a.click(); }, ticket.body.url);
    const downloaded = await event, file = path.join(dir, `${scope}.tar`); await downloaded.saveAs(file);
    return file;
  };
  const all = await download('all');
  assert.deepEqual(names(all), ['current.jpg', 'retained.jpg']);
  console.log('PASS native browser download includes current and retained-only photos');
  let status = (await api('/api/backups')).body.photo_export;
  assert.deepEqual([status.exported_count, status.pending_count], [2, 0]); assert.ok(status.last_complete_at);
  console.log('PASS completion is persisted after the response finishes');
  add('new.jpg', 'new'); fs.utimesSync(path.join(dir, 'uploads', 'new.jpg'), 0, 0);
  assert.deepEqual(names(await download('new')), ['new.jpg']);
  console.log('PASS new photos ignore both skewed device clock and old file mtime');
  assert.equal((await api('/api/backups/photos/export-ticket', { since: new Date().toISOString() })).status, 400);
  assert.deepEqual(names(await download('new')), []);
  console.log('PASS legacy since is rejected and repeated incremental downloads are empty');
  // Preserve trusted expectations, then simulate a same-size corrupted photo and import through HTTP.
  app.backupService.create();
  fs.writeFileSync(path.join(dir, 'uploads', 'current.jpg'), 'WRONG!!');
  let missing = (await api('/api/backups')).body.missing_photos;
  assert.deepEqual([missing.count, missing.mismatch], [1, 1]);
  assert.equal(missing.sample[0].subject, '数学');
  const upload = async file => page.evaluate(async file => {
    const data = new FormData(); data.append('file', new File([Uint8Array.from(file)], 'photos.tar'));
    const response = await fetch('/api/backups/photos/import', { method: 'POST',
      headers: { authorization: `Bearer ${sessionStorage.getItem('taskie_parent_token')}` }, body: data });
    return { status: response.status, body: await response.json() };
  }, [...fs.readFileSync(file)]);
  const badFile = path.join(dir, 'bad.tar'), source = path.join(dir, 'bad.jpg'); fs.writeFileSync(source, 'WRONG!!');
  const chunks = []; for await (const chunk of tarStream([{ name: 'current.jpg', file: source }])) chunks.push(chunk);
  fs.writeFileSync(badFile, Buffer.concat(chunks));
  const bad = await upload(badFile); assert.equal(bad.body.mismatch, 1); assert.equal(bad.body.missing, 1);
  console.log('PASS corrupted same-name content is refused and reported as mismatch');
  const repaired = await upload(all); assert.equal(repaired.status, 200); assert.equal(repaired.body.imported, 1);
  assert.equal((await api('/api/backups')).body.missing_photos.count, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'current.jpg'), 'utf8'), 'current');
  console.log('PASS correct content repairs an existing corrupted photo');
  await context.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
