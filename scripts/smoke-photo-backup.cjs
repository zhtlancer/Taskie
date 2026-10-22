// Run npm run build first. Verifies the split photo backup from the settings page against two real
// in-memory servers: downloading a photo package (all, then only new photos), restoring the data
// backup on another server, seeing the missing photos and filling them by uploading the package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { TarReader } = require('../backend/src/utils/tar');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-photo-backup-'));
const servers = [];
function server(label) {
  const db = getDb(':memory:');
  db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
  const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
    uploadDir: path.join(dir, label, 'uploads'), backupDir: path.join(dir, label, 'backups'),
    authorizedTokensFile: path.join(dir, label, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
  servers.push({ app, db });
  return { app, db };
}
const tarNames = file => {
  const names = [];
  const reader = new TarReader(name => names.push(name), { maxFileSize: 1e9 });
  reader.push(fs.readFileSync(file));
  reader.end();
  return names.sort();
};
let browser;
async function main() {
  const home = server('home'), away = server('away');
  await home.app.ready(); await away.app.ready();
  const child = home.app.services.childrenService.createChild({ name: '照片备份验收' });
  const addPhoto = (name, content) => {
    fs.writeFileSync(path.join(dir, 'home', 'uploads', name), content);
    home.app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: name, photo_path: `/uploads/${name}` });
  };
  addPhoto('first.jpg', 'first photo');
  addPhoto('second.webp', 'second photo');
  const homeBase = await home.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const errors = [];
  async function open(app, base) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await context.addInitScript(token => sessionStorage.setItem('taskie_parent_token', token), app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
    return page;
  }

  let page = await open(home.app, homeBase);
  await page.getByRole('heading', { name: '错题照片' }).waitFor();
  assert.equal(await page.getByRole('button', { name: /下载新照片/ }).count(), 0, 'no "new photos" before a first package');
  let download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载全部照片', exact: true }).click();
  const all = await download;
  assert.match(all.suggestedFilename(), /^taskie-photos-\d{4}-\d{2}-\d{2}\.tar$/);
  const allFile = path.join(dir, 'all.tar');
  await all.saveAs(allFile);
  assert.deepEqual(tarNames(allFile), ['first.jpg', 'second.webp']);
  console.log('PASS the settings page downloads a package of all photos');

  await new Promise(resolve => setTimeout(resolve, 50));
  addPhoto('third.jpg', 'third photo');
  download = page.waitForEvent('download');
  await page.getByRole('button', { name: /下载新照片/ }).click();
  const fresh = await download;
  const freshFile = path.join(dir, 'new.tar');
  await fresh.saveAs(freshFile);
  assert.deepEqual(tarNames(freshFile), ['third.jpg']);
  console.log('PASS a later package holds only the photos added since the last one');

  // The data backup is small and holds no photos.
  await page.getByRole('button', { name: '立即创建备份', exact: true }).click();
  await page.getByText('备份已保存').waitFor();
  const backup = home.app.backupService.list()[0];
  assert.ok(backup.size < 200 * 1024, `data backup is ${backup.size} bytes`);
  await page.context().close();

  // Another server: restore the data, then fill the photos from both packages.
  const result = away.app.backupService.restore(fs.readFileSync(home.app.backupService.getPath(backup.name)));
  assert.deepEqual(result.missing_photos.sort(), ['first.jpg', 'second.webp', 'third.jpg']);
  await home.app.close();
  const awayBase = await away.app.listen({ host: '127.0.0.1', port: smokePort() });
  page = await open(away.app, awayBase);
  const alert = page.getByRole('alert').filter({ hasText: '错题照片不在这台服务器上' });
  await alert.getByText('有 3 张错题照片不在这台服务器上').waitFor();
  for (const [file, left] of [[allFile, '还缺 1 张。'], [freshFile, '照片已全部齐全。']]) {
    await alert.locator('input[type=file]').setInputFiles(file);
    await alert.getByRole('button', { name: '上传照片包', exact: true }).click();
    await page.getByRole('status').getByText(left, { exact: false }).waitFor();
  }
  await alert.waitFor({ state: 'detached' });
  assert.equal(fs.readFileSync(path.join(dir, 'away', 'uploads', 'third.jpg'), 'utf8'), 'third photo');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const button of await page.getByRole('button', { name: /照片/ }).all()) assert.ok((await button.boundingBox()).height >= 44);
  assert.deepEqual(errors, []);
  console.log('PASS on another server the missing photos are listed and filled by uploading the packages');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  for (const { app, db } of servers) { await app.close().catch(() => {}); db.close(); }
  fs.rmSync(dir, { recursive: true, force: true });
});
