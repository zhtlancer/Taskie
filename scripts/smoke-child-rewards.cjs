// Build first. Real rewards, points and requests in an isolated database; no production data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
process.env.TIME_ZONE = 'Asia/Shanghai';
const RealDate = Date, before = RealDate.parse('2026-11-22T15:59:00Z'); let now = before;
global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-child-rewards-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready(); const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), errors = [];
  const api = async (method, url, payload, owner = token) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${owner}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`); return response.json();
  };
  const earn = (id, points, title = '完成练习的积分' + '长任务内容'.repeat(8)) => {
    const task = app.services.tasksService.createAdhocTask(id, { title, subject: '数学', points });
    app.services.tasksService.completeDailyTask(task.id);
  };
  for (const width of [320,390,820,1180]) for (const theme of ['light','dark']) {
    now = before;
    // Bound browser resources across the full device matrix; each case still runs once.
    browser = await chromium.launch(launchOptions());
    const child = await api('POST', '/children', { name: `积分甲${width}${theme}` }), other = await api('POST', '/children', { name: '积分乙' });
    earn(child.id, 100); earn(other.id, 777, '另一个孩子的积分');
    const item = await api('POST', '/reward-items', { title: '一起去科学馆探索自然与科学奥秘的周末家庭奖励' + '长名字'.repeat(5), cost: 60 });
    const second = await api('POST', '/reward-items', { title: '小奖励', cost: 10 });
    const off = await api('POST', '/reward-items', { title: '已经下架的奖励', cost: 1 }); await api('PUT', `/reward-items/${off.id}`, { is_active: false });
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, hasTouch: true,
      timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      // Deliberately keep a different child in the shared store: the route owns this page's balance.
      await context.addInitScript(({ token, other, theme }) => { sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(other));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { token, other, theme });
      const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new RealDate(before) }); await page.clock.pauseAt(new RealDate(before));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
      const resume = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      const state = name => page.locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name, exact: true }) });
      const balance = value => page.locator('[data-rewards-balance]').getByText(`${value} 分`, { exact: true }).waitFor();
      const card = page.locator(`[data-reward-item="${item.id}"]`), row = id => page.locator(`[data-redemption-record="${id}"]`);
      const shopDialog = () => page.getByRole('dialog', { name: '兑换奖励', exact: true }), cancelDialog = () => page.getByRole('dialog', { name: '撤回兑换申请', exact: true });
      const statsUrl = `**/api/children/${child.id}/stats`, recordsUrl = `**/api/children/${child.id}/redemptions?*`, writeUrl = `**/api/children/${child.id}/redemptions`;
      const fail = route => route.fulfill({ status: 503, json: { error: '暂时无法读取' } });
      const hold = async (pattern, failure = false) => {
        let release, arrive, finish, count = 0;
        const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrive = resolve; }), done = new Promise(resolve => { finish = resolve; });
        const handler = async route => {
          count++; const response = await route.fetch(); arrive(); await gate;
          try { await route.fulfill(failure ? { status: 503, json: { error: '旧请求迟到的错误' } } : { response }); }
          catch (error) { if (!/closed|canceled|cancelled|Invalid Interception/i.test(error.message)) throw error; }
          finally { finish(); }
        };
        await page.route(pattern, handler);
        return { release, done, handler, count: () => count, started: async () => {
          let timer; try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`request did not start: ${pattern}`)), 12000); })]); }
          finally { clearTimeout(timer); }
        } };
      };
      const ready = () => page.waitForFunction(id => { const button = document.querySelector(`[data-reward-item="${id}"] button`); return button && !button.disabled; }, item.id);
      const redeem = async () => { await ready(); await card.getByRole('button', { name: '兑换', exact: true }).click(); await shopDialog().getByRole('button', { name: '确定兑换？', exact: true }).click(); };
      const protectedDialog = async dialog => {
        assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
        assert.ok(await page.locator('[data-reward-item] button').evaluateAll(buttons => buttons.every(button => button.disabled)));
        const before = page.url(); await push(`/child/${other.id}/rewards`); assert.equal(page.url(), before);
        await push(`/child/${child.id}/today`); assert.equal(page.url(), before);
      };
      // All five sections fail independently; neither unknown counts nor read errors become empty states.
      for (const pattern of [statsUrl, '**/api/reward-items', recordsUrl, '**/api/badge-definitions', `**/api/children/${child.id}/point-logs`]) await page.route(pattern, fail);
      await page.goto(`${base}/child/${child.id}/rewards`, { waitUntil: 'networkidle' });
      for (const title of ['积分概览未能读取','奖励未能读取','兑换记录未能读取','徽章未能读取','积分明细未能读取']) await state(title).waitFor();
      assert.equal(await page.getByText('还没有上架的奖励', { exact: true }).count(), 0);
      assert.equal(await page.getByText('还没有兑换记录', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0);
      for (const [pattern, title] of [[statsUrl,'积分概览未能读取'],['**/api/reward-items','奖励未能读取'],[recordsUrl,'兑换记录未能读取']]) {
        await page.unroute(pattern, fail); await state(title).getByRole('button', { name: '重新读取', exact: true }).click();
      }
      await ready(); await balance(100); assert.equal(await page.locator(`[data-reward-item="${off.id}"]`).count(), 0);
      assert.equal(await state('徽章未能读取').count(), 1); assert.equal(await state('积分明细未能读取').count(), 1);
      // A definite rejection is not an uncertain debit and must not permanently lock other rewards.
      let rejectedId;
      const rejectedRequest = request => { if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/children/${child.id}/redemptions`) rejectedId = request.postDataJSON().request_id; };
      page.on('request', rejectedRequest);
      await card.getByRole('button', { name: '兑换', exact: true }).click(); await api('PUT', `/reward-items/${item.id}`, { cost: 101 });
      await shopDialog().getByRole('button', { name: '确定兑换？', exact: true }).click();
      await shopDialog().getByRole('alert').getByText('奖励信息已更新，请关闭后重新选择奖励。', { exact: true }).waitFor();
      await shopDialog().getByRole('button', { name: '关闭', exact: true }).click(); page.off('request', rejectedRequest);
      assert.ok(rejectedId); assert.equal((await api('GET', `/children/${child.id}/redemptions`)).length, 0);
      assert.equal(await page.getByRole('complementary', { name: '待确认请求', exact: true }).count(), 0);
      assert.equal(await page.locator(`[data-reward-item="${second.id}"]`).getByRole('button', { name: '兑换', exact: true }).isEnabled(), true);
      await api('PUT', `/reward-items/${item.id}`, { cost: 60 }); await resume(); await ready();
      // Confirmation supports Escape/focus restoration, then serializes a real exchange.
      await card.getByRole('button', { name: '兑换', exact: true }).click(); await page.keyboard.press('Escape');
      assert.equal(await card.getByRole('button', { name: '兑换', exact: true }).evaluate(el => el === document.activeElement), true);
      const exchange = await hold(writeUrl);
      try {
        await redeem(); await exchange.started(); await protectedDialog(shopDialog());
        await shopDialog().getByRole('button', { name: '正在确认…', exact: true }).evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(exchange.count(), 1); exchange.release(); await exchange.done;
        await shopDialog().waitFor({ state: 'detached' }); await balance(40);
      } finally { exchange.release(); if (!page.isClosed()) await page.unroute(writeUrl, exchange.handler); }
      let requests = await api('GET', `/children/${child.id}/redemptions`); assert.equal(requests.length, 1);
      const first = requests[0]; assert.notEqual(first.id, rejectedId); await row(first.id).getByText('等待确认', { exact: true }).waitFor();
      // Failure retains the selected request; success remains success even if the following balance read fails.
      const cancelUrl = `**/api/redemptions/${first.id}/cancel`;
      await page.route(cancelUrl, route => route.fulfill({ status: 503, json: { error: '暂时无法撤回，请重试' } }));
      await row(first.id).getByRole('button', { name: '撤回', exact: true }).click(); await cancelDialog().getByRole('button', { name: '确认撤回', exact: true }).click();
      await cancelDialog().getByRole('alert').getByText('暂时无法撤回，请重试', { exact: true }).waitFor();
      await cancelDialog().getByRole('button', { name: '确认撤回', exact: true }).waitFor();
      await page.unroute(cancelUrl); const cancellation = await hold(cancelUrl);
      try {
        await cancelDialog().getByRole('button', { name: '确认撤回', exact: true }).click(); await cancellation.started(); await protectedDialog(cancelDialog());
        await page.route(statsUrl, fail); cancellation.release(); await cancellation.done;
        await cancelDialog().waitFor({ state: 'detached' }); await state('积分概览未能读取').waitFor();
        await page.getByRole('status').filter({ hasText: '兑换申请已撤回，原占用积分已释放。' }).waitFor();
        assert.equal(cancellation.count(), 1); assert.equal(app.services.rewardsService.getAvailablePoints(child.id), 100);
      } finally { cancellation.release(); if (!page.isClosed()) await page.unroute(cancelUrl, cancellation.handler); }
      await page.unroute(statsUrl, fail); await state('积分概览未能读取').getByRole('button', { name: '重新读取', exact: true }).click(); await balance(100);
      // A lost successful response is retried with the same persisted id, even though the remaining balance is below the price.
      const bodies = []; let lose = true;
      const lost = async route => { bodies.push(route.request().postDataJSON()); if (lose) { lose = false; await route.fetch(); await route.abort(); } else await route.continue(); };
      await page.route(writeUrl, lost); await redeem(); await shopDialog().getByRole('alert').waitFor(); await balance(40);
      await shopDialog().getByRole('button', { name: '按原申请重试', exact: true }).waitFor();
      await shopDialog().getByRole('button', { name: '按原申请重试', exact: true }).click(); await shopDialog().waitFor({ state: 'detached' }); await balance(40);
      assert.deepEqual(bodies[0], bodies[1]); await page.unroute(writeUrl, lost);
      requests = await api('GET', `/children/${child.id}/redemptions`); assert.equal(requests.length, 2);
      const secondRequest = requests.find(record => record.status === 'pending'); assert.equal(secondRequest.cost, 60);
      assert.equal(await page.getByRole('complementary', { name: '待确认请求', exact: true }).count(), 0);
      // Lost cancellation is reconciled from the server rather than blindly claiming a second release.
      await page.route(`**/api/redemptions/${secondRequest.id}/cancel`, async route => { await route.fetch(); await route.abort(); });
      await row(secondRequest.id).getByRole('button', { name: '撤回', exact: true }).click(); await cancelDialog().getByRole('button', { name: '确认撤回', exact: true }).click();
      await cancelDialog().waitFor({ state: 'detached' }); await balance(100);
      assert.equal(app.services.redemptionsService.getRedemption(secondRequest.id).status, 'cancelled');
      // A parent can resolve an open cancellation; a rejected cancel must not refund an approved exchange.
      const third = await api('POST', `/children/${child.id}/redemptions`, { reward_id: item.id }); await resume(); await row(third.id).waitFor(); await balance(40);
      await row(third.id).getByRole('button', { name: '撤回', exact: true }).click(); await api('POST', `/redemptions/${third.id}/approve`);
      await cancelDialog().getByRole('button', { name: '确认撤回', exact: true }).click(); await cancelDialog().waitFor({ state: 'detached' }); await balance(40);
      await row(third.id).getByText('已兑换', { exact: true }).waitFor(); assert.equal(app.services.rewardsService.getAvailablePoints(child.id), 40);
      await api('POST', `/redemptions/${third.id}/refund`, { reason: '活动取消，退回原扣积分。' + 'LongRefundReason'.repeat(5) }); await resume();
      await row(third.id).getByText('已撤销退分', { exact: true }).waitFor(); await balance(100);
      assert.equal(app.services.rewardsService.getTotalPoints(child.id), 100, 'exchanges/refunds never fabricate earned points');
      for (const [pattern, title] of [['**/api/badge-definitions','徽章未能读取'],[`**/api/children/${child.id}/point-logs`,'积分明细未能读取']]) {
        await page.unroute(pattern, fail); await state(title).getByRole('button', { name: '重新读取', exact: true }).click();
      }
      await page.getByRole('button', { name: /^查看徽章：/ }).first().waitFor();
      const badgeButton = page.getByRole('button', { name: /^查看徽章：/ }).first(); await badgeButton.focus(); await page.keyboard.press('Enter');
      await page.getByRole('dialog').waitFor(); assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await page.keyboard.press('Tab'); assert.ok(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)));
      await page.keyboard.press('Escape'); assert.equal(await badgeButton.evaluate(el => el === document.activeElement), true); assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
      // Restore invalidates an old balance read and discards an unsubmitted confirmation.
      const oldBalance = await hold(statsUrl);
      try {
        await resume(); await oldBalance.started(); await page.unroute(statsUrl, oldBalance.handler); earn(child.id, 5, '刷新后的新增积分');
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored'))); await balance(105);
        oldBalance.release(); await oldBalance.done; await balance(105);
      } finally { oldBalance.release(); if (!page.isClosed()) await page.unroute(statsUrl, oldBalance.handler); }
      await ready(); await card.getByRole('button', { name: '兑换', exact: true }).click();
      await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored'))); await shopDialog().waitFor({ state: 'detached' }); await balance(105);
      assert.equal((await api('GET', `/children/${child.id}/redemptions`)).length, 3);
      // An old child's error cannot replace the new child's readable balance or history.
      const oldChild = await hold(statsUrl, true);
      try {
        await resume(); await oldChild.started(); await push(`/child/${other.id}/rewards`); await balance(777);
        oldChild.release(); await oldChild.done; await balance(777); assert.equal(await state('积分概览未能读取').count(), 0);
        assert.equal(await page.locator('[data-redemption-record]').count(), 0);
      } finally { oldChild.release(); if (!page.isClosed()) await page.unroute(statsUrl, oldChild.handler); }
      await push(`/child/${child.id}/rewards`); await balance(105); await ready();
      const controls = await page.locator('[data-rewards-page] button, [data-rewards-page] a').evaluateAll(items => items.filter(el => el.getClientRects().length).map(el => {
        const r = el.getBoundingClientRect(); return { label: el.textContent, width: r.width, height: r.height };
      }));
      for (const control of controls) assert.ok(control.height >= 44 && control.width >= 44, JSON.stringify(control));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits viewport');
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `rewards-${width}-${theme}.png`), fullPage: true }); }
      if (width === 390 && theme === 'light') {
        await page.getByText('今天 23:59', { exact: true }).first().waitFor();
        const yesterday = await hold(statsUrl, true);
        try {
          await resume(); await yesterday.started(); await page.unroute(statsUrl, yesterday.handler);
          now = before + 120000; await page.clock.fastForward(120000); await page.getByText('11月22日 23:59', { exact: true }).first().waitFor();
          await balance(105); yesterday.release(); await yesterday.done; await balance(105); assert.equal(await state('积分概览未能读取').count(), 0);
          assert.equal(await page.evaluate(() => new Date().getDay()), 0, 'device still Sunday while family is Monday');
        } finally { yesterday.release(); if (!page.isClosed()) await page.unroute(statsUrl, yesterday.handler); }
      }
      console.log(`PASS ${width}px ${theme}: independent reads, route-owned balance, real exchange/cancel/refund, lost response ids, double-submit/navigation guards, stale scope, badge focus and touch layout`);
    } finally { await context.close(); await browser.close(); browser = undefined; }
    await api('DELETE', `/reward-items/${item.id}`); await api('DELETE', `/reward-items/${second.id}`); await api('DELETE', `/reward-items/${off.id}`);
  }
  // Real child role: uncertain requests survive closing/reloading, and global confirmation refreshes this page exactly once.
  now = before;
  const child = await api('POST', '/children', { name: '孩子自主兑换' }), other = await api('POST', '/children', { name: '另一个孩子' }); earn(child.id, 100);
  const item = await api('POST', '/reward-items', { title: '自主兑换测试奖励', cost: 60 });
  const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }, { expiresIn: '7d' });
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block' });
  try {
    await context.addInitScript(({ childToken, child }) => { sessionStorage.setItem('taskie_child_token', childToken); sessionStorage.setItem('current_child', JSON.stringify(child)); localStorage.setItem('app_sound_muted', 'true'); localStorage.setItem('taskie_theme', 'dark'); }, { childToken, child });
    const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new RealDate(before) }); await page.clock.pauseAt(new RealDate(before));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const url = `**/api/children/${child.id}/redemptions`, bodies = []; let lose = true;
    await page.route(url, async route => { bodies.push(route.request().postDataJSON()); if (lose) { lose = false; await route.fetch(); await route.abort(); } else await route.continue(); });
    await page.goto(`${base}/child/${child.id}/rewards`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '兑换', exact: true }).click(); await page.getByRole('button', { name: '确定兑换？', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor(); await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    await page.reload({ waitUntil: 'networkidle' });
    const pending = page.getByRole('complementary', { name: '待确认请求', exact: true });
    await pending.getByRole('button', { name: '确认这次操作', exact: true }).click();
    await page.locator('[data-rewards-balance]').getByText('40 分', { exact: true }).waitFor(); await pending.waitFor({ state: 'detached' });
    assert.deepEqual(bodies[0], bodies[1]); assert.equal((await api('GET', `/children/${child.id}/redemptions`)).length, 1);
    for (const [method, url] of [['GET', `/children/${other.id}/stats`], ['GET', `/children/${other.id}/redemptions`], ['POST', '/reward-items']]) {
      const response = await app.inject({ method, url: `/api${url}`, headers: { authorization: `Bearer ${childToken}` } }); assert.equal(response.statusCode, 403);
    }
    console.log('PASS child role, reload-safe pending request, global confirmation, one debit and server ownership');
  } finally { await context.close(); }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
