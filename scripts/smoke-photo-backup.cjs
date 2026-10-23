// Run npm run build first. Verifies the split photo backup from the settings page against two real
// in-memory servers: downloading a photo package (all, then only new photos), restoring the data
// backup on another server, seeing the missing photos and filling them by uploading the package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
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
  let exportClosed, failedResponse;
  home.app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/backups/photos/export?')) reply.raw.once('close', () => exportClosed?.());
  });
  home.app.addHook('onResponse', async (request, reply) => {
    if (request.url.startsWith('/api/backups/photos/export?')) failedResponse?.(reply.statusCode);
  });
  await home.app.ready(); await away.app.ready();
  const child = home.app.services.childrenService.createChild({ name: '照片备份验收' });
  const addPhoto = (name, content, subject = '数学', description = '分数应用题') => {
    fs.writeFileSync(path.join(dir, 'home', 'uploads', name), content);
    const record = home.app.services.mistakesService.createMistake({ child_id: child.id, subject, description, photo_path: `/uploads/${name}` });
    home.db.prepare('UPDATE mistake_records SET created_at = ? WHERE id = ?').run('2026-10-22T16:30:00.000Z', record.id);
  };
  addPhoto('first.jpg', 'first photo');
  addPhoto('second.webp', 'second photo', '语文', '阅读理解中的人物描写');
  const homeBase = await home.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const errors = [];
  async function open(app, base, width = 390, theme = 'dark') {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme: theme, timezoneId: 'America/Los_Angeles', acceptDownloads: true });
    await context.addInitScript(({ token, theme }) => {
      sessionStorage.setItem('taskie_parent_token', token);
      localStorage.setItem('taskie_theme', theme);
    }, { token: app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }), theme });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
    return page;
  }

  let page = await open(home.app, homeBase);
  await page.getByRole('heading', { name: '错题照片' }).waitFor();
  // Seed the old marker with a future time: the UI must discard it and use scope, never since.
  await page.evaluate(() => localStorage.setItem('taskie_photo_export_at', '2099-01-01T00:00:00.000Z'));
  await page.reload({ waitUntil: 'networkidle' });
  const requests = [];
  const trackRequests = page => page.on('request', request => {
    if (request.url().endsWith('/photos/export-ticket')) requests.push(request.postDataJSON());
  });
  trackRequests(page);
  if (process.env.PHOTO_REGRESSION_FILTER !== 'missing') {
    // Start a real streamed download, cancel after its first bytes, then verify both server and UI.
    const originalExport = home.app.backupService.exportPhotos.bind(home.app.backupService);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    home.app.backupService.exportPhotos = scope => {
      const source = originalExport(scope);
      const slow = Readable.from((async function* () {
        let first = true;
        for await (const chunk of source) {
          yield chunk;
          if (first) { first = false; await gate; }
        }
      })());
      slow.photoNames = source.photoNames;
      return slow;
    };
    const before = (await home.app.backupService.photoExportStatus());
    let closeTimer;
    const closed = new Promise((resolve, reject) => {
      exportClosed = resolve;
      closeTimer = setTimeout(() => reject(new Error('cancelled response did not close')), 10000);
    });
    try {
      const interrupted = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载全部照片', exact: true }).click();
      assert.deepEqual(requests.at(-1), { scope: 'all' });
      await (await interrupted).cancel();
      await closed;
      assert.deepEqual((await home.app.backupService.photoExportStatus()), before);
      await page.getByRole('button', { name: '刷新导出状态', exact: true }).click();
      await page.getByText('尚未完整导出照片').waitFor();
      await page.getByText('还有 2 张未导出', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => localStorage.getItem('taskie_photo_export_at')), null);
      console.log('PASS interrupted native download advances neither server history nor displayed export status');
    } finally {
      clearTimeout(closeTimer); release(); exportClosed = null;
      home.app.backupService.exportPhotos = originalExport;
    }
    await page.context().close();
    page = await open(home.app, homeBase);
    trackRequests(page);

    // GET failure after a valid ticket must also leave the history untouched.
    let failedTimer;
    const failedGet = new Promise((resolve, reject) => {
      failedResponse = resolve;
      failedTimer = setTimeout(() => reject(new Error('failed export GET not received')), 10000);
    });
    home.app.backupService.exportPhotos = () => { const error = new Error('download unavailable'); error.statusCode = 503; throw error; };
    try {
      await page.getByRole('button', { name: /下载新照片/ }).click();
      assert.equal(await failedGet, 503);
    } finally {
      clearTimeout(failedTimer); failedResponse = null;
      home.app.backupService.exportPhotos = originalExport;
    }
    assert.deepEqual((await home.app.backupService.photoExportStatus()), before);
    console.log('PASS failed export GET after ticket creation leaves photos pending');
    await page.context().close();
    page = await open(home.app, homeBase);
    trackRequests(page);

    let download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载全部照片', exact: true }).click();
    const all = await download;
    assert.match(all.suggestedFilename(), /^taskie-photos-\d{4}-\d{2}-\d{2}\.tar$/);
    const allFile = path.join(dir, 'all.tar');
    await all.saveAs(allFile);
    assert.deepEqual(tarNames(allFile), ['first.jpg', 'second.webp']);
    await page.getByRole('button', { name: '刷新导出状态', exact: true }).click();
    await page.getByText('还有 0 张未导出', { exact: true }).waitFor();
    await page.getByText(/上次完整导出：/).waitFor();
    assert.equal((await home.app.backupService.photoExportStatus()).exported_count, 2);
    console.log('PASS the settings page downloads a package of all photos');

    await page.clock.install({ time: new Date('2099-01-01T00:00:00Z') });
    addPhoto('third.jpg', 'third photo');
    fs.utimesSync(path.join(dir, 'home', 'uploads', 'third.jpg'), 0, 0);
    await page.getByRole('button', { name: '刷新导出状态', exact: true }).click();
    await page.getByText('还有 1 张未导出', { exact: true }).waitFor();
    download = page.waitForEvent('download');
    await page.getByRole('button', { name: /下载新照片/ }).click();
    const fresh = await download;
    const freshFile = path.join(dir, 'new.tar');
    await fresh.saveAs(freshFile);
    assert.deepEqual(tarNames(freshFile), ['third.jpg']);
    assert.deepEqual(requests.at(-1), { scope: 'new' });
    assert.equal(await page.evaluate(() => localStorage.getItem('taskie_photo_export_at')), null);
    console.log('PASS incremental UI export ignores a fast device clock, legacy marker and old photo mtime');

    // A new browser has the same family-wide history, and can still download all photos.
    const other = await open(home.app, homeBase, 1180, 'light');
    await other.getByText('还有 0 张未导出', { exact: true }).waitFor();
    await other.getByText(/上次完整导出：/).waitFor();
    download = other.waitForEvent('download');
    await other.getByRole('button', { name: /下载新照片/ }).click();
    const repeated = path.join(dir, 'repeated.tar');
    await (await download).saveAs(repeated);
    assert.deepEqual(tarNames(repeated), []);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText('还有 0 张未导出', { exact: true }).waitFor();
    assert.equal(await other.getByRole('button', { name: '下载全部照片', exact: true }).isEnabled(), true);
    for (const text of ['导出记录是全家共用的，不区分设备', '浏览器收到照片包但没有保存成功', '下载全部照片始终是最保险的做法']) await other.getByText(text, { exact: false }).waitFor();
    await other.context().close();
    console.log('PASS another device shares export state, repeated new export is empty and all export remains available');

    // The data backup is small and holds no photos.
    await page.getByRole('button', { name: '立即创建备份', exact: true }).click();
    await page.getByText('备份已保存').waitFor();
    const backup = home.app.backupService.list()[0];
    assert.ok(backup.size < 200 * 1024, `data backup is ${backup.size} bytes`);
    await page.context().close();
    await missingFlow(backup, allFile, freshFile);
  } else {
    // Independently exercise missing-photo rendering on the pre-fix UI too.
    await page.context().close();
    addPhoto('third.jpg', 'third photo');
    const backup = (await home.app.backupService.create());
    const chunks = [];
    for await (const chunk of home.app.backupService.exportPhotos('all')) chunks.push(chunk);
    const allFile = path.join(dir, 'all.tar'); fs.writeFileSync(allFile, Buffer.concat(chunks));
    await missingFlow(backup, allFile);
  }

  async function missingFlow(backup, allFile, freshFile) {
    // Another server: restore the data, then fill the photos from both packages.
    const result = (await away.app.backupService.restore(fs.readFileSync(home.app.backupService.getPath(backup.name))));
    assert.deepEqual(result.missing_photos.sort(), ['first.jpg', 'second.webp', 'third.jpg']);
    await home.app.close();
    const awayBase = await away.app.listen({ host: '127.0.0.1', port: smokePort() });
    // Restore supplies the trusted hashes. Add same-size wrong bytes for one referenced photo.
    fs.writeFileSync(path.join(dir, 'away', 'uploads', 'second.webp'), 'WRONG PHOTO!');
    for (const width of [390, 1180]) for (const theme of ['light', 'dark']) {
      page = await open(away.app, awayBase, width, theme);
      const alert = page.getByRole('alert').filter({ hasText: '张错题照片需要补齐' });
      await alert.getByText('有 3 张错题照片需要补齐：不存在 2 张，校验不一致 1 张。', { exact: true }).waitFor();
      const items = alert.getByRole('listitem');
      assert.equal(await items.count(), 3);
      await items.filter({ hasText: '阅读理解中的人物描写' }).getByText('校验不一致', { exact: true }).waitFor();
      await items.filter({ hasText: '分数应用题' }).first().getByText('不存在', { exact: true }).waitFor();
      await alert.getByText('语文 · 2026-10-23', { exact: true }).waitFor();
      assert.ok(!(await alert.textContent()).includes('[object Object]'));
      assert.ok(!(await alert.textContent()).includes('second.webp'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const button of await page.getByRole('button', { name: /照片|导出/ }).all()) {
        // The native file picker is opened by its whole enclosing label.
        const target = await button.getAttribute('type') === 'file' ? button.locator('..') : button;
        const box = await target.boundingBox();
        assert.ok(box.height >= 44, `${await button.evaluate(el => el.outerHTML)}: ${JSON.stringify(box)}`);
      }
      if (process.env.SMOKE_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
        await alert.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, `missing-${width}-${theme}.png`) });
      }
      await page.context().close();
      console.log(`PASS missing photo subject, family date, description and absent/mismatch at ${width}px ${theme}`);
    }
    page = await open(away.app, awayBase);
    const alert = page.getByRole('alert').filter({ hasText: '张错题照片需要补齐' });
    for (const [file, left] of (freshFile ? [[allFile, '还缺 1 张。'], [freshFile, '照片已全部齐全。']] : [[allFile, '照片已全部齐全。']])) {
      await alert.locator('input[type=file]').setInputFiles(file);
      await alert.getByRole('button', { name: '上传照片包', exact: true }).click();
      await page.getByRole('status').getByText(left, { exact: false }).waitFor();
    }
    await alert.waitFor({ state: 'detached' });
    assert.equal(fs.readFileSync(path.join(dir, 'away', 'uploads', 'third.jpg'), 'utf8'), 'third photo');
    assert.equal(fs.readFileSync(path.join(dir, 'away', 'uploads', 'second.webp'), 'utf8'), 'second photo');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const button of await page.getByRole('button', { name: /照片/ }).all()) assert.ok((await button.boundingBox()).height >= 44);
    assert.deepEqual(errors, []);
    console.log('PASS on another server the missing photos are listed and filled by uploading the packages');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  for (const { app, db } of servers) { await app.close().catch(() => {}); db.close(); }
  fs.rmSync(dir, { recursive: true, force: true });
});
