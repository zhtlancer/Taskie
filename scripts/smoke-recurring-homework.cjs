// Build first. Real APIs and temporary SQLite; supports BROWSER=webkit.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-recurring-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === webkit ? { headless: true } : launchOptions());
  const today = getTodayDate(), errors = [];
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: `周期${width}${theme}` });
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
    const context = await browser.newContext({ viewport: { width, height: width === 1180 ? 820 : 1180 }, hasTouch: true,
      colorScheme: theme, timezoneId: 'Pacific/Honolulu', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, child, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
      await page.getByRole('link', { name: '管理周期规则', exact: true }).click();
      let panel = page.locator('[data-recurring-panel]');
      await page.getByRole('button', { name: '新增周期作业', exact: true }).click();
      let form = page.getByRole('dialog', { name: '新增周期作业', exact: true });
      await form.getByLabel('课程名称', { exact: true }).fill('书法托管');
      assert.equal(await form.getByLabel('生效日期', { exact: true }).inputValue(), today);
      assert.equal(await form.getByLabel('每周生成日', { exact: true }).inputValue(), String(getDayOfWeek(today)));
      await form.getByLabel('周期结束日期（可不填）', { exact: true }).fill(shiftDate(today, 60));
      await form.getByLabel('记录用时', { exact: false }).check();
      await form.evaluate(async el => {
        for (const animation of el.parentElement.getAnimations({ subtree: true })) if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const geometry = await form.locator('input[type=date]').evaluateAll(fields => fields.map(field => {
        const f = field.getBoundingClientRect(), p = field.parentElement.getBoundingClientRect();
        return { left: f.left, right: f.right, parentLeft: p.left, parentRight: p.right, height: f.height };
      }));
      assert.ok(geometry.every(f => f.left >= f.parentLeft - 1 && f.right <= f.parentRight + 1 && f.height >= 43.9));
      assert.ok(geometry[0].right < geometry[1].left);
      await form.getByRole('button', { name: '保存模板', exact: true }).click();
      await form.waitFor({ state: 'detached' });
      await panel.getByText('书法托管', { exact: true }).waitFor();
      const [rule] = app.services.recurringHomeworkService.list(child.id);
      const [record] = app.services.homeworkService.list(child.id);
      assert.ok(record.daily_task_id); assert.equal(record.content, '');
      assert.equal(record.due_date, shiftDate(today, 7));
      await page.getByRole('link', { name: '查看作业本 →', exact: true }).click();
      let card = page.locator(`#homework-${record.id}`);
      await card.getByText('待补充内容', { exact: true }).waitFor();
      app.services.homeworkStudyService.manual(record.id, { request_id: `recurring_ui_${child.id}`, duration_seconds: 125 }, 'parent');
      await card.getByRole('button', { name: '修改', exact: true }).click();
      form = page.getByRole('dialog', { name: '✏️ 修改作业记录', exact: true });
      assert.equal(await form.getByLabel('作业内容', { exact: true }).inputValue(), '');
      await form.getByLabel('作业内容', { exact: true }).fill('练习第12页');
      await form.getByRole('button', { name: '保存', exact: true }).click();
      await form.waitFor({ state: 'detached' });
      await card.getByText('练习第12页', { exact: true }).waitFor();
      assert.equal(await card.getByText('待补充内容', { exact: true }).count(), 0);
      assert.equal(app.services.homeworkStudyService.details(record.id).total_seconds, 125);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(app.services.homeworkService.list(child.id).length, 1);
      await page.getByRole('link', { name: '管理周期规则', exact: true }).click();
      panel = page.locator('[data-recurring-panel]');
      await panel.getByRole('button', { name: '修改模板', exact: true }).click();
      form = page.getByRole('dialog', { name: '修改周期作业', exact: true });
      assert.equal(await form.getByLabel('周期结束日期（可不填）', { exact: true }).inputValue(), shiftDate(today, 60), 'editing preserves the period end date');
      await form.getByLabel('课程名称', { exact: true }).fill('书法新规则');
      await form.getByLabel('启用自动生成', { exact: true }).uncheck();
      await form.getByRole('button', { name: '保存模板', exact: true }).click();
      await form.waitFor({ state: 'detached' });
      await panel.getByText('已停用', { exact: true }).waitFor();
      assert.equal(app.services.homeworkService.get(record.id).subject, '书法托管');
      await panel.getByRole('button', { name: '跳过本期', exact: true }).click();
      await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      await panel.getByText(/本期.*已跳过/).waitFor();
      assert.equal(app.services.homeworkService.get(record.id).task.is_skipped, true);
      assert.equal(app.services.homeworkStudyService.details(record.id).total_seconds, 125);
      await panel.getByRole('button', { name: '删除模板', exact: true }).click();
      await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      await panel.getByText('还没有周期作业模板。', { exact: true }).waitFor();
      assert.equal(app.services.homeworkService.get(record.id).content, '练习第12页');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_homework_templates WHERE id = ?').get(rule.id).n, 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.getByRole('link', { name: '查看作业本 →', exact: true }).click();
      const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() });
      const childContext = await browser.newContext({ viewport: { width, height: 1180 }, colorScheme: theme });
      try {
        await childContext.addInitScript(({ token, child, theme }) => {
          sessionStorage.setItem('taskie_child_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
          localStorage.setItem('taskie_theme', theme);
        }, { token: childToken, child, theme });
        const childPage = await childContext.newPage();
        childPage.on('pageerror', error => errors.push(error.message));
        await childPage.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
        assert.equal(await childPage.getByRole('link', { name: '管理周期规则', exact: true }).count(), 0);
        await childPage.getByText('练习第12页', { exact: true }).waitFor();
      } finally { await childContext.close(); }
      console.log(`PASS ${engine.name()} ${width}/${theme}: weekly creation, date bounds, content updates, timer preservation, skip/delete and child isolation`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
