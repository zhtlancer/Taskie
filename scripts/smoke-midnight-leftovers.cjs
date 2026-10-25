// Production UI + real API, independent fixed clocks; build first. No wall-clock dates.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
process.env.TIME_ZONE = 'America/New_York';
const RealDate = Date;
const before = RealDate.parse('2026-10-22T03:59:00Z'), after = before + 120000;
let now = before;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-midnight-leftovers-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser, base, token, child, passes = 0, failures = 0;
const contexts = [], errors = [];
async function api(method, url, payload) {
  const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
  assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
  return response.json();
}
async function open(scheme = 'light') {
  now = before;
  child = await api('POST', '/children', { name: `跨日同学${passes + failures}` });
  const context = await browser.newContext({ timezoneId: 'Asia/Shanghai', colorScheme: scheme,
    viewport: { width: 1180, height: 900 }, serviceWorkers: 'block' });
  contexts.push(context);
  await context.addInitScript(({ token, child }) => {
    sessionStorage.setItem('taskie_parent_token', token);
    sessionStorage.setItem('current_child', JSON.stringify(child));
  }, { token, child });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new RealDate(before) });
  await page.clock.pauseAt(new RealDate(before));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return page;
}
async function shot(page, name) {
  if (!process.env.SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `leftovers-${name}.png`), fullPage: true });
}
async function check(name, run) {
  try { await run(); passes++; console.log(`PASS ${name}`); }
  catch (error) {
    failures++; console.error(`FAIL ${name}: ${error.stack}`);
    const page = contexts.at(-1)?.pages().at(-1);
    if (page) await shot(page, `failure-${name.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 90)}`);
  }
  finally { await Promise.all(contexts.splice(0).map(context => context.close())); }
}
async function signal(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('expected intercepted request did not arrive')), 10000);
  })]); } finally { clearTimeout(timer); }
}
async function midnight(page, event = 'clock') {
  now = after;
  if (event === 'clock') await page.clock.fastForward(120000);
  else {
    await page.clock.setSystemTime(new RealDate(now));
    await page.evaluate(type => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type));
    }, event);
  }
}
async function seedWords() {
  await api('POST', '/characters', { child_id: child.id, char: '山', pinyin: 'shān' });
  await api('POST', '/characters', { child_id: child.id, char: '水', pinyin: 'shuǐ' });
  await api('PUT', `/children/${child.id}/word-study/plans/recognize`, { new_target: 1, review_target: 1,
    days_of_week: [0, 1, 2, 3, 4, 5, 6] });
}
const studyUrl = () => `/child/${child.id}/word-study`;
const begin = page => page.getByRole('button', { name: '开始 / 继续学习 →', exact: true });
async function studyReady(page) {
  await begin(page).waitFor();
  await page.getByText('基础目标 0/1', { exact: true }).waitFor();
  await page.getByText('最近学习记录', { exact: true }).click();
}
async function grade(page) {
  await page.getByRole('button', { name: '我已尝试，揭晓核对' }).click();
  const saved = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/attempts'));
  await page.getByRole('button', { name: '独立完成', exact: true }).click();
  const response = await saved;
  assert.equal(response.status(), 200, await response.text());
  await page.getByText('已记录“独立完成”。同日再练不会重复加分或连续升级。').waitFor();
}
async function noErrors(page) {
  assert.equal(await page.getByRole('alert').count(), 0, 'no page or global errors');
}
async function waitForNewStudy(page) {
  // Wait for the actual new dated API batch and Vue rendering before negative assertions.
  await page.getByText(/2026-10-22 · 认读/).waitFor();
  await begin(page).waitFor();
}
async function main() {
  await app.ready();
  token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' });
  base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  for (const event of ['clock', 'visibilitychange', 'pageshow']) await check(`L1 ${event}: idle list rolls over and accepts practice`, async () => {
    const page = await open(event === 'visibilitychange' ? 'dark' : 'light');
    await seedWords();
    await page.goto(base + studyUrl());
    await studyReady(page);
    await page.getByRole('heading', { name: '字词认读学习' }).waitFor();
    if (event !== 'clock') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await midnight(page, event);
    await waitForNewStudy(page);
    assert.equal(await page.getByText('正在安排学习…', { exact: true }).count(), 0);
    await begin(page).click();
    await grade(page);
    await noErrors(page);
    await shot(page, `word-${event}`);
  });
  await check('L1 active practice survives midnight, accepts score, and close refreshes list', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const word = await dialog.locator('.text-4xl').textContent();
    await midnight(page);
    await dialog.getByText('已经到新的一天，这次练习结束后会换成今天的清单', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.text-4xl').textContent(), word);
    await shot(page, 'practice-after-midnight');
    // Required acceptance: the unchanged API currently rejects this yesterday-item score.
    // Keep the assertion so the policy conflict remains visible instead of reporting a false pass.
    await grade(page);
    await page.getByRole('button', { name: '关闭练习', exact: true }).click();
    await waitForNewStudy(page); await noErrors(page);
  });
  await check('L1 settings draft survives midnight; closing triggers silent refresh', async () => {
    const page = await open('dark');
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await page.getByRole('button', { name: '自动学习设置', exact: true }).click();
    const target = page.getByRole('spinbutton', { name: '每日新学目标' }).first();
    await target.fill('7');
    const reads = [];
    page.on('request', r => { if (new URL(r.url()).pathname.endsWith('/word-study')) reads.push(r.url()); });
    await midnight(page);
    assert.equal(await target.inputValue(), '7');
    assert.equal(reads.length, 0);
    await page.getByRole('button', { name: '收起设置', exact: true }).click();
    await waitForNewStudy(page); await noErrors(page);
  });
  await check('L1 accepted in-flight score survives midnight with one unchanged attempt', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    await page.getByRole('button', { name: '我已尝试，揭晓核对' }).click();
    let release, arrived;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { arrived = resolve; });
    const attempts = [];
    await page.route('**/api/word-study/items/*/attempts', async route => {
      attempts.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      arrived(); await gate; await route.fulfill({ response });
    });
    try {
      await page.getByRole('button', { name: '独立完成', exact: true }).click();
      await signal(ready);
      await midnight(page);
      await page.getByRole('dialog').getByText('已经到新的一天，这次练习结束后会换成今天的清单', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '关闭练习', exact: true }).isDisabled(), true);
    } finally { release(); }
    await page.getByText('已记录“独立完成”。同日再练不会重复加分或连续升级。').waitFor();
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].result, 'good');
    assert.ok(attempts[0].request_id);
    await page.getByRole('button', { name: '下一项 / 返回清单', exact: true }).click();
    await waitForNewStudy(page); await noErrors(page);
  });
  for (const view of ['word-study', 'periods']) await check(`${view}: delayed old-day response cannot replace new day or flash loading`, async () => {
    const page = await open();
    if (view === 'word-study') {
      await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    } else {
      await api('POST', `/children/${child.id}/goals`, { title: '延迟阅读', subject: '语文', mode: 'progress',
        total_amount: 100, unit: '页', start_date: '2026-10-20', end_date: '2026-10-23' });
      await page.goto(`${base}/parent/periods`);
      await page.getByRole('button', { name: new RegExp(child.name) }).click();
      await page.getByText(/还剩 3 天，今天建议/).waitFor();
    }
    await page.evaluate(() => {
      window.loadingFlashes = [];
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('p, div')) {
          if (/^正在(安排学习…|加载\.\.\.)$/.test(el.textContent.trim())) window.loadingFlashes.push(el.textContent);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    let release, arrived, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { arrived = resolve; });
    await page.route(`**/api/children/*/${view === 'word-study' ? 'word-study' : 'goals'}`, async route => {
      if (held) return route.continue();
      held = true;
      const response = await route.fetch();
      arrived(); await gate; await route.fulfill({ response });
    });
    try {
      now = before - 86400000;
      await page.clock.setSystemTime(new RealDate(now));
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await signal(ready);
      await midnight(page, 'pageshow');
      if (view === 'word-study') await waitForNewStudy(page);
      else await page.getByText(/还剩 2 天，今天建议/).waitFor();
    } finally { release(); }
    await page.unrouteAll({ behavior: 'wait' });
    if (view === 'word-study') await waitForNewStudy(page);
    else await page.getByText(/还剩 2 天，今天建议/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.loadingFlashes), []);
    await noErrors(page);
  });
  await check('L2 periods refresh countdown/status; backfill draft keeps values and updates max date', async () => {
    const page = await open();
    // Choose this child explicitly: the app initially selects the first child.
    await api('POST', `/children/${child.id}/goals`, { title: '跨夜阅读', subject: '语文', mode: 'progress',
      input_mode: 'position', total_amount: 100, unit: '页', start_date: '2026-10-21', end_date: '2026-10-23' });
    await api('POST', `/children/${child.id}/periods`, { name: '今晚结束的假期', start_date: '2026-10-20', end_date: '2026-10-21' });
    await page.goto(`${base}/parent/periods`);
    await page.getByRole('button', { name: new RegExp(child.name) }).click();
    await page.getByText(/还剩 3 天，今天建议/).waitFor();
    await page.getByRole('button', { name: '补记进度', exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: '补记「跨夜阅读」' }) });
    await form.waitFor();
    await form.locator('input[type=number]').fill('17');
    await form.locator('input[type=date]').fill('2026-10-21');
    await midnight(page);
    await page.getByText(/还剩 2 天，今天建议/).waitFor();
    await page.getByText('已结束', { exact: true }).waitFor();
    assert.equal(await form.locator('input[type=number]').inputValue(), '17');
    assert.equal(await form.locator('input[type=date]').inputValue(), '2026-10-21');
    assert.equal(await form.locator('input[type=date]').getAttribute('max'), '2026-10-22');
    assert.equal(await page.getByText('正在加载...', { exact: false }).count(), 0);
    await shot(page, 'period-backfill'); await noErrors(page);
  });
  await check('L3 streak refreshes at family midnight', async () => {
    const page = await open();
    now = before - 86400000;
    const task = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '前天已完成', subject: '数学' });
    await api('POST', `/daily-tasks/${task.id}/complete`);
    now = before;
    await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '昨天未完成', subject: '数学' });
    await page.goto(`${base}/child/${child.id}/rewards`);
    const card = page.locator('div.bg-gradient-to-tr').filter({ hasText: '连续坚持' });
    await card.getByText('1 天', { exact: false }).waitFor();
    await midnight(page);
    await card.getByText('0 天', { exact: false }).waitFor();
    await noErrors(page);
  });
  await check('L4 first children failure has no zero summary; retry recovers', async () => {
    const page = await open();
    await page.route('**/api/children', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '重新加载', exact: true }).waitFor();
    assert.equal(await page.locator('[aria-label="今日摘要"]').count(), 0);
    await shot(page, 'children-failure');
    await page.unroute('**/api/children');
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.locator('[aria-label="今日摘要"]').waitFor();
    await page.getByRole('heading', { name: child.name, exact: true }).waitFor();
  });
  await check('L4 successful summary remains visible after later refresh fails', async () => {
    const page = await open();
    await page.goto(`${base}/parent/dashboard`);
    const summary = page.locator('[aria-label="今日摘要"]');
    await summary.waitFor();
    const previous = await summary.textContent();
    await page.route('**/api/children', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await midnight(page);
    await page.getByRole('button', { name: '重新加载', exact: true }).waitFor();
    assert.equal(await summary.textContent(), previous);
  });
  for (const scheme of ['light', 'dark']) await check(`L5 ${scheme}: calendar banner alone, text unobstructed; retry recovers`, async () => {
    const page = await open(scheme);
    await page.route('**/api/calendar', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
    const banner = page.getByRole('alert').filter({ hasText: '暂按 UTC' });
    await banner.waitFor();
    await page.getByText('正在等待确认家庭时区', { exact: false }).waitFor();
    await shot(page, `calendar-${scheme}`);
    assert.equal(await page.getByRole('alert').count(), 1);
    assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0);
    assert.equal(await banner.evaluate(el => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return el === hit || el.contains(hit);
    }), true);
    await page.unroute('**/api/calendar');
    await page.getByRole('button', { name: '重新读取家庭时区', exact: true }).click();
    await page.locator('[aria-label="今日摘要"]').waitFor();
    await noErrors(page);
  });
  await check('L5 other API failures still show global toast', async () => {
    const page = await open();
    await page.route('**/api/children', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '重新加载', exact: true }).waitFor();
    await page.getByRole('button', { name: '关闭错误提示', exact: true }).waitFor();
    await page.getByRole('alert').filter({ hasText: '操作失败，请重试' }).waitFor();
  });
  assert.deepEqual(errors, []);
  assert.equal(failures, 0, `${failures} midnight leftovers regressions failed`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  console.log(`Midnight leftovers: ${passes} passed, ${failures} failed`);
  if (browser) await browser.close();
  await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); global.Date = RealDate;
});
