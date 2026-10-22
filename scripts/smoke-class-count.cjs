// npm run build first; exercises the real creation/edit form in phone/tablet light/dark modes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-class-count-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  app.services.childrenService.createChild({ name: '排课验收' });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const errors = [];
  for (const width of [390, 1180]) for (const colorScheme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme, timezoneId: 'America/Los_Angeles' });
    await context.addInitScript(value => sessionStorage.setItem('taskie_parent_token', value), token);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(`${base}/parent/schedule`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '➕ 新增课外班', exact: true }).click();
    let modal = page.getByRole('dialog', { name: '新增课外班', exact: true });
    const title = `按次钢琴-${width}-${colorScheme}`;
    assert.equal(await modal.getByLabel('排课方式').inputValue(), 'count');
    await modal.getByLabel('课程名称').fill(title);
    await modal.getByLabel('从哪天开始').fill('2026-10-19');
    await modal.getByRole('button', { name: '周三', exact: true }).click();
    await modal.getByRole('button', { name: '周六', exact: true }).click();
    await modal.getByLabel('总课次').fill('3');
    await modal.getByRole('region', { name: '排课预览' }).getByText('共 3 次 · 首课 2026-10-21 · 最后一次 2026-10-28', { exact: true }).waitFor();
    await modal.getByText('查看全部课次', { exact: true }).click();
    assert.equal(await modal.locator('ol li').count(), 3);
    await modal.getByText('第 3 次 · 2026-10-28 周三 16:30–17:30', { exact: true }).waitFor();
    await modal.getByLabel('总课次').fill('0');
    assert.equal(await modal.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    await modal.getByLabel('总课次').fill('3');
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/outside-classes'));
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    const response = await saved;
    assert.equal(response.status(), 201);
    const created = await response.json();
    assert.deepEqual([created.total_lessons, created.end_date], [3, '2026-10-28']);
    await modal.waitFor({ state: 'detached' });
    const card = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(title, { exact: true }) });
    await card.getByText('共 3 次', { exact: true }).waitFor();
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    modal = page.getByRole('dialog', { name: '编辑课外班', exact: true });
    assert.equal(await modal.getByLabel('总课次').inputValue(), '3');
    await modal.getByLabel('排课方式').selectOption('date');
    await modal.getByLabel('到哪天结束').fill('2026-11-30');
    const updated = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/outside-classes/${created.id}`));
    await modal.getByRole('button', { name: '保存', exact: true }).click();
    const changed = await (await updated).json();
    assert.deepEqual([changed.total_lessons, changed.end_date], [null, '2026-11-30']);
    await modal.waitFor({ state: 'detached' });
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    modal = page.getByRole('dialog', { name: '编辑课外班', exact: true });
    assert.equal(await modal.getByLabel('排课方式').inputValue(), 'date');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'detached' });
    await context.close();
    console.log(`PASS ${width}px ${colorScheme}: count preview, bounds, save/edit and legacy date mode`);
  }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
