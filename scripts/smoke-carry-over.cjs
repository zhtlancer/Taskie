// Run npm run build first. Uses in-memory SQLite and cleans up its local server and files.
// Set PLAYWRIGHT_MODULE_PATH / CHROMIUM_PATH if Chromium is installed outside this project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-carry-over-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({
  db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist')
});
let browser;
const pass = message => console.log(`PASS ${message}`);

async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };
  const children = [];
  for (const name of ['校历验收甲', '校历验收乙', '校历验收丙']) children.push(await api('POST', '/children', { name }));
  const duplicateDate = shiftDate(getTodayDate(), 1);
  const normalDate = shiftDate(getTodayDate(), 8);
  const existing = [];
  for (const [child, acts_as] of [[children[0], 1], [children[2], 3]]) {
    existing.push(await api('POST', `/children/${child.id}/makeup-days`, { date: duplicateDate, acts_as, note: '保留原设置' }));
  }
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Shanghai' });
  await context.addInitScript(value => sessionStorage.setItem('taskie_parent_token', value), token);
  const page = await context.newPage();
  const errors = [];
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());

  await page.goto(`${base}/parent/tasks`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /新增任务模板/ }).click();
  await page.getByPlaceholder(/例如：/).fill('可延后口算');
  await page.getByLabel('🏖️ 放假前一天的可以在假期里补完', { exact: false }).check();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByText('可延后口算', { exact: true }).waitFor();
  assert.equal((await api('GET', '/task-templates')).find(t => t.title === '可延后口算').carry_over, true);
  pass('parent form saves the carry-over template setting');

  await page.goto(`${base}/parent/periods`, { waitUntil: 'domcontentloaded' });
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '🔁 调休上学日', exact: true }) });
  await section.waitFor();
  await page.getByRole('button', { name: /校历验收甲/ }).click();
  const dateInput = section.locator('input[type=date]');
  const add = section.getByRole('button', { name: '➕ 添加', exact: true });
  const waitForReset = () => page.waitForFunction(() => document.querySelector('section form input[type=date]')?.value === '');
  await dateInput.fill(normalDate);
  await section.locator('select').selectOption('5');
  await add.click();
  await waitForReset();
  for (const child of children) {
    assert.equal((await api('GET', `/children/${child.id}/makeup-days`)).find(day => day.date === normalDate).acts_as, 5);
  }
  pass('a new make-up date is added for every child');

  // Both the selected child and a later sibling already have the date. Neither may stop the
  // missing sibling getting it, change an existing setting or cause a conflict notification.
  await dateInput.fill(duplicateDate);
  await add.click();
  await waitForReset();
  const rows = [];
  for (const child of children) rows.push(await api('GET', `/children/${child.id}/makeup-days`));
  assert.deepEqual(rows[0].find(day => day.date === duplicateDate), existing[0]);
  assert.equal(rows[1].find(day => day.date === duplicateDate).acts_as, 5);
  assert.deepEqual(rows[2].find(day => day.date === duplicateDate), existing[1]);
  assert.equal(await page.getByText('这天已经设为调休上学日', { exact: true }).count(), 0);
  await dateInput.fill(duplicateDate);
  await add.click();
  await waitForReset();
  for (const [index, child] of children.entries()) {
    assert.deepEqual(await api('GET', `/children/${child.id}/makeup-days`), rows[index]);
  }
  pass('batch retries skip existing dates for all children and preserve their settings without conflict messages');

  // Single-child duplicate protection still reports a real conflict.
  await section.getByLabel('所有孩子都加').uncheck();
  await dateInput.fill(duplicateDate);
  const conflict = page.waitForResponse(response => response.url().endsWith(`/children/${children[0].id}/makeup-days`) && response.request().method() === 'POST');
  await add.click();
  assert.equal((await conflict).status(), 409);
  await page.getByText('这天已经设为调休上学日', { exact: true }).first().waitFor();
  pass('single-child duplicate dates still report conflicts');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  pass('make-up form fits a 390px phone viewport without browser errors');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
