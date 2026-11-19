// Build first. Real HTTP APIs and temporary SQLite; no user data is read or changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-parent-navigation-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }), errors = [];
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.statusCode < 300, response.body); return response.json();
  };
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const suffix = `${width}${theme}`;
    const a = await api('POST', '/children', { name: `甲${suffix}` }), b = await api('POST', '/children', { name: `乙${suffix}` });
    for (const [title, child_ids] of [[`甲任务${suffix}`, [a.id]], [`乙任务${suffix}`, [b.id]], [`共享任务${suffix}`, null]]) {
      await api('POST', '/task-templates', { title, subject: '数学', child_ids, days_of_week: [1, 2, 3, 4, 5] });
    }
    const context = await browser.newContext({ viewport: { width, height: width === 1180 ? 820 : 1180 }, colorScheme: theme, hasTouch: true, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', msg => { if (msg.type() === 'warning' && msg.text().includes('is not defined on instance')) errors.push(msg.text()); });
      const go = route => page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      const mainNav = () => page.getByRole('navigation', { name: '家长导航', exact: true });
      const picker = () => page.getByRole('region', { name: '选择孩子', exact: true });
      const selected = async child => {
        await picker().getByRole('button', { name: new RegExp(child.name) }).waitFor();
        assert.equal(await picker().getByRole('button', { name: new RegExp(child.name) }).getAttribute('aria-pressed'), 'true');
      };
      const fits = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page fits ${width}/${theme}`);
      await go(`/parent/tasks?child=${b.id}`); await selected(b);
      await page.getByRole('heading', { name: `乙任务${suffix}`, exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: `甲任务${suffix}`, exact: true }).count(), 0);
      await page.getByRole('heading', { name: `共享任务${suffix}`, exact: true }).waitFor();
      await page.getByLabel('显示全部孩子的模板', { exact: true }).check();
      await page.getByRole('heading', { name: `甲任务${suffix}`, exact: true }).waitFor();
      await page.getByLabel('显示全部孩子的模板', { exact: true }).uncheck();
      assert.deepEqual(await mainNav().getByRole('link').allTextContents(), ['总览', '学习安排', '课程日历', '统计', '管理']);
      const buttons = await mainNav().getByRole('link').evaluateAll(links => links.map(link => link.getBoundingClientRect().height));
      assert.ok(buttons.every(height => height >= 43.9)); await fits();
      await mainNav().getByRole('link', { name: '课程日历', exact: true }).click(); await selected(b);
      await picker().getByRole('button', { name: new RegExp(a.name) }).click(); await selected(a);
      await page.getByRole('navigation', { name: '课程日历分类' }).getByRole('link', { name: '假期与调休', exact: true }).click();
      await selected(a); await page.getByRole('button', { name: '➕ 新增假期', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /新增长期任务/ }).count(), 0);
      await mainNav().getByRole('link', { name: '学习安排', exact: true }).click(); await selected(a);
      await page.getByRole('navigation', { name: '学习安排分类' }).getByRole('link', { name: '长期任务', exact: true }).click();
      await selected(a); await page.getByRole('button', { name: /新增长期任务/ }).waitFor();
      assert.equal(await page.getByRole('button', { name: /新增假期/ }).count(), 0);
      await page.getByRole('navigation', { name: '学习安排分类' }).getByRole('link', { name: '周期作业', exact: true }).click();
      await selected(a); await page.locator('[data-recurring-panel]').waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0, 'rule management is a page, not a nested modal');
      await page.getByRole('button', { name: '新增周期作业', exact: true }).click();
      await page.getByRole('dialog', { name: '新增周期作业', exact: true }).waitFor();
      assert.equal(await picker().getByRole('button', { name: new RegExp(b.name) }).isDisabled(), true);
      await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
      await page.getByRole('dialog', { name: '新增周期作业', exact: true }).waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelector('[aria-label="选择孩子"] button')?.disabled === false);
      await selected(a);
      await picker().getByRole('button', { name: new RegExp(b.name) }).click(); await selected(b);
      await page.getByRole('navigation', { name: '学习安排分类' }).getByRole('link', { name: '字词计划', exact: true }).click();
      await selected(b);
      const form = page.locator('article').filter({ has: page.getByRole('heading', { name: '语文字词认读', exact: true }) });
      await form.getByLabel('每日新学目标', { exact: false }).fill('7');
      await form.getByRole('checkbox', { name: /未开启|已开启/ }).check();
      let release, received;
      const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { received = resolve; });
      await page.route(`**/api/children/${b.id}/word-study/plans/recognize`, async route => {
        const response = await route.fetch(); received(); await held; await route.fulfill({ response });
      });
      await form.getByRole('button', { name: '保存语文字词认读计划', exact: true }).click(); await started;
      assert.equal(await picker().getByRole('button', { name: new RegExp(a.name) }).isDisabled(), true);
      release(); await form.getByRole('status').filter({ hasText: '计划已保存，并按约定生效。' }).waitFor();
      assert.equal((await api('GET', `/children/${b.id}/word-study`)).plans.find(p => p.skill === 'recognize').new_target, 7);
      await picker().getByRole('button', { name: new RegExp(a.name) }).click(); await selected(a);
      await page.waitForFunction(() => document.querySelector('article input[type=number]')?.value === '3');
      assert.equal((await api('GET', `/children/${a.id}/word-study`)).plans.length, 0, 'saving B never configures A');
      await fits();
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `parent-plans-${width}-${theme}.png`), fullPage: true });
      }
      await mainNav().getByRole('link', { name: '统计', exact: true }).click(); await selected(a); await fits();
      await mainNav().getByRole('link', { name: '管理', exact: true }).click();
      await page.getByRole('navigation', { name: '管理分类' }).getByRole('link', { name: '奖励配置', exact: true }).click();
      assert.equal(await mainNav().getByRole('link', { name: '管理', exact: true }).getAttribute('aria-current'), 'page');
      await fits();
      await go(`/parent/periods?child=${b.id}`); await selected(b);
      assert.equal(new URL(page.url()).pathname, '/parent/calendar', 'old bookmarks reach calendar');
      await go('/parent/tasks'); await selected(b);
      await page.reload({ waitUntil: 'networkidle' }); await selected(b);
      console.log(`PASS ${width}/${theme}: grouped navigation, remembered child, scoped rules, calendar split and real word-plan saving`);
    } finally { await context.close(); }
  }
  const child = await api('POST', '/children', { name: '学生权限验收' });
  const context = await browser.newContext();
  try {
    const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() });
    await context.addInitScript(token => sessionStorage.setItem('taskie_child_token', token), childToken);
    const page = await context.newPage();
    for (const route of ['/parent/recurring-homework', '/parent/word-plans', '/parent/goals', '/parent/calendar']) {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle' }); assert.equal(new URL(page.url()).pathname, '/parent/login');
    }
    console.log('PASS child session cannot open parent management pages');
  } finally { await context.close(); }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
