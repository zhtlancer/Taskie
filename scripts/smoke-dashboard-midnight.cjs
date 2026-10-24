// Production UI + real API, with independent fixed clocks. Run npm run build first.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
process.env.TIME_ZONE = 'America/New_York';
const RealDate = Date;
const before = RealDate.parse('2026-10-22T03:59:00Z'); // NY Oct 21, 23:59; device already Oct 22.
const after = before + 120000;
let now = before;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-dashboard-midnight-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser, base, token, child, passes = 0, failures = 0;
const errors = [];
const contexts = [];
async function api(method, url, payload) {
  const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
  assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
  return response.json();
}
async function open(scheme = 'light') {
  now = before;
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', colorScheme: scheme,
    viewport: { width: 1180, height: 900 }, serviceWorkers: 'block' });
  contexts.push(context);
  await context.addInitScript(value => sessionStorage.setItem('taskie_parent_token', value), token);
  const page = await context.newPage();
  page.setDefaultTimeout(4000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new RealDate(before) });
  await page.clock.pauseAt(new RealDate(before));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return page;
}
const shot = async (page, name) => {
  if (!process.env.SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `dashboard-${name}.png`), fullPage: true });
};
async function check(name, run) {
  try { await run(); passes++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { await Promise.all(contexts.splice(0).map(context => context.close())); }
}
async function oldDay(page) {
  await page.getByText('今日积分 +7', { exact: true }).waitFor();
  await page.getByText(/完成 2 \/ 2 项/).waitFor();
  await page.getByText('· 今天已记录', { exact: true }).waitFor();
  await page.getByText(/23:59 写完/).waitFor();
  const next = page.locator('li').filter({ hasText: '明日练习' });
  await next.getByText('明天', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '生成任务', exact: true }).isDisabled(), false);
}
async function newDay(page) {
  await page.getByText('今日积分 +0', { exact: true }).waitFor();
  await page.getByText(/完成 0 \/ 2 项/).waitFor();
  await page.getByText('· 今天未记录', { exact: true }).waitFor();
  await page.locator('[aria-label="今日摘要"]').getByText('0%', { exact: true }).waitFor();
  assert.equal(await page.getByText(/23:59 写完/).count(), 0);
  assert.equal(await page.locator('li').filter({ hasText: '昨日练习' }).count(), 0);
  await page.locator('li').filter({ hasText: '明日练习' }).getByText('今天', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '生成任务', exact: true }).isDisabled(), true, 'expired homework request must be refreshed');
}
async function main() {
  await app.ready();
  token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' });
  child = await api('POST', '/children', { name: '跨家庭午夜' });
  const old = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '昨日练习', subject: '数学', points: 7 });
  await api('POST', `/daily-tasks/${old.id}/complete`);
  await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '明日练习', subject: '数学', date: '2026-10-22', points: 9 });
  const goal = await api('POST', `/children/${child.id}/goals`, { title: '每日阅读', subject: '语文', mode: 'progress', total_amount: 100, unit: '页', daily_required: true });
  await api('POST', `/period-tasks/${goal.id}/logs`, { amount: 1 });
  app.services.homeworkService.create(child.id, { course_kind: 'school', subject: '数学', content: '等待生成的作业',
    assigned_date: '2026-10-21', due_date: '2026-10-21', create_task: true }, 'child');
  base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  for (const event of ['clock', 'visibilitychange', 'pageshow']) await check(`${event}: family midnight updates stats, points, goals, time and labels`, async () => {
    const page = await open(event === 'visibilitychange' ? 'dark' : 'light');
    await page.goto(`${base}/parent/dashboard`);
    await oldDay(page);
    await shot(page, `${event}-before`);
    const requests = [];
    page.on('request', r => requests.push(new URL(r.url()).pathname));
    if (event !== 'clock') {
      // Model suspended timers and a genuinely hidden document, then restore it without ticking.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }
    now = after;
    if (event === 'clock') await page.clock.fastForward(120000);
    else {
      await page.clock.setSystemTime(new RealDate(now));
      await page.evaluate(type => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type));
      }, event);
    }
    await newDay(page);
    for (const suffix of ['/stats', '/time-stats', '/goals', '/adhoc-tasks', '/skip-requests', '/homework-requests', '/homework-completion-requests']) {
      assert.ok(requests.some(url => url.endsWith(suffix)), `${suffix} refreshed`);
    }
    await shot(page, `${event}-after`);
  });
  for (const scheme of ['light', 'dark']) await check(`${scheme}: unknown calendar has no empty state or summary; retry uses NY date`, async () => {
    const page = await open(scheme);
    const dates = [];
    page.on('request', r => { if (r.url().includes('/time-stats')) dates.push(new URL(r.url()).searchParams.get('from')); });
    await page.route('**/api/calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('alert').filter({ hasText: '暂按 UTC' }).waitFor();
    await page.getByRole('heading', { name: '今日作业完成概览' }).waitFor();
    await shot(page, `${scheme}-unknown-calendar`);
    assert.deepEqual(dates, []);
    assert.equal(await page.getByText('还没有添加小朋友账号哦', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: '立即添加小朋友' }).count(), 0);
    assert.equal(await page.locator('[aria-label="今日摘要"]').count(), 0, 'unknown values must not be rendered as zero');
    await page.getByRole('status').filter({ hasText: '正在等待确认家庭时区' }).waitFor();
    await page.unroute('**/api/calendar');
    await page.getByRole('button', { name: '重新读取家庭时区' }).click();
    await oldDay(page);
    assert.deepEqual(dates, ['2026-10-21']);
    await page.locator('[aria-label="今日摘要"]').getByText('1 位', { exact: true }).waitFor();
    await shot(page, `${scheme}-calendar-recovered`);
  });
  await check('a delayed previous-day response cannot overwrite the new day; no loading flash', async () => {
    const page = await open();
    await page.goto(`${base}/parent/dashboard`);
    await oldDay(page);
    await page.getByRole('button', { name: '➕ 添加', exact: true }).click();
    const draft = page.getByPlaceholder('例如：订正数学练习、准备手抄报');
    await draft.fill('跨夜保留的草稿');
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { arrived = resolve; });
    let held = false;
    await page.route('**/api/children/*/stats', async route => {
      if (held) return route.continue();
      held = true;
      const response = await route.fetch();
      arrived();
      await gate;
      await route.fulfill({ response });
    });
    try {
      // Go back a day, hold that response, then return to the fixture's next day.
      now = before - 86400000;
      await page.clock.setSystemTime(new RealDate(now));
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      let timeout;
      try { await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('old request not started')), 4000); })]); }
      finally { clearTimeout(timeout); }
      await page.getByRole('heading', { name: child.name, exact: true }).waitFor();
      assert.equal(await page.getByText('正在统计今日作业进展...', { exact: false }).count(), 0);
      now = after;
      await page.clock.setSystemTime(new RealDate(now));
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await newDay(page);
    } finally { release(); }
    await page.unrouteAll({ behavior: 'wait' });
    await newDay(page);
    assert.equal(await draft.inputValue(), '跨夜保留的草稿');
  });
  await check('parent approves a homework request after family midnight; task and refreshed stats use the new day', async () => {
    const page = await open();
    const record = app.services.homeworkService.create(child.id, { course_kind: 'school', subject: '语文',
      content: '跨日后审批的作业', assigned_date: '2026-10-21', due_date: '2026-10-22', create_task: true }, 'child');
    await page.goto(`${base}/parent/dashboard`);
    const request = page.locator('section').filter({ hasText: '孩子记的作业，等你确认生成任务' }).locator('li').filter({ hasText: record.content });
    await request.getByRole('button', { name: '生成任务', exact: true }).waitFor();
    await page.getByText(/完成 2 \/ 2 项/).waitFor();
    now = after;
    await page.clock.fastForward(120000);
    await page.getByText(/完成 0 \/ 2 项/).waitFor();
    await page.locator('li').filter({ hasText: '等待生成的作业' }).locator('button:disabled').waitFor();
    assert.equal(await request.getByRole('button', { name: '生成任务', exact: true }).isEnabled(), true);
    const dates = [];
    page.on('request', r => { if (r.url().includes('/time-stats')) dates.push(new URL(r.url()).searchParams.get('from')); });
    const saved = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/homework/${record.id}/task`));
    await request.getByRole('button', { name: '生成任务', exact: true }).click();
    const response = await saved;
    assert.equal(response.status(), 201);
    const approved = await response.json();
    assert.equal(approved.task_requested, false);
    assert.equal(approved.task.date, '2026-10-22');
    await request.waitFor({ state: 'detached' });
    await page.getByText(/完成 0 \/ 3 项/).waitFor();
    await page.getByText('今日积分 +0', { exact: true }).waitFor();
    await page.locator('li').filter({ hasText: record.content }).getByText('今天', { exact: true }).waitFor();
    assert.deepEqual(dates, ['2026-10-22']);
    const stats = await api('GET', `/children/${child.id}/stats`);
    assert.deepEqual([stats.today_total_tasks, stats.today_completed_tasks, stats.today_points], [3, 0, 0]);
    assert.equal((await api('GET', '/homework-requests')).some(r => r.id === record.id), false);
    await shot(page, 'approval-after-midnight');
  });
  assert.deepEqual(errors, []);
  assert.equal(failures, 0, `${failures} dashboard regressions failed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  console.log(`Dashboard midnight: ${passes} passed, ${failures} failed`);
  if (browser) await browser.close();
  await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); global.Date = RealDate;
});
