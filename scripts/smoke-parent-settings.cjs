// Build first. Uses real backups, device pairing and photo import in an isolated database/workspace.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { tarStream } = require('../backend/src/utils/tar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-parent-settings-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
const heldResponses = new Map();
app.addHook('onSend', async (request, reply, payload) => {
  const held = heldResponses.get(`${request.method} ${request.url.split('?')[0]}`);
  if (held) { held.writes++; held.arrived(); await held.gate; }
  return payload;
});
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() }), errors = [];
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: `设置${width}${theme}` });
    const name = `settings-${width}-${theme}.jpg`, source = path.join(dir, 'uploads', name);
    fs.writeFileSync(source, `isolated photo ${width}/${theme}`);
    app.services.mistakesService.createMistake({ child_id: child.id, subject: '数学', description: '设置回归照片', photo_path: `/uploads/${name}` });
    const backup = await app.backupService.create();
    const chunks = []; for await (const chunk of tarStream([{ name, file: source }])) chunks.push(chunk);
    const archive = { name: `照片包-${'长文件名'.repeat(12)}.tar`, mimeType: 'application/x-tar', buffer: Buffer.concat(chunks) };
    const pairing = app.deviceRegistry.startPairing(`settings-test-device-${width}-${theme}-${'x'.repeat(32)}`);
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
    const context = await browser.newContext({ viewport: { width, height: 1100 }, hasTouch: true, colorScheme: theme, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => {
        if (!sessionStorage.getItem('settings_test_initialized')) {
          sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('settings_test_initialized', 'true');
        }
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
      const go = () => page.goto(`${base}/parent/settings`, { waitUntil: 'networkidle' });
      const section = key => page.locator(`[data-settings-section="${key}"]`);
      const toast = async () => { const close = page.getByRole('button', { name: '关闭错误提示', exact: true }); if (await close.count()) await close.click(); };
      const hold = async (url, method) => {
        let release, arrived;
        const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { arrived = resolve; });
        const pathname = url.replace(/^\*\*/, '').replace('?*', ''), key = `${method} ${pathname}`;
        const held = { writes: 0, arrived, gate, release }; heldResponses.set(key, held);
        // Hold the real server response so binary multipart bodies reach the server unchanged.
        const finished = page.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === method);
        return { started, finished, release: () => { heldResponses.delete(key); release(); }, writes: () => held.writes };
      };
      const protectedWrite = async form => {
        assert.ok(await page.locator('main fieldset input, main fieldset button').evaluateAll(fields => fields.every(f => f.matches(':disabled'))));
        const before = page.url();
        await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '学习安排', exact: true }).evaluate(el => el.click());
        await page.waitForTimeout(50); assert.equal(page.url(), before);
        await form.evaluate(el => el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      };
      // Authorization history can be slow without holding up the backup list or upload form.
      const eventsUrl = '**/api/devices/events?*', slowEvents = await hold(eventsUrl, 'GET');
      await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' }); await slowEvents.started;
      await section('backups').getByRole('button', { name: '立即创建备份', exact: true }).waitFor();
      await section('backups').getByText(backup.name, { exact: true }).waitFor();
      assert.equal(await section('photos').locator('input[type=file]').isDisabled(), false);
      slowEvents.release(); await slowEvents.finished; await page.unroute(eventsUrl);
      for (const [url, key, title] of [
        ['**/api/backups', 'backups', '备份状态未能读取'],
        ['**/api/devices', 'devices', '授权设备未能读取'],
        [eventsUrl, 'devices', '授权记录未能读取']
      ]) {
        await page.route(url, route => route.fulfill({ status: 503, json: { error: '读取暂时失败' } }));
        await go();
        const failed = section(key).locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
        await failed.waitFor();
        if (key === 'backups') {
          assert.equal(await section('backups').getByText('暂无备份', { exact: true }).count(), 0);
          assert.equal(await section('backups').getByText(/自动备份已关闭/).count(), 0);
          await section('devices').getByText('最近的授权记录', { exact: true }).waitFor();
        } else await section('backups').getByText(backup.name, { exact: true }).waitFor();
        await toast(); await page.unroute(url);
        await failed.getByRole('button', { name: '重新读取', exact: true }).click(); await failed.waitFor({ state: 'detached' });
      }
      // A committed backup with a failed list refresh is a success plus a read error, never a second write.
      const backupWrite = await hold('**/api/backups', 'POST');
      await section('backups').getByRole('button', { name: '立即创建备份', exact: true }).click(); await backupWrite.started;
      assert.ok(await section('restore').getByLabel('当前家长 PIN', { exact: true }).isDisabled());
      const old = page.url();
      await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '学习安排', exact: true }).evaluate(el => el.click());
      await page.waitForTimeout(50); assert.equal(page.url(), old);
      await page.route('**/api/backups', route => route.request().method() === 'GET'
        ? route.fulfill({ status: 503, json: { error: '备份已写入，列表读取失败' } }) : route.fallback());
      backupWrite.release(); await backupWrite.finished;
      await section('backups').getByRole('status').getByText('备份已保存，可以下载到另一台设备。', { exact: true }).waitFor();
      await section('backups').getByRole('heading', { name: '备份状态未能读取', exact: true }).waitFor(); await toast();
      assert.equal(backupWrite.writes(), 1);
      await page.unroute('**/api/backups');
      await section('backups').getByRole('button', { name: '重新读取', exact: true }).click();
      await section('backups').getByText(backup.name, { exact: true }).waitFor();
      // Failed authorization retains both inputs; accepted authorization survives failed follow-up reads.
      const deviceForm = section('devices').locator('form');
      await deviceForm.getByLabel('配对码', { exact: true }).fill(pairing.code);
      const deviceName = `${width}${theme}${'家用平板'.repeat(4)}`;
      await deviceForm.getByLabel('设备名称', { exact: true }).fill(deviceName);
      const approveUrl = '**/api/devices/approve';
      await page.route(approveUrl, route => route.fulfill({ status: 400, json: { error: '授权未完成，请重试' } }));
      await deviceForm.getByRole('button', { name: '授权这台设备', exact: true }).click();
      await section('devices').getByRole('alert').getByText('授权未完成，请重试', { exact: true }).waitFor(); await toast();
      assert.equal(await deviceForm.getByLabel('配对码', { exact: true }).inputValue(), pairing.code);
      assert.equal(await deviceForm.getByLabel('设备名称', { exact: true }).inputValue(), deviceName);
      await page.unroute(approveUrl); const approveWrite = await hold(approveUrl, 'POST');
      await deviceForm.getByRole('button', { name: '授权这台设备', exact: true }).click(); await approveWrite.started;
      await protectedWrite(deviceForm); assert.equal(approveWrite.writes(), 1);
      await page.route('**/api/devices', route => route.fulfill({ status: 503, json: { error: '授权成功，设备列表读取失败' } }));
      approveWrite.release(); await approveWrite.finished; await page.unroute(approveUrl);
      await section('devices').getByRole('status').getByText(`已授权「${deviceName}」，新设备页面会自动进入应用。`, { exact: true }).waitFor();
      await section('devices').getByRole('heading', { name: '授权设备未能读取', exact: true }).waitFor(); await toast();
      assert.equal(await deviceForm.getByLabel('配对码', { exact: true }).inputValue(), '');
      await page.unroute('**/api/devices');
      await section('devices').getByRole('button', { name: '重新读取', exact: true }).click();
      await section('devices').getByText(deviceName, { exact: true }).waitFor();
      // Upload uses a real trusted photo archive and keeps its selected file after a validation failure.
      const photoForm = section('photos').locator('form'), importUrl = '**/api/backups/photos/import';
      await photoForm.locator('input[type=file]').setInputFiles(archive);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long selected filename fits the page');
      await page.route(importUrl, route => route.fulfill({ status: 400, json: { error: '照片包暂时无法导入' } }));
      await photoForm.getByRole('button', { name: '上传照片包', exact: true }).click();
      await section('photos').getByRole('alert').getByText('照片包暂时无法导入', { exact: true }).waitFor(); await toast();
      assert.equal(await photoForm.locator('input[type=file]').evaluate(el => el.files[0]?.name), archive.name);
      await page.unroute(importUrl); const photoWrite = await hold(importUrl, 'POST');
      await photoForm.getByRole('button', { name: '上传照片包', exact: true }).click(); await photoWrite.started;
      await protectedWrite(photoForm); assert.equal(photoWrite.writes(), 1);
      await section('photos').getByRole('progressbar', { name: '照片包上传进度', exact: true }).waitFor();
      await page.route('**/api/backups', route => route.fulfill({ status: 503, json: { error: '照片已处理，状态读取失败' } }));
      photoWrite.release(); await photoWrite.finished; await page.unroute(importUrl);
      await section('photos').getByRole('status').filter({ hasText: /已补齐或修复/ }).waitFor();
      await section('photos').getByRole('heading', { name: '照片状态未能读取', exact: true }).waitFor(); await toast();
      assert.equal(await photoForm.locator('input[type=file]').evaluate(el => el.files.length), 0);
      await page.unroute('**/api/backups');
      await section('photos').getByRole('button', { name: '重新读取', exact: true }).click();
      await section('photos').getByRole('heading', { name: '正在读取照片状态…', exact: true }).waitFor({ state: 'detached' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `settings-${width}-${theme}.png`), fullPage: true });
      }
      const device = app.deviceRegistry.list().find(item => item.label === deviceName);
      const deviceRow = section('devices').locator('li').filter({ has: page.getByText(deviceName, { exact: true }) });
      const revokeWrite = await hold(`**/api/devices/${device.id}`, 'DELETE');
      await deviceRow.getByRole('button', { name: '撤销', exact: true }).click();
      await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      await revokeWrite.started;
      assert.ok(await deviceForm.getByLabel('配对码', { exact: true }).isDisabled());
      await page.route('**/api/devices', route => route.fulfill({ status: 503, json: { error: '撤销成功，设备列表读取失败' } }));
      revokeWrite.release(); await revokeWrite.finished;
      await section('devices').getByRole('status').getByText(`已撤销「${deviceName}」。`, { exact: true }).waitFor();
      await section('devices').getByRole('heading', { name: '授权设备未能读取', exact: true }).waitFor(); await toast();
      assert.equal(await deviceRow.count(), 0, 'accepted revocation removes the stale row even if refresh fails');
      assert.equal(revokeWrite.writes(), 1); await page.unroute('**/api/devices');
      if (width === 390 && theme === 'light') {
        // Rejected PIN changes retain input. A real accepted change reaches login while pending writes remain intact.
        const originalHash = db.prepare("SELECT value FROM settings WHERE key='parent_pin_hash'").get().value;
        const pinForm = section('pin').locator('form'), pinUrl = '**/api/auth/parent-pin';
        await pinForm.getByLabel('当前 PIN', { exact: true }).fill('1234');
        await pinForm.getByLabel('新 PIN', { exact: true }).fill('5678');
        await page.route(pinUrl, route => route.fulfill({ status: 400, json: { error: 'PIN 暂时未能更新' } }));
        await pinForm.getByRole('button', { name: '保存 PIN', exact: true }).click();
        await section('pin').getByRole('alert').getByText('PIN 暂时未能更新', { exact: true }).waitFor(); await toast();
        assert.equal(await pinForm.getByLabel('新 PIN', { exact: true }).inputValue(), '5678');
        await page.unroute(pinUrl); const pinWrite = await hold(pinUrl, 'PUT');
        await pinForm.getByRole('button', { name: '保存 PIN', exact: true }).click(); await pinWrite.started;
        await protectedWrite(pinForm); assert.equal(pinWrite.writes(), 1); pinWrite.release(); await pinWrite.finished;
        await page.waitForURL('**/parent/login'); await page.unroute(pinUrl);
        db.prepare("UPDATE settings SET value=? WHERE key='parent_pin_hash'").run(originalHash);
        await page.evaluate(token => sessionStorage.setItem('taskie_parent_token', token), app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }));
        await go();
        const restoreForm = section('restore').locator('form');
        await restoreForm.locator('input[type=file]').setInputFiles(app.backupService.getPath(backup.name));
        await restoreForm.getByLabel('当前家长 PIN', { exact: true }).fill('0000');
        await restoreForm.getByRole('checkbox', { name: '我确认用备份替换当前数据', exact: true }).check();
        await restoreForm.getByRole('button', { name: '确认恢复', exact: true }).click();
        await section('restore').getByRole('alert').waitFor(); await toast();
        assert.ok(await restoreForm.locator('input[type=file]').evaluate(el => el.files.length === 1));
        await restoreForm.getByLabel('当前家长 PIN', { exact: true }).fill('1234');
        const restoreUrl = '**/api/backups/restore', restoreWrite = await hold(restoreUrl, 'POST');
        await restoreForm.getByRole('button', { name: '确认恢复', exact: true }).click(); await restoreWrite.started;
        await protectedWrite(restoreForm); assert.equal(restoreWrite.writes(), 1); restoreWrite.release(); await restoreWrite.finished;
        await page.waitForURL('**/parent/login').catch(async error => {
          console.error('Restore result:', page.url(), await section('restore').innerText()); throw error;
        });
        assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')), null);
        console.log('PASS real PIN change and backup restore: rejected input retention, input locks, duplicate submit and navigation protection');
      }
      console.log(`PASS ${width}/${theme}: independent reads/retries, accepted writes vs refresh errors, input retention, guarded pairing/revocation/upload and long-name layout`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  for (const held of heldResponses.values()) held.release(); heldResponses.clear();
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
