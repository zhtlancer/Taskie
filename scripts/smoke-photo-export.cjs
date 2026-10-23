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
  add('retained.jpg', 'retained'); await app.backupService.create();
  db.prepare('DELETE FROM mistake_records').run(); fs.rmSync(path.join(dir, 'uploads', 'retained.jpg'));
  add('current.jpg', 'current');
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(token => {
    sessionStorage.setItem('taskie_parent_token', token);
    if (!sessionStorage.getItem('taskie_clock_skewed')) {
      sessionStorage.setItem('taskie_clock_skewed', 'true');
      const now = Date.now(); window.__taskieNativeNow = Date.now.bind(Date); Date.now = () => now + 365 * 86400000;
    }
  }, app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }));
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.goto(base + '/parent/settings', { waitUntil: 'domcontentloaded' });
  const api = (url, body) => page.evaluate(async ({ url, body }) => {
    const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${sessionStorage.getItem('taskie_parent_token')}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { url, body });
  const download = async (scope, issued) => {
    const ticket = issued || await api('/api/backups/photos/export-ticket', { scope }); assert.equal(ticket.status, 200);
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
  await page.evaluate(() => { Date.now = window.__taskieNativeNow; });
  token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  await page.evaluate(token => sessionStorage.setItem('taskie_parent_token', token), token);
  await page.goto(`${base}/parent/settings`, { waitUntil: 'networkidle' });
  // Preserve trusted expectations, then simulate a same-size corrupted photo and import through HTTP.
  await app.backupService.create();
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
  const repaired = await upload(all); assert.equal(repaired.status, 200); assert.equal(repaired.body.imported, 2);
  assert.equal((await api('/api/backups')).body.missing_photos.count, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'current.jpg'), 'utf8'), 'current');
  console.log('PASS correct content repairs an existing corrupted photo');

  // A retained backup can outlive the mistake that originally referenced a photo.
  add('retained-only.jpg', 'retained-only bytes'); await app.backupService.create();
  const retainedPackage = path.join(dir, 'retained-only.tar'), retainedSource = path.join(dir, 'uploads', 'retained-only.jpg');
  const retainedChunks = [];
  for await (const chunk of tarStream([{ name: 'retained-only.jpg', file: retainedSource }])) retainedChunks.push(chunk);
  fs.writeFileSync(retainedPackage, Buffer.concat(retainedChunks));
  db.prepare('DELETE FROM mistake_records WHERE photo_path = ?').run('/uploads/retained-only.jpg');
  db.prepare('DELETE FROM photo_expectations WHERE name = ?').run('retained-only.jpg');
  fs.rmSync(path.join(dir, 'uploads', 'retained-only.jpg'), { force: true });
  fs.rmSync(app.backupService.photos.path('retained-only.jpg'), { force: true });
  const requestUiDownload = async label => {
    const ticketResponse = page.waitForResponse(r => r.url().endsWith('/api/backups/photos/export-ticket'));
    await page.getByRole('button', { name: label, exact: true }).click();
    const issued = await ticketResponse;
    if (issued.status() !== 200) assert.fail(await issued.text());
    const body = await issued.json();
    const warning = page.getByRole('alert').filter({ hasText: '本次导出跳过' });
    await warning.waitFor({ state: body.skipped?.length ? 'visible' : 'detached' });
    return download(label === '下载新照片' ? 'new' : 'all', { status: 200, body });
  };
  const emptyExport = await requestUiDownload('下载全部照片');
  assert.deepEqual(names(emptyExport), ['current.jpg', 'new.jpg', 'retained.jpg']);
  assert.match(await page.getByRole('alert').first().textContent(), /本次导出跳过 1 张照片/);
  await page.locator('input[accept*=tar]').setInputFiles(retainedPackage);
  const importedResponse = page.waitForResponse(r => r.url().endsWith('/api/backups/photos/import'));
  await page.getByRole('button', { name: '上传照片包', exact: true }).click();
  assert.equal((await importedResponse).status(), 200);
  await page.getByText(/已补齐或修复 1 张照片/).waitFor();
  assert.doesNotMatch(await page.locator('[role=status]').first().textContent(), /已不需要/);
  const afterRepair = await requestUiDownload('下载全部照片');
  assert.ok(names(afterRepair).includes('retained-only.jpg'));
  console.log('PASS settings page imports a trusted retained-only photo and the next full export includes it');

  add('broken.jpg', 'broken'); add('missing.jpg', 'missing');
  await app.backupService.create();
  for (const name of ['broken.jpg', 'missing.jpg']) {
    fs.rmSync(app.backupService.photos.path(name)); fs.rmSync(path.join(dir, 'uploads', name));
  }
  fs.writeFileSync(app.backupService.photos.path('broken.jpg'), 'WRONG!');
  const partial = await api('/api/backups/photos/export-ticket', { scope: 'all' });
  assert.equal(partial.status, 200); assert.equal(partial.body.included_count, 4);
  assert.deepEqual(partial.body.skipped.map(p => [p.name, p.subject, p.description, p.reason]),
    [['broken.jpg', '数学', 'broken.jpg', 'mismatch'], ['missing.jpg', '数学', 'missing.jpg', 'absent']]);
  assert.deepEqual(names(await download('all', partial)), ['current.jpg', 'new.jpg', 'retained-only.jpg', 'retained.jpg']);
  assert.equal((await api('/api/backups')).body.photo_export.pending_count, 2);
  console.log('PASS ticket reports bad and absent photos; native download completes with remaining photos only');
  const late = await api('/api/backups/photos/export-ticket', { scope: 'all' });
  for (const file of [app.backupService.photos.path('new.jpg'), path.join(dir, 'uploads', 'new.jpg')]) fs.writeFileSync(file, 'BAD');
  assert.deepEqual(names(await download('all', late)), ['current.jpg', 'retained-only.jpg', 'retained.jpg']);
  assert.ok(!app.backupService.exportState().names.includes('broken.jpg'));
  assert.ok(!app.backupService.exportState().names.includes('missing.jpg'));
  console.log('PASS corruption after ticket issuance skips that photo without failing the browser download');
  await context.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
