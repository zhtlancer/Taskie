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
      const hold = async url => {
        let release, received, writes = 0;
        const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { received = resolve; });
        await page.route(url, async route => {
          if (route.request().method() !== 'POST') return route.continue();
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
      if (width === 390 && theme === 'light') {
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
      console.log(`PASS ${width}/${theme}: read recovery, dialog focus/scroll, pending save protection, retained input, goal/backfill/holiday writes and date bounds`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
