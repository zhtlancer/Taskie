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
const apiDelay = Number(process.env.SMOKE_API_DELAY_MS || 0);
assert.ok(Number.isFinite(apiDelay) && apiDelay >= 0, 'SMOKE_API_DELAY_MS must be nonnegative');
app.addHook('onRequest', async request => {
  if (apiDelay && request.url.startsWith('/api/') && !request.headers['x-smoke-seed']) {
    await new Promise(resolve => setTimeout(resolve, apiDelay));
  }
});
async function api(method, url, payload) {
  const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}`, 'x-smoke-seed': '1' } });
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
  if (process.env.SMOKE_CASE_FILTER && !new RegExp(process.env.SMOKE_CASE_FILTER).test(name)) return;
  try { await run(); passes++; console.log(`PASS ${name}`); }
  catch (error) {
    failures++; console.error(`FAIL ${name}: ${error.stack}`);
    const page = contexts.at(-1)?.pages().at(-1);
    if (page) await shot(page, `failure-${name.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 90)}`);
  }
  finally {
    for (const context of contexts.splice(0)) {
      // Scores now return before background history; finish intercepted requests
      // before disposing their request context, including under API latency.
      await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: 'wait' })));
      await context.close();
    }
  }
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
  await api('PUT', `/children/${child.id}/word-study/plans/recognize`, { new_target: 2, review_target: 1,
    days_of_week: [0, 1, 2, 3, 4, 5, 6] });
}
const studyUrl = () => `/child/${child.id}/word-study`;
const begin = page => page.getByRole('button', { name: '开始 / 继续学习 →', exact: true });
async function studyReady(page) {
  await begin(page).waitFor();
  await page.getByText('基础目标 0/2', { exact: true }).waitFor();
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
  await page.locator('main > section').getByText(/2026-10-22 · 认读/).waitFor();
  await begin(page).waitFor();
}
async function main() {
  await app.ready();
  token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' });
  base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  await check('D1 device 30 seconds ahead: idle list retries after server midnight', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    now = before + 40000; // Server 23:59:40, device 00:00:10.
    const old = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/word-study'));
    await page.clock.fastForward(70000);
    assert.equal((await old).status(), 200);
    await page.waitForTimeout(apiDelay + 100);
    now += 30000;
    const retry = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/word-study'));
    await page.clock.runFor(5000);
    assert.equal((await (await retry).json()).date, '2026-10-22');
    await waitForNewStudy(page);
    await noErrors(page);
  });
  for (const delay of [300, 1200]) for (const rollover of [false, true]) {
    await check(`D2 history ${delay}ms: one next click ${rollover ? 'returns to today' : 'opens second item'}`, async () => {
      const page = await open();
      await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
      await begin(page).click();
      const dialog = page.getByRole('dialog');
      const word = await dialog.locator('.text-4xl').textContent();
      await page.route('**/api/children/*/word-study/history', async route => {
        const response = await route.fetch();
        await new Promise(resolve => setTimeout(resolve, delay));
        await route.fulfill({ response });
      });
      if (rollover) {
        // Accept on yesterday, deliver after midnight, before the slow history read.
        await page.route('**/api/word-study/items/*/attempts', async route => {
          const response = await route.fetch();
          await midnight(page);
          await route.fulfill({ response });
        });
      }
      await grade(page);
      const next = dialog.getByRole('button', { name: '下一项 / 返回清单', exact: true });
      assert.equal(await next.isDisabled(), false);
      await next.click();
      // Assert immediately: a second click after history arrives must not be needed.
      if (rollover) {
        assert.equal(await dialog.count(), 0);
        await waitForNewStudy(page);
      } else {
        assert.notEqual(await dialog.locator('.text-4xl').textContent(), word);
        assert.equal(await dialog.getByRole('button', { name: '我已尝试，揭晓核对' }).count(), 1);
      }
      await noErrors(page);
    });
  }
  for (const rollover of [false, true]) await check(`A1 lost accepted response: ${rollover ? 'midnight' : 'same day'} retry keeps request id and rewards once`, async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    // Finish the first item so the uncertain second item pays the batch reward.
    await grade(page);
    await page.getByRole('button', { name: '下一项 / 返回清单', exact: true }).click();
    const attempts = [];
    await page.route('**/api/word-study/items/*/attempts', async route => {
      attempts.push({ item: new URL(route.request().url()).pathname, ...route.request().postDataJSON() });
      const response = await route.fetch();
      if (attempts.length === 1) { assert.equal(response.status(), 200); await route.abort('failed'); }
      else await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '我已尝试，揭晓核对' }).click();
    await page.getByRole('button', { name: '独立完成', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: '无法连接服务器' }).waitFor();
    await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
    const snapshot = () => ({
      attempts: db.prepare('SELECT a.* FROM word_study_attempts a JOIN word_study_items i ON i.id = a.item_id JOIN word_study_batches b ON b.id = i.batch_id JOIN word_study_days d ON d.id = b.day_id WHERE d.child_id = ? ORDER BY a.id').all(child.id),
      points: db.prepare('SELECT * FROM point_logs WHERE child_id = ? ORDER BY id').all(child.id)
    });
    const accepted = snapshot();
    assert.equal(accepted.attempts.length, 2);
    assert.equal(accepted.points.length, 1);
    assert.equal(accepted.points[0].points, 10);
    if (rollover) await midnight(page);
    const saved = page.waitForResponse(r => r.url().includes('/attempts'));
    await page.getByRole('button', { name: '重试确认这次练习', exact: true }).click();
    const response = await saved;
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).replayed, true);
    await page.getByRole('dialog').getByText('这次练习已经记下了', { exact: true }).waitFor();
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.deepEqual(snapshot(), accepted, 'retry adds no attempt, state change or reward');
    await page.getByRole('button', { name: '下一项 / 返回清单', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    if (rollover) await waitForNewStudy(page);
  });
  await check('D2 stale history response cannot overwrite a later score history', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    let release, arrived, held = false;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { arrived = resolve; });
    await page.route('**/api/children/*/word-study/history', async route => {
      if (held) return route.fallback();
      held = true;
      const response = await route.fetch();
      arrived(); await gate; await route.fulfill({ response });
    });
    const history = page.locator('main > details');
    try {
      await grade(page); await signal(ready);
      await page.getByRole('button', { name: '下一项 / 返回清单', exact: true }).click();
      await grade(page);
      await history.getByText(/基础 2\/2 项/).waitFor();
    } finally { release(); }
    await page.unrouteAll({ behavior: 'wait' });
    await page.waitForTimeout(100);
    assert.equal(await history.getByText(/基础 2\/2 项/).count(), 1);
    assert.equal(await history.getByText(/基础 1\/2 项/).count(), 0);
  });
  for (const action of ['practice', 'navigate', 'date']) await check(`D1 retry stops on ${action}`, async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    now = before + 40000;
    const old = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/word-study'));
    await page.clock.fastForward(70000); await old;
    await page.waitForTimeout(apiDelay + 100);
    const reads = [];
    page.on('request', r => { if (new URL(r.url()).pathname.endsWith('/word-study')) reads.push(r.url()); });
    if (action === 'practice') await begin(page).click();
    if (action === 'navigate') await page.goto(`${base}/child/${child.id}/today`);
    if (action === 'date') {
      // Reverting to the displayed day must cancel the timer for the future day.
      await page.clock.setSystemTime(new RealDate(before));
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    }
    await page.clock.runFor(10000); await page.waitForTimeout(apiDelay + 100);
    assert.equal(reads.length, 0);
  });
  await check('D1 server remains behind: retries stop after 24 attempts', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    now = before + 40000;
    const reads = [];
    page.on('request', r => { if (new URL(r.url()).pathname.endsWith('/word-study')) reads.push(r.url()); });
    for (let i = 0; i <= 24; i++) {
      const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/word-study'));
      if (i === 0) await page.clock.fastForward(70000);
      else await page.clock.runFor(5000);
      await response;
      await page.waitForTimeout(apiDelay + 100);
    }
    assert.equal(reads.length, 25, 'initial read plus 24 bounded retries');
    await page.clock.runFor(120000); await page.waitForTimeout(apiDelay + 100);
    assert.equal(reads.length, 25, 'no unbounded background reads');
  });
  await check('A1 lost unaccepted request: midnight confirmation returns friendly 403 without retry', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    const writes = [];
    await page.route('**/api/word-study/items/*/attempts', async route => {
      writes.push(route.request().postDataJSON());
      if (writes.length === 1) await route.abort('failed');
      else await route.continue();
    });
    await page.getByRole('button', { name: '我已尝试，揭晓核对' }).click();
    await page.getByRole('button', { name: '独立完成', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').filter({ hasText: '无法连接服务器' }).waitFor();
    await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
    await midnight(page);
    const rejected = page.waitForResponse(r => r.url().includes('/attempts'));
    await page.getByRole('button', { name: '重试确认这次练习', exact: true }).click();
    assert.equal((await rejected).status(), 403);
    await page.getByRole('dialog').getByText('这次练习没有记录，昨天的清单不能再记录了。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0);
    await page.clock.runFor(10000); await page.waitForTimeout(apiDelay + 100);
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[1], writes[0]);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM word_study_attempts WHERE id = ?').get(writes[0].request_id).n, 0);
    await page.getByRole('button', { name: '换成今天的清单', exact: true }).click();
    await waitForNewStudy(page);
  });
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
  for (const scheme of ['light', 'dark']) await check(`L1 ${scheme}: yesterday score blocked before HTTP; switch accepts today score`, async () => {
    const page = await open(scheme);
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const word = await dialog.locator('.text-4xl').textContent();
    await midnight(page);
    await dialog.getByText('已经到新的一天，这次练习结束后会换成今天的清单', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.text-4xl').textContent(), word);
    await shot(page, 'practice-after-midnight');
    const writes = [];
    page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
    await dialog.getByRole('button', { name: '我已尝试，揭晓核对' }).click();
    await dialog.getByRole('button', { name: '独立完成', exact: true }).click();
    await dialog.getByText('已经到新的一天，昨天的清单不能再记录了。请换成今天的清单继续练习。', { exact: true }).waitFor();
    assert.deepEqual(writes, [], 'no yesterday write or automatic retry');
    await noErrors(page);
    await shot(page, `blocked-yesterday-${scheme}`);
    await dialog.getByRole('button', { name: '换成今天的清单', exact: true }).click();
    await waitForNewStudy(page); await noErrors(page);
    await begin(page).click(); await grade(page); await noErrors(page);
  });
  await check('L1 server date rejection shows friendly recovery without toast or retry', async () => {
    const page = await open();
    await seedWords(); await page.goto(base + studyUrl()); await studyReady(page);
    await begin(page).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: '我已尝试，揭晓核对' }).click();
    // Server has crossed midnight while the device clock remains on yesterday.
    now = after;
    const writes = [];
    page.on('request', request => { if (request.url().includes('/attempts')) writes.push(request.postDataJSON()); });
    const rejected = page.waitForResponse(response => response.url().includes('/attempts'));
    await dialog.getByRole('button', { name: '独立完成', exact: true }).click();
    assert.equal((await rejected).status(), 403);
    await dialog.getByText('已经到新的一天，昨天的清单不能再记录了。请换成今天的清单继续练习。', { exact: true }).waitFor();
    await noErrors(page);
    await page.clock.runFor(10000);
    await page.waitForTimeout(apiDelay + 100);
    assert.equal(writes.length, 1, 'no automatic retry');
    await shot(page, 'server-date-rejection');
    // Keep the device date stale: recovery must use the server's current list.
    await dialog.getByRole('button', { name: '换成今天的清单', exact: true }).click();
    await waitForNewStudy(page); await noErrors(page);
    await begin(page).click(); await grade(page); await noErrors(page);
    assert.equal(writes.length, 2, 'only an explicit score on today item is sent');
    // Once the device catches up, ordinary midnight refresh remains enabled.
    await page.getByRole('button', { name: '关闭练习', exact: true }).click();
    now = after + 86400000;
    await page.clock.setSystemTime(new RealDate(now));
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await page.locator('main > section').getByText(/2026-10-23 · 认读/).waitFor();
    await begin(page).click(); await grade(page); await noErrors(page);
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
    await page.waitForTimeout(apiDelay + 300);
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
