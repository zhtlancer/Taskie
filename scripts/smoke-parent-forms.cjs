// Build first. Real APIs and an isolated SQLite database; exercises failure and pending writes.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-parent-forms-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }), errors = [], today = getTodayDate();
  const api = async (method, url, payload) => {
    const r = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(r.statusCode < 300, r.body); return r.json();
  };
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = await api('POST', '/children', { name: `表单${width}${theme}` });
    const context = await browser.newContext({ viewport: { width, height: 1100 }, hasTouch: true, colorScheme: theme, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      const go = route => page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      const dismissToast = async () => { const close = page.getByRole('button', { name: '关闭错误提示', exact: true }); if (await close.count()) await close.click(); };
      const hold = async (url, method = 'POST') => {
        let release, received, writes = 0;
        const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { received = resolve; });
        await page.route(url, async route => {
          if (route.request().method() !== method) return route.continue();
          writes++; const response = await route.fetch(); received(); await held; await route.fulfill({ response });
        });
        return { started, release, writes: () => writes };
      };
      const pendingProtected = async dialog => {
        assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), true);
        assert.ok(await dialog.locator('input, select, textarea').evaluateAll(fields => fields.every(field => field.matches(':disabled'))));
        await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 1);
        await page.mouse.click(2, 2); assert.equal(await dialog.count(), 1);
        await page.keyboard.press('Tab');
        assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), 'focus stays inside while its fieldset is disabled');
        await page.keyboard.press('Enter');
        const before = page.url();
        await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '课程日历', exact: true }).evaluate(el => el.click());
        await page.waitForTimeout(50); assert.equal(page.url(), before, 'pending save blocks route changes');
      };
      const datesFit = async dialog => {
        const sizes = await dialog.locator('input[type=date]').evaluateAll(fields => fields.map(field => {
          const f = field.getBoundingClientRect(), p = field.parentElement.getBoundingClientRect();
          return { left: f.left, right: f.right, parentLeft: p.left, parentRight: p.right, height: f.height };
        }));
        assert.ok(sizes.every(f => f.left >= f.parentLeft - 1 && f.right <= f.parentRight + 1 && f.height >= 43.9));
        if (sizes.length === 2) assert.ok(sizes[0].right < sizes[1].left);
      };
      // A failed initial read must not claim there are no tasks or children.
      await page.route('**/api/task-templates', route => route.request().method() === 'GET'
        ? route.fulfill({ status: 503, json: { error: '模板读取暂时失败' } }) : route.continue());
      await go(`/parent/tasks?child=${child.id}`);
      await page.locator('[data-page-state=error]').getByText('任务模板未能读取', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-page-state=empty]').count(), 0);
      assert.equal(await page.getByText('还没有孩子档案。', { exact: false }).count(), 0);
      await dismissToast(); await page.unroute('**/api/task-templates');
      await page.locator('[data-page-state=error]').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.locator('[data-page-state=empty]').waitFor();
      const add = page.getByRole('button', { name: '➕ 新增任务模板', exact: true });
      await add.click();
      let dialog = page.getByRole('dialog', { name: '➕ 新增任务模板', exact: true });
      await dialog.getByLabel('任务名称', { exact: true }).waitFor();
      assert.equal(await dialog.getByLabel('任务名称', { exact: true }).evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      assert.equal(await add.evaluate(el => el === document.activeElement), true);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      await add.click(); await dialog.getByLabel('任务名称', { exact: true }).fill('保存保护模板');
      const templateWrite = await hold('**/api/task-templates');
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await templateWrite.started;
      await pendingProtected(dialog); assert.equal(templateWrite.writes(), 1); templateWrite.release();
      await dialog.waitFor({ state: 'detached' }); await page.unroute('**/api/task-templates');
      await page.getByRole('heading', { name: '保存保护模板', exact: true }).waitFor();
      const template = (await api('GET', '/task-templates')).find(t => t.title === '保存保护模板' && t.child_ids?.includes(child.id));
      assert.ok(template);
      await page.locator(`[data-template-id="${template.id}"]`).getByRole('button', { name: '✏️ 编辑模板', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '✏️ 编辑任务模板', exact: true });
      await dialog.getByLabel('任务名称', { exact: true }).fill('失败保留输入');
      await page.route(`**/api/task-templates/${template.id}`, route => route.fulfill({ status: 400, json: { error: '请核对模板设置' } }));
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
      await dialog.getByRole('alert').getByText('请核对模板设置', { exact: true }).waitFor(); await dismissToast();
      assert.equal(await dialog.getByLabel('任务名称', { exact: true }).inputValue(), '失败保留输入');
      assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled(), false);
      await page.unroute(`**/api/task-templates/${template.id}`);
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      // Long-term task read recovery and saving use the same page and dialog states.
      const goalsUrl = `**/api/children/${child.id}/goals`;
      await page.route(goalsUrl, route => route.request().method() === 'GET'
        ? route.fulfill({ status: 503, json: { error: '学习安排读取暂时失败' } }) : route.continue());
      await go(`/parent/goals?child=${child.id}`);
      await page.locator('[data-page-state=error]').waitFor(); assert.equal(await page.locator('[data-page-state=empty]').count(), 0);
      await dismissToast(); await page.unroute(goalsUrl);
      await page.locator('[data-page-state=error]').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.getByRole('button', { name: '📚 新增长期任务', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '➕ 添加长期任务', exact: true });
      await dialog.getByLabel('任务名称', { exact: true }).fill('对齐阅读'); await datesFit(dialog);
      const goalWrite = await hold(goalsUrl);
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await goalWrite.started;
      await pendingProtected(dialog); assert.equal(goalWrite.writes(), 1); goalWrite.release();
      await dialog.waitFor({ state: 'detached' }); await page.unroute(goalsUrl);
      const goal = (await api('GET', `/children/${child.id}/goals`)).find(t => t.title === '对齐阅读'); assert.ok(goal);
      await page.locator(`[data-goal-id="${goal.id}"]`).getByRole('button', { name: '补记进度', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '补记「对齐阅读」', exact: true }); await datesFit(dialog);
      const progressWrite = await hold(`**/api/period-tasks/${goal.id}/logs`);
      await dialog.getByRole('button', { name: '补记', exact: true }).click(); await progressWrite.started;
      await pendingProtected(dialog); assert.equal(progressWrite.writes(), 1); progressWrite.release(); await dialog.waitFor({ state: 'detached' });
      assert.equal((await api('GET', `/children/${child.id}/goals`)).find(t => t.id === goal.id).logs.length, 1);
      await go(`/parent/calendar?child=${child.id}`);
      await page.getByRole('button', { name: '➕ 新增假期', exact: true }).click();
      dialog = page.getByRole('dialog', { name: `➕ 为${child.name}新增假期`, exact: true });
      await dialog.getByLabel('假期名称', { exact: true }).fill('布局假期');
      await dialog.getByLabel('开始日期', { exact: true }).fill(shiftDate(today, 14));
      await dialog.getByLabel('结束日期', { exact: true }).fill(shiftDate(today, 21)); await datesFit(dialog);
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      assert.ok((await api('GET', `/children/${child.id}/periods`)).some(p => p.name === '布局假期'));
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `parent-calendar-${width}-${theme}.png`), fullPage: true });
      }
      // Child administration uses the same failure states and pending-write protection.
      await page.route('**/api/children', route => route.request().method() === 'GET'
        ? route.fulfill({ status: 503, json: { error: '孩子档案读取暂时失败' } }) : route.continue());
      await go('/parent/children');
      await page.getByRole('heading', { name: '孩子档案未能读取', exact: true }).waitFor();
      assert.equal(await page.locator('[data-page-state=empty]').count(), 0);
      await dismissToast(); await page.unroute('**/api/children');
      await page.locator('[data-page-state=error]').getByRole('button', { name: '重新读取', exact: true }).click();
      const addChild = page.getByRole('button', { name: '➕ 添加新孩子账号', exact: true });
      await addChild.click(); dialog = page.getByRole('dialog', { name: '➕ 添加新孩子账号', exact: true });
      await dialog.getByLabel('孩子昵称', { exact: true }).waitFor();
      assert.ok(await dialog.getByLabel('孩子昵称', { exact: true }).evaluate(el => el === document.activeElement));
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      assert.ok(await addChild.evaluate(el => el === document.activeElement));
      await addChild.click();
      const childName = `新档案${width}${theme}`;
      await dialog.getByLabel('孩子昵称', { exact: true }).fill(childName);
      await dialog.getByLabel('4 位独立 PIN 密码', { exact: true }).fill('2468');
      await dialog.getByRole('button', { name: '🐼', exact: true }).click();
      assert.ok(await dialog.getByRole('button').evaluateAll(buttons => buttons.every(b => b.getBoundingClientRect().height >= 43.9 && b.getBoundingClientRect().width >= 43.9)));
      const childWrite = await hold('**/api/children');
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await childWrite.started;
      await pendingProtected(dialog); assert.equal(childWrite.writes(), 1); childWrite.release(); await dialog.waitFor({ state: 'detached' });
      await page.unroute('**/api/children');
      const createdChild = (await api('GET', '/children')).find(c => c.name === childName); assert.ok(createdChild?.has_pin);
      let childCard = page.locator(`[data-child-id="${createdChild.id}"]`);
      await childCard.getByRole('button', { name: '✏️ 编辑资料', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '✏️ 编辑孩子账号', exact: true });
      await dialog.getByLabel('孩子昵称', { exact: true }).fill(`${childName}修改`);
      await page.route(`**/api/children/${createdChild.id}`, route => route.fulfill({ status: 400, json: { error: '孩子资料未能保存' } }));
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
      await dialog.getByRole('alert').getByText('孩子资料未能保存', { exact: true }).waitFor(); await dismissToast();
      assert.equal(await dialog.getByLabel('孩子昵称', { exact: true }).inputValue(), `${childName}修改`);
      assert.ok(await dialog.getByRole('button', { name: '🐼', exact: true }).getAttribute('aria-pressed') === 'true');
      await page.unroute(`**/api/children/${createdChild.id}`);
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      assert.ok((await api('GET', '/children')).find(c => c.id === createdChild.id).has_pin, 'an empty edit PIN retains protection');
      await childCard.getByRole('button', { name: '删除', exact: true }).click();
      await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      await childCard.waitFor({ state: 'detached' });
      // A successful write followed by a failed refresh closes the form and retries only reads.
      await page.route('**/api/reward-items', route => route.request().method() === 'GET'
        ? route.fulfill({ status: 503, json: { error: '奖励数据读取暂时失败' } }) : route.continue());
      await go('/parent/rewards');
      await page.getByRole('heading', { name: '奖励数据未能读取', exact: true }).waitFor();
      assert.equal(await page.locator('[data-page-state=empty]').count(), 0);
      await dismissToast(); await page.unroute('**/api/reward-items');
      await page.locator('[data-page-state=error]').getByRole('button', { name: '重新读取', exact: true }).click();
      const addReward = page.getByRole('button', { name: '➕ 新增奖励', exact: true });
      await addReward.click(); dialog = page.getByRole('dialog', { name: '➕ 新增奖励', exact: true });
      await dialog.getByLabel('奖励名称', { exact: true }).waitFor();
      assert.ok(await dialog.getByLabel('奖励名称', { exact: true }).evaluate(el => el === document.activeElement));
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
      assert.ok(await addReward.evaluate(el => el === document.activeElement)); await addReward.click();
      const rewardName = `管理奖励${width}${theme}`;
      await dialog.getByLabel('奖励名称', { exact: true }).fill(rewardName);
      await dialog.getByLabel('所需积分', { exact: true }).fill('10');
      const rewardWrite = await hold('**/api/reward-items');
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await rewardWrite.started;
      await pendingProtected(dialog); assert.equal(rewardWrite.writes(), 1);
      // Route the refresh after the POST was already accepted.
      await page.route('**/api/redemptions?**', route => route.fulfill({ status: 503, json: { error: '兑换记录读取暂时失败' } }));
      rewardWrite.release(); await dialog.waitFor({ state: 'detached' });
      await page.getByRole('heading', { name: '奖励数据未能读取', exact: true }).waitFor();
      assert.equal(await page.locator('[data-page-state=empty]').count(), 0);
      await dismissToast(); await page.unroute('**/api/redemptions?**');
      await page.locator('[data-page-state=error]').getByRole('button', { name: '重新读取', exact: true }).click();
      const item = (await api('GET', '/reward-items')).find(r => r.title === rewardName); assert.ok(item);
      const rewardCard = page.locator(`[data-reward-id="${item.id}"]`);
      await rewardCard.getByRole('button', { name: '✏️ 编辑', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '✏️ 编辑奖励', exact: true });
      await dialog.getByLabel('奖励名称', { exact: true }).fill(`${rewardName}修改`);
      await dialog.getByLabel('所需积分', { exact: true }).fill('20');
      await dialog.getByRole('button', { name: '🎨', exact: true }).click();
      await page.route(`**/api/reward-items/${item.id}`, route => route.fulfill({ status: 400, json: { error: '奖励未能保存' } }));
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click();
      await dialog.getByRole('alert').getByText('奖励未能保存', { exact: true }).waitFor(); await dismissToast();
      assert.equal(await dialog.getByLabel('奖励名称', { exact: true }).inputValue(), `${rewardName}修改`);
      assert.equal(await dialog.getByLabel('所需积分', { exact: true }).inputValue(), '20');
      assert.equal(await dialog.getByRole('button', { name: '🎨', exact: true }).getAttribute('aria-pressed'), 'true');
      assert.ok(await dialog.getByRole('button').evaluateAll(buttons => buttons.every(b => b.getBoundingClientRect().height >= 43.9 && b.getBoundingClientRect().width >= 43.9)));
      await page.unroute(`**/api/reward-items/${item.id}`);
      await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      assert.equal(rewardWrite.writes(), 1, 'refresh retries never create another reward'); await page.unroute('**/api/reward-items');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      if (width === 390 && theme === 'light') {
        const { tasksService, redemptionsService } = app.services;
        const earned = tasksService.createAdhocTask(child.id, { title: '管理回归积分', subject: '数学', points: 1000 });
        tasksService.completeDailyTask(earned.id);
        for (let i = 0; i < 16; i++) {
          const record = redemptionsService.requestRedemption(child.id, item.id);
          redemptionsService.resolveRedemption(record.id, 'approved');
        }
        const request = redemptionsService.requestRedemption(child.id, item.id);
        const rejected = redemptionsService.requestRedemption(child.id, item.id);
        await go('/parent/rewards');
        const approval = await hold(`**/api/redemptions/${request.id}/approve`);
        const pendingRow = page.locator(`[data-pending-id="${request.id}"]`);
        await pendingRow.getByRole('button', { name: '✓ 确认兑换', exact: true }).click(); await approval.started;
        assert.ok(await pendingRow.getByRole('button', { name: '拒绝并退回积分', exact: true }).isDisabled());
        const before = page.url();
        await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '课程日历', exact: true }).evaluate(el => el.click());
        await page.waitForTimeout(50); assert.equal(page.url(), before); assert.equal(approval.writes(), 1);
        approval.release(); await pendingRow.waitFor({ state: 'detached' });
        await page.unroute(`**/api/redemptions/${request.id}/approve`);
        const rejectRow = page.locator(`[data-pending-id="${rejected.id}"]`);
        await page.route(`**/api/redemptions/${rejected.id}/reject`, route => route.fulfill({ status: 400, json: { error: '兑换处理失败，请重试' } }));
        await rejectRow.getByRole('button', { name: '拒绝并退回积分', exact: true }).click();
        await page.locator('main > p[role=alert]').filter({ hasText: '兑换处理失败，请重试' }).waitFor(); await dismissToast();
        await page.unroute(`**/api/redemptions/${rejected.id}/reject`);
        await rejectRow.getByRole('button', { name: '拒绝并退回积分', exact: true }).click(); await rejectRow.waitFor({ state: 'detached' });
        // A rejected page read retains the previous page and retries the requested page.
        await page.getByRole('button', { name: '下一页', exact: true }).waitFor();
        const historyRows = page.locator('[data-redemption-record]');
        const firstIds = await historyRows.evaluateAll(rows => rows.map(r => r.dataset.redemptionId));
        assert.equal(firstIds.length, 15);
        await page.route('**/api/redemptions?**', route => {
          const query = new URL(route.request().url()).searchParams;
          return query.get('status') === 'history' && query.get('offset') === '15'
            ? route.fulfill({ status: 503, json: { error: '下一页读取暂时失败' } }) : route.continue();
        });
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        await page.getByRole('heading', { name: '兑换记录未能读取', exact: true }).waitFor(); await dismissToast();
        assert.deepEqual(await historyRows.evaluateAll(rows => rows.map(r => r.dataset.redemptionId)), firstIds);
        await page.getByText('第 1 页', { exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: '还没有兑换记录', exact: true }).count(), 0);
        await page.unroute('**/api/redemptions?**');
        await page.locator('[data-page-state=error]').getByRole('button', { name: '重新读取', exact: true }).click();
        await page.getByText('第 2 页', { exact: true }).waitFor(); assert.equal(await historyRows.count(), 3);
        await page.getByRole('button', { name: '上一页', exact: true }).click(); await page.getByText('第 1 页', { exact: true }).waitFor();
        const approvedRow = page.locator(`[data-redemption-id="${request.id}"]`);
        await approvedRow.getByRole('button', { name: '撤销兑换并退分', exact: true }).click();
        dialog = page.getByRole('dialog', { name: '撤销兑换并退分', exact: true });
        await dialog.getByLabel('撤销原因', { exact: true }).fill('管理回归撤销');
        const refundWrite = await hold(`**/api/redemptions/${request.id}/refund`);
        await dialog.getByRole('button', { name: '确认撤销并退分', exact: true }).click(); await refundWrite.started;
        await pendingProtected(dialog); assert.equal(refundWrite.writes(), 1); refundWrite.release();
        await dialog.waitFor({ state: 'detached' }); await page.unroute(`**/api/redemptions/${request.id}/refund`);
        await approvedRow.getByText('已撤销退分', { exact: true }).waitFor();
        for (const [path, edit, title, url] of [
          ['/parent/children', `[data-child-id="${child.id}"]`, '✏️ 编辑孩子账号', `**/api/children/${child.id}`],
          ['/parent/rewards', `[data-reward-id="${item.id}"]`, '✏️ 编辑奖励', `**/api/reward-items/${item.id}`]
        ]) {
          await go(path); await page.locator(edit).getByRole('button', { name: /✏️ 编辑/ }).click();
          dialog = page.getByRole('dialog', { name: title, exact: true });
          await page.route(url, route => route.fulfill({ status: 401, json: { error: '请重新登录' } }));
          await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await page.waitForURL('**/parent/login');
          await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => document.body.style.overflow), '');
          await page.unroute(url);
        }
        // Expired credentials must still reach login while the form's request is pending.
        await go(`/parent/tasks?child=${child.id}`);
        await page.locator(`[data-template-id="${template.id}"]`).getByRole('button', { name: '✏️ 编辑模板', exact: true }).click();
        dialog = page.getByRole('dialog', { name: '✏️ 编辑任务模板', exact: true });
        await page.route(`**/api/task-templates/${template.id}`, route => route.fulfill({ status: 401, json: { error: '请重新登录' } }));
        await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await page.waitForURL('**/parent/login');
        await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        await go(`/parent/goals?child=${child.id}`);
        await page.getByRole('button', { name: '📚 新增长期任务', exact: true }).click();
        dialog = page.getByRole('dialog', { name: '➕ 添加长期任务', exact: true });
        await dialog.getByLabel('任务名称', { exact: true }).fill('拒绝后的任务');
        await page.route(goalsUrl, route => route.request().method() === 'POST'
          ? route.fulfill({ status: 401, json: { error: '请重新登录' } }) : route.continue());
        await dialog.getByRole('button', { name: '确认保存', exact: true }).click(); await page.waitForURL('**/parent/login');
        await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => document.body.style.overflow), '');
        assert.ok(!(await api('GET', `/children/${child.id}/goals`)).some(t => t.title === '拒绝后的任务'));
      }
      console.log(`PASS ${width}/${theme}: task/goal/holiday/child/reward forms, read recovery, focus/scroll, pending save protection, retained input, PIN preservation and date bounds`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
