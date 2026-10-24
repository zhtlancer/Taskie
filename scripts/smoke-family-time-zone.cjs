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
let browser, passes = 0, failures = 0;
const pass = text => { passes++; console.log(`PASS ${text}`); };
async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' });
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
  const contexts = [];
  const open = async (deviceZone, fixed = instant) => {
    const context = await browser.newContext({ viewport: { width: 1180, height: 900 }, timezoneId: deviceZone, colorScheme: deviceZone === 'Pacific/Kiritimati' ? 'dark' : 'light', serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(value => sessionStorage.setItem('taskie_parent_token', value), token);
    const page = await context.newPage();
    await page.clock.setFixedTime(new RealDate(fixed));
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR', error.message); });
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    return page;
  };
  const shot = async (page, name) => {
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${zone.replaceAll('/', '-')}-${name}.png`), fullPage: true });
    }
  };
  for (const deviceZone of ['America/Los_Angeles', 'Asia/Shanghai', 'Pacific/Kiritimati']) {
    console.log(`DEVICE ${deviceZone}`);
    const page = await open(deviceZone);
    let requests = 0;
    page.on('request', r => { if (new URL(r.url()).pathname === '/api/calendar') requests++; });
    await page.goto(`${base}/child/${child.id}/history`);
    await page.getByText('10月21日 (周三)', { exact: true }).waitFor();
    pass('history preserves YYYY-MM-DD and weekday across device time zones');
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
    const delayed = await open(deviceZone);
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
    const failed = await open(deviceZone);
    await failed.route('**/api/calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '时区服务不可用' }) }));
    await failed.goto(`${base}/child/${child.id}/today`);
    await failed.getByRole('alert').filter({ hasText: '暂按 UTC' }).waitFor();
    await shot(failed, 'fallback');
    await failed.unroute('**/api/calendar');
    await failed.getByRole('button', { name: '重新读取家庭时区' }).click();
    await failed.getByText('周三 · 10月21日', { exact: true }).waitFor();
    assert.equal(await failed.getByRole('alert').filter({ hasText: '暂按 UTC' }).count(), 0);
    pass('calendar failure has visible UTC fallback and reload recovers');
    // Each regression reports independently so the pre-fix run proves all three defects.
    const check = async (name, run) => {
      try { await run(); pass(`${deviceZone}: ${name}`); }
      catch (error) { failures++; console.error(`FAIL ${deviceZone}: ${name}`, error.message); }
    };
    if (zone === 'America/New_York') await check('F1 failed calendar blocks writes and retry uses family date', async () => {
      const blocked = await open(deviceZone, '2026-10-22T02:30:00Z'); // NY Oct 21, UTC Oct 22.
      const writes = [];
      blocked.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request); });
      await blocked.route('**/api/calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
      await blocked.goto(`${base}/parent/dashboard`);
      await blocked.getByRole('alert').filter({ hasText: '暂按 UTC' }).waitFor();
      const add = blocked.getByRole('button', { name: '➕ 添加', exact: true }).first();
      await add.waitFor();
      assert.equal(await add.isDisabled(), true, 'adhoc entry must be disabled');
      await blocked.getByText('无法确认家庭日期，请重新读取家庭时区后再操作', { exact: false }).waitFor();
      // Native click and submit cannot reach a write while the calendar is untrusted.
      await add.evaluate(button => button.click());
      assert.equal(await blocked.locator('form').count(), 0);
      assert.equal(writes.length, 0);
      await shot(blocked, `${deviceZone.replaceAll('/', '-')}-writes-blocked`);
      await blocked.unroute('**/api/calendar');
      await blocked.getByRole('button', { name: '重新读取家庭时区' }).click();
      await blocked.waitForFunction(() => !document.querySelector('fieldset:disabled'));
      await add.click();
      await blocked.getByPlaceholder('例如：订正数学练习、准备手抄报').fill('恢复后的家庭日期');
      await blocked.getByRole('button', { name: '今天', exact: true }).click();
      assert.equal(await blocked.locator('input[type="date"]').first().inputValue(), '2026-10-21');
      const saved = blocked.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/adhoc-tasks'));
      await blocked.getByRole('button', { name: '确认添加', exact: true }).click();
      assert.equal((await saved).status(), 201);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].postDataJSON().date, '2026-10-21');
      await blocked.close();
    });
    const beforeMidnight = zone === 'Asia/Shanghai' ? '2026-10-21T15:59:00Z' : '2026-10-22T03:59:00Z';
    await check('F2 points update across midnight, visibilitychange and pageshow', async () => {
      const points = await open(deviceZone, beforeMidnight);
      await points.goto(`${base}/child/${child.id}/rewards`);
      await points.getByText('今天 00:15', { exact: true }).waitFor();
      await points.clock.setSystemTime(RealDate.parse(beforeMidnight));
      await points.clock.fastForward(120000);
      await points.getByText('10月21日 00:15', { exact: true }).waitFor({ timeout: 2000 });
      assert.equal(await points.getByText('今天 00:15', { exact: true }).count(), 0);
      for (const event of ['visibilitychange', 'pageshow']) {
        await points.clock.setSystemTime(new RealDate(beforeMidnight));
        await points.evaluate(type => (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type)), event);
        await points.getByText('今天 00:15', { exact: true }).waitFor({ timeout: 2000 });
        await points.clock.setSystemTime(new RealDate(RealDate.parse(beforeMidnight) + 120000));
        await points.evaluate(type => (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type)), event);
        await points.getByText('10月21日 00:15', { exact: true }).waitFor({ timeout: 2000 });
      }
      await shot(points, `${deviceZone.replaceAll('/', '-')}-points-midnight`);
      await points.close();
    });
    await check('F3 statistics refresh day and range after midnight and resume', async () => {
      const stats = await open(deviceZone, beforeMidnight);
      const dates = [];
      stats.on('request', request => { const url = new URL(request.url()); if (url.pathname.endsWith('/time-stats')) dates.push(url.searchParams.get('to')); });
      await stats.goto(`${base}/parent/time-stats?child=${child.id}`);
      await stats.getByRole('button', { name: '近 30 天', exact: true }).waitFor();
      await stats.getByText('正在统计...', { exact: false }).waitFor({ state: 'hidden' });
      assert.equal(dates.at(-1), '2026-10-21');
      await stats.clock.setSystemTime(RealDate.parse(beforeMidnight));
      await stats.clock.fastForward(120000);
      await stats.getByRole('button', { name: '近 30 天', exact: true }).click();
      await stats.getByText('正在统计...', { exact: false }).waitFor({ state: 'hidden' });
      assert.equal(dates.at(-1), '2026-10-22');
      for (const event of ['visibilitychange', 'pageshow']) {
        dates.length = 0;
        await stats.clock.setSystemTime(new RealDate(RealDate.parse(beforeMidnight) + (event === 'visibilitychange' ? 1 : 2) * 86400000 + 120000));
        const refreshed = stats.waitForRequest(request => request.url().includes('/time-stats'), { timeout: 2000 });
        await stats.evaluate(type => (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type)), event);
        await refreshed;
        assert.equal(dates.at(-1), event === 'visibilitychange' ? '2026-10-23' : '2026-10-24');
      }
      await shot(stats, `${deviceZone.replaceAll('/', '-')}-stats-midnight`);
      await stats.close();
    });
    await Promise.all(contexts.splice(0).map(context => context.close()));
  }
  assert.deepEqual(errors, []);
  assert.equal(failures, 0, `${failures} regression checks failed`);
}
main().then(() => console.log(`Family time zone ${zone}: ${passes} passed, ${failures} failed`), error => {
  console.error(error); process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); global.Date = RealDate; });
