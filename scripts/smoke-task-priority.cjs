// Build first. Exercise priority forms, occurrence overrides and board ordering on real browsers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-priority-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === webkit ? { headless: true } : launchOptions());
  const errors = [];
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: `${width}/${theme}` });
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 }, colorScheme: theme, hasTouch: true });
    try {
      await context.addInitScript(({ token, child, theme }) => {
        if (sessionStorage.getItem('priority_child_session')) return;
        sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', err => errors.push(err.message));
      const goto = route => page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      const today = getTodayDate();
      await goto('/parent/tasks');
      await page.getByRole('button', { name: '新增任务模板', exact: false }).click();
      let form = page.locator('form');
      await form.getByPlaceholder('例如：课外阅读20页、跳绳300个、数学计算练习').fill('高优先日常');
      await form.getByRole('radio', { name: '高', exact: true }).check();
      const templateSaved = page.waitForResponse(r => r.url().endsWith('/api/task-templates') && r.request().method() === 'POST');
      await form.getByRole('button', { name: '确认保存', exact: true }).click();
      const templateResponse = await templateSaved;
      assert.equal(templateResponse.status(), 201);
      const template = await templateResponse.json();
      assert.equal(template.priority, 2);
      app.services.tasksService.updateTemplate(template.id, { child_ids: [child.id], days_of_week: [0, 1, 2, 3, 4, 5, 6] });
      console.log(`PASS ${engine.name()} ${width}/${theme}: template form saves priority`);

      await goto('/parent/dashboard');
      await page.getByRole('button', { name: '➕ 添加', exact: true }).last().click();
      form = page.locator('form');
      await form.getByPlaceholder('例如：订正数学练习、准备手抄报').fill('低优先临时');
      await form.getByRole('radio', { name: '低', exact: true }).check();
      const adhocSaved = page.waitForResponse(r => r.url().endsWith(`/children/${child.id}/adhoc-tasks`) && r.request().method() === 'POST');
      await form.getByRole('button', { name: '确认添加', exact: true }).click();
      assert.equal((await adhocSaved).status(), 201);
      assert.equal(app.services.tasksService.listAdhocTasks(child.id).find(t => t.title === '低优先临时').priority, 0);

      await goto('/parent/periods');
      await page.getByRole('button', { name: child.name, exact: false }).click();
      await page.getByRole('button', { name: '新增长期任务', exact: false }).click();
      form = page.locator('form').filter({ has: page.getByPlaceholder('例如：寒假作业、读完《西游记》') });
      await form.getByPlaceholder('例如：寒假作业、读完《西游记》').fill('低优先长期无截止');
      await form.getByRole('radio', { name: '低', exact: true }).check();
      const goalSaved = page.waitForResponse(r => r.url().endsWith(`/children/${child.id}/goals`) && r.request().method() === 'POST');
      await form.getByRole('button', { name: '确认保存', exact: true }).click();
      assert.equal((await goalSaved).status(), 201);
      assert.equal(app.services.periodsService.listGoals(child.id).find(g => g.title === '低优先长期无截止').priority, 0);
      app.services.periodsService.createGoal(child.id, { title: '有截止长期', subject: '语文', daily_required: true, end_date: shiftDate(today, 5), priority: 0 });
      console.log(`PASS ${engine.name()} ${width}/${theme}: one-off and goal forms save priority`);

      await goto(`/child/${child.id}/homework`);
      await page.getByRole('button', { name: '➕ 记作业', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByRole('combobox', { name: '其他科目' }).selectOption('数学');
      await dialog.getByLabel('作业内容', { exact: true }).fill('高优先稍后截止');
      await dialog.getByLabel('截止日期', { exact: true }).fill(shiftDate(today, 3));
      await dialog.getByRole('checkbox', { name: '生成打卡任务', exact: false }).check();
      await dialog.getByRole('radio', { name: '高', exact: true }).check();
      const homeworkSaved = page.waitForResponse(r => r.url().endsWith(`/children/${child.id}/homework`) && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      assert.equal((await homeworkSaved).status(), 201);
      const record = app.services.homeworkService.list(child.id)[0];
      assert.equal(record.priority, 2); assert.equal(record.task.priority, 2);
      app.services.homeworkService.create(child.id, { subject: '数学', content: '低优先先截止', due_date: shiftDate(today, 1), create_task: true, priority: 0 }, 'parent');
      const normal = app.services.tasksService.createAdhocTask(child.id, { title: '普通日常', subject: '语文', track_time: true });
      const done = app.services.tasksService.createAdhocTask(child.id, { title: '已完成高优先', subject: '语文', priority: 2 });
      app.services.tasksService.completeDailyTask(done.id);
      await goto(`/child/${child.id}/today`);
      const card = title => page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const titles = () => page.locator('[data-task-card] h4').allTextContents();
      assert.deepEqual(await titles(), ['高优先日常', '普通日常', '低优先临时', '数学：低优先先截止', '数学：高优先稍后截止', '已完成高优先']);
      const goalIds = await page.locator('[data-timer-id]').evaluateAll(nodes => nodes.filter(n => n.textContent.includes('有截止长期') || n.textContent.includes('低优先长期无截止')).map(n => n.textContent));
      assert.match(goalIds[0], /有截止长期/);
      assert.match(goalIds[1], /低优先长期无截止/);
      await card('低优先临时').getByRole('button', { name: '更多任务操作' }).click();
      await page.getByRole('button', { name: '调整优先级', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '调整优先级' });
      await dialog.getByRole('radio', { name: '高', exact: true }).check();
      const touches = await dialog.getByRole('radio').evaluateAll(nodes => nodes.map(n => n.closest('label').getBoundingClientRect().height));
      assert.ok(touches.every(h => h >= 44));
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await card('低优先临时').getByLabel('高优先级').waitFor();
      assert.deepEqual((await titles()).slice(0, 3), ['高优先日常', '低优先临时', '普通日常']);
      await card('低优先临时').getByRole('button', { name: '更多任务操作' }).click();
      await page.getByRole('button', { name: '调整优先级', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: '恢复默认（低）', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await card('低优先临时').getByLabel('低优先级').waitFor();
      assert.deepEqual((await titles()).slice(0, 3), ['高优先日常', '普通日常', '低优先临时']);
      const geometry = await card('高优先日常').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth, right: el.getBoundingClientRect().right }));
      assert.equal(geometry.overflow, false); assert.ok(geometry.right <= width);
      if (process.env.PRIORITY_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.PRIORITY_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.PRIORITY_SCREENSHOT_DIR, `priority-${width}-${theme}.png`), fullPage: true });
      }
      console.log(`PASS ${engine.name()} ${width}/${theme}: deadline/state/priority ordering, stable ties, occurrence override/reset and touch layout`);

      // Timer refresh must not reorder ties or reset an active learning session.
      app.services.taskStudyService.start(normal.id);
      const activeId = app.services.taskStudyService.details(normal.id).active.id;
      await goto(`/child/${child.id}/today`);
      const before = await titles();
      await card('普通日常').getByRole('button', { name: '更多任务操作' }).click();
      await page.getByRole('button', { name: '调整优先级', exact: true }).click();
      await page.getByRole('dialog').getByRole('radio', { name: '普通', exact: true }).check();
      await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.equal(app.services.taskStudyService.details(normal.id).active.id, activeId);
      assert.deepEqual(await titles(), before);
      app.services.taskStudyService.pauseSession(normal.id, activeId);

      // A child sees priority badges, but neither editing controls nor parent-only fields.
      await page.evaluate(({ child, token }) => {
        sessionStorage.setItem('priority_child_session', '1');
        sessionStorage.removeItem('taskie_parent_token'); sessionStorage.setItem('taskie_child_token', token);
        sessionStorage.setItem('current_child', JSON.stringify(child));
      }, { child, token: app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }) });
      await goto(`/child/${child.id}/today`);
      await card('高优先日常').getByRole('button', { name: '更多任务操作' }).click();
      assert.equal(await page.getByRole('button', { name: '调整优先级', exact: true }).count(), 0);
      await page.getByRole('button', { name: '关闭任务菜单' }).click();
      await goto(`/child/${child.id}/homework`);
      await page.getByRole('button', { name: '➕ 记作业', exact: true }).click();
      assert.equal(await page.getByRole('dialog').getByRole('radio').count(), 0);
      console.log(`PASS ${engine.name()} ${width}/${theme}: timer preserved and child editor hidden`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
