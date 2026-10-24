// Family calendar regression: real API + production UI, with a different device calendar.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RealDate = Date;
const zone = process.argv[2] || process.env.TIME_ZONE || 'America/New_York';
process.env.TIME_ZONE = zone;
const instant = zone === 'Asia/Shanghai' ? '2026-10-20T16:30:00Z' : '2026-10-21T05:30:00Z';
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return RealDate.parse(instant); }
};
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-family-zone-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser, passes = 0;
const pass = text => { passes++; console.log(`PASS ${text}`); };
async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const api = async (method, url, payload) => {
    const result = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(result.statusCode < 300, `${url}: ${result.body}`);
    return result.json();
  };
  const child = await api('POST', '/children', { name: '家庭时区验收' });
  db.prepare('UPDATE children SET created_at = ? WHERE id = ?').run('2026-10-01T00:00:00Z', child.id);
  const task = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '时区练习', subject: '数学', points: 5 });
  await api('POST', `/daily-tasks/${task.id}/complete`);
  const earned = zone === 'Asia/Shanghai' ? '2026-10-20T16:15:00Z' : '2026-10-21T04:15:00Z';
  db.prepare('UPDATE point_logs SET earned_at = ? WHERE daily_task_id = ?').run(earned, task.id);
  const backup = await api('POST', '/backups');
  // Backup list timestamps come from the file system, which has its own real clock.
  fs.utimesSync(path.join(dir, 'backups', backup.name), new RealDate(instant), new RealDate(instant));
  const previous = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '前一天积分', subject: '语文', points: 3 });
  await api('POST', `/daily-tasks/${previous.id}/complete`);
  db.prepare('UPDATE point_logs SET earned_at = ? WHERE daily_task_id = ?')
    .run(zone === 'Asia/Shanghai' ? '2026-10-20T15:45:00Z' : '2026-10-21T03:45:00Z', previous.id);
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const errors = [];
  const open = async () => {
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' });
    await context.addInitScript(value => sessionStorage.setItem('taskie_parent_token', value), token);
    const page = await context.newPage();
    await page.clock.setFixedTime(new RealDate(instant));
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    return page;
  };
  const shot = async (page, name) => {
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${zone.replaceAll('/', '-')}-${name}.png`), fullPage: true });
    }
  };
  const page = await open();
  let requests = 0;
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/calendar') requests++; });
  await page.goto(`${base}/child/${child.id}/history`);
  await page.getByText('10月21日 (周三)', { exact: true }).waitFor();
  pass('history preserves YYYY-MM-DD and weekday on a western device');
  assert.match(await page.locator('canvas[aria-label]').first().getAttribute('aria-label'), /10\/21 \(周三/);
  pass('weekly chart labels preserve date and weekday');
  // The test freezes Date.now; advance it once so Chart.js can finish its animation.
  await page.clock.setFixedTime(RealDate.parse(instant) + 1500);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await shot(page, 'history-weekly');
  await page.locator(`a[href='/child/${child.id}/today']`).first().click();
  await page.getByText('周三 · 10月21日', { exact: true }).waitFor();
  await shot(page, 'board');
  pass('board uses the family day before the device midnight');
  await page.locator(`a[href='/child/${child.id}/rewards']`).first().click();
  await page.getByText('今天 00:15', { exact: true }).waitFor();
  await page.getByText('10月20日 23:45', { exact: true }).waitFor();
  pass('points use family today, previous day and HH:MM');
  await shot(page, 'points');
  await page.locator(`a[href='/child/${child.id}/homework']`).first().click();
  await page.getByRole('button', { name: '➕ 记作业' }).click();
  assert.equal(await page.locator('#homework-assigned').inputValue(), '2026-10-21');
  assert.equal(await page.locator('#homework-assigned').getAttribute('max'), '2026-10-21');
  await shot(page, 'homework');
  pass('homework defaults and maximum assigned date use family today');
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  // Navigate within this SPA so the singleton calendar is exercised across child and parent pages.
  await page.evaluate(() => { history.pushState({}, '', '/parent/settings'); dispatchEvent(new PopStateEvent('popstate')); });
  const expectedClock = zone === 'Asia/Shanghai' ? '00:30' : '01:30';
  await page.getByText(new RegExp(`2026[/-]10[/-]21.*${expectedClock}`)).first().waitFor();
  await shot(page, 'settings');
  pass('settings backup timestamps use family date and clock');
  assert.equal(requests, 1, 'one calendar request across all SPA pages');
  pass('calendar is cached once globally across navigation');
  // No default Shanghai date may flash while the family's time zone is unknown.
  const delayed = await open();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await delayed.route('**/api/calendar', async route => { await gate; await route.continue(); });
  await delayed.goto(`${base}/child/${child.id}/today`);
  try {
    await delayed.getByRole('status').filter({ hasText: '正在读取家庭时区' }).waitFor();
    assert.equal(await delayed.getByText('周三 · 10月21日', { exact: true }).count(), 0);
  } finally { release(); }
  await delayed.getByText('周三 · 10月21日', { exact: true }).waitFor();
  pass('initial calendar request gates timezone-dependent UI');
  const failed = await open();
  await failed.route('**/api/calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '时区服务不可用' }) }));
  await failed.goto(`${base}/child/${child.id}/today`);
  await failed.getByRole('alert').filter({ hasText: '暂按 UTC' }).waitFor();
  await shot(failed, 'fallback');
  await failed.unroute('**/api/calendar');
  await failed.getByRole('button', { name: '重新读取家庭时区' }).click();
  await failed.getByText('周三 · 10月21日', { exact: true }).waitFor();
  assert.equal(await failed.getByRole('alert').filter({ hasText: '暂按 UTC' }).count(), 0);
  pass('calendar failure has visible UTC fallback and reload recovers');
  assert.deepEqual(errors, []);
}
main().then(() => console.log(`Family time zone ${zone}: ${passes} passed, 0 failed`), error => {
  console.error(error); process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); global.Date = RealDate; });
