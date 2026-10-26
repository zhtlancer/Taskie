// Build first. Real API/UI checks for homework shortcuts, task filters and parent attention counts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-board-workflow-'));
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
    const child = app.services.childrenService.createChild({ name: `看板${width}/${theme}` });
    const other = app.services.childrenService.createChild({ name: `空白${width}/${theme}` });
    const otherGoal = app.services.periodsService.createGoal(other.id, { title: '可选长期任务', subject: '英语' });
    const today = getTodayDate();
    const add = data => app.services.tasksService.createAdhocTask(child.id, { title: '待办', subject: '数学', ...data });
    const high = add({ title: '数学高优先待办', priority: 2 });
    add({ title: '普通英语待办', subject: '英语' });
    const done = add({ title: '已完成高优先', priority: 2 });
    app.services.tasksService.completeDailyTask(done.id);
    const skipped = add({ title: '已跳过高优先', priority: 2 });
    db.prepare('UPDATE daily_tasks SET skipped_at = ?, skip_reason = ? WHERE id = ?').run(new Date().toISOString(), '今天不做', skipped.id);
    const record = app.services.homeworkService.create(child.id, {
      subject: '数学', content: '课程作业修改', due_date: shiftDate(today, 2), create_task: true, track_time: true, priority: 1
    }, 'parent');
    app.services.homeworkStudyService.start(record.id);
    const activeId = app.services.homeworkStudyService.details(record.id).active.id;
    const goal = app.services.periodsService.createGoal(child.id, {
      title: '英语长期高优先', subject: '英语', mode: 'progress', total_amount: 10, unit: '页', daily_required: true, priority: 2, end_date: shiftDate(today, 3)
    });
    app.services.periodsService.createGoal(child.id, { title: '今天到期的长期任务', subject: '英语', priority: 0, end_date: today });
    const logged = app.services.periodsService.createGoal(child.id, {
      title: '今天已记录的长期任务', subject: '英语', mode: 'progress', total_amount: 10, unit: '页', daily_required: true, priority: 2
    });
    app.services.periodsService.logProgress(logged.id, { amount: 1 }, { role: 'parent' });
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
    // Network-fault injection must own requests; a service worker can bypass page routing.
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 }, hasTouch: true, colorScheme: theme, timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block' });
    try {
      await context.addInitScript(({ token, child, theme }) => {
        if (!sessionStorage.getItem('board_child_session')) sessionStorage.setItem('taskie_parent_token', token);
        if (!sessionStorage.getItem('current_child')) sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', err => { errors.push(err.message); console.error('BROWSER ERROR:', err.message); });
      const goto = route => page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      const card = title => page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      await goto(`/child/${child.id}/today`);
      const progress = await page.getByText('今日完成进度', { exact: true }).locator('..').innerText();
      // A read failure stays inside the dialog and can be retried without losing the board.
      let rejectRead = width === 390 && theme === 'light', rejectedReads = 0;
      await page.route(`**/api/homework/${record.id}`, route => {
        if (route.request().method() === 'GET' && rejectRead) {
          rejectedReads++;
          return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '读取暂时失败' }) });
        }
        return route.continue();
      });
      await card('数学：课程作业修改').getByRole('button', { name: '更多任务操作' }).click();
      await page.getByRole('button', { name: '修改作业', exact: true }).click();
      if (width === 390 && theme === 'light') {
        await page.getByRole('dialog').getByRole('alert').waitFor();
        assert.equal(await page.getByRole('dialog').getByRole('alert').textContent(), '读取暂时失败');
        assert.ok(rejectedReads > 0);
        // Keep the outage active until the explicit retry, including any repeated request.
        rejectRead = false;
        await page.getByRole('dialog').getByRole('button', { name: '重新读取', exact: true }).click();
      }
      const dialog = page.getByRole('dialog', { name: '✏️ 修改作业记录', exact: true });
      await dialog.getByLabel('作业内容', { exact: true }).fill('课程作业已修改');
      await dialog.getByLabel('截止日期', { exact: true }).fill(shiftDate(today, 1));
      await dialog.getByRole('radio', { name: '高', exact: true }).check();
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await card('数学：课程作业已修改').getByLabel('高优先级').waitFor();
      assert.equal(app.services.homeworkService.get(record.id).priority, 2);
      assert.equal(app.services.homeworkService.get(record.id).task.priority, 2);
      assert.equal(app.services.homeworkStudyService.details(record.id).active.id, activeId);
      assert.equal(await page.getByText('今日完成进度', { exact: true }).locator('..').innerText(), progress);
      console.log(`PASS ${engine.name()} ${width}/${theme}: homework shortcut edits source and card, preserves timer/progress, and retries reads`);

      const filters = page.getByRole('group', { name: '筛选任务', exact: true });
      await filters.getByRole('button', { name: '仅看未完成', exact: true }).click();
      assert.equal(await card('已完成高优先').count(), 0);
      assert.equal(await card('已跳过高优先').count(), 0);
      assert.equal(await page.locator(`[data-timer-id="${logged.id}"]`).count(), 0);
      await filters.getByRole('button', { name: '高优先级', exact: true }).click();
      assert.equal(await card('普通英语待办').count(), 0);
      await card('数学高优先待办').waitFor();
      await page.getByRole('button', { name: /英语 \d+$/ }).click();
      assert.equal(await page.locator('[data-task-card]').count(), 0);
      await page.locator(`[data-timer-id="${goal.id}"]`).waitFor();
      assert.equal(await page.getByText('没有符合筛选条件的任务', { exact: true }).count(), 0);
      await page.getByRole('button', { name: /其他 \d+$/ }).click();
      await page.getByText('没有符合筛选条件的任务', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看全部任务', exact: true }).click();
      await card('已完成高优先').waitFor();
      await card('普通英语待办').waitFor();
      assert.equal(await page.getByRole('button', { name: /全部 \d+$/ }).evaluate(el => el.getBoundingClientRect().left >= 0), true);
      assert.equal(await filters.getByRole('button', { name: '仅看未完成', exact: true }).getAttribute('aria-pressed'), 'false');
      assert.equal(await page.getByText('今日完成进度', { exact: true }).locator('..').innerText(), progress);
      const sizes = await filters.getByRole('button').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
      assert.ok(sizes.every(h => h >= 44));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`PASS ${engine.name()} ${width}/${theme}: combined filters cover daily tasks and goals, empty recovery, unchanged progress and touch sizing`);
      if (process.env.BOARD_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.BOARD_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.BOARD_SCREENSHOT_DIR, `board-${width}-${theme}.png`), fullPage: true });
      }
      await goto('/parent/dashboard');
      const summary = page.getByRole('region', { name: `${child.name}的待办摘要`, exact: true });
      await summary.getByText('今天到期', { exact: true }).waitFor();
      const countText = label => summary.getByText(label, { exact: true }).locator('..').textContent();
      assert.match(await countText('今天到期'), /3\s*项待办/);
      assert.match(await countText('高优先级'), /3\s*项待办/);
      const otherSummary = page.getByRole('region', { name: `${other.name}的待办摘要`, exact: true });
      assert.equal(await otherSummary.getByText(/^0 项待办$/).count(), 2);
      app.services.tasksService.completeDailyTask(high.id);
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await summary.getByText('今天到期', { exact: true }).locator('..').getByText(/^2 项待办$/).waitFor();
      await summary.getByText('高优先级', { exact: true }).locator('..').getByText(/^2 项待办$/).waitFor();
      if (width === 390 && theme === 'light') {
        await page.route(`**/api/daily-tasks?child_id=${child.id}`, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"摘要读取失败"}' }));
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
        await summary.getByText('待办摘要暂不可用', { exact: true }).waitFor();
        assert.equal(await summary.getByText(/^0 项待办$/).count(), 0);
        await page.unroute(`**/api/daily-tasks?child_id=${child.id}`);
        await summary.getByRole('button', { name: '重新读取摘要', exact: true }).click();
        await summary.getByText('高优先级', { exact: true }).locator('..').getByText(/^2 项待办$/).waitFor();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`PASS ${engine.name()} ${width}/${theme}: per-child due/high summaries include goals once and refresh after completion without false zeros`);
      await goto(`/child/${other.id}/today`);
      await page.getByRole('group', { name: '筛选任务' }).getByRole('button', { name: '高优先级', exact: true }).click();
      await page.getByText('没有符合筛选条件的任务', { exact: true }).waitFor();
      assert.equal(await page.getByText(/加油！还剩 0 项/).count(), 0, 'hiding optional goals must not add a zero-task progress prompt');
      await page.getByRole('button', { name: '查看全部任务', exact: true }).click();
      await page.locator(`[data-timer-id="${otherGoal.id}"]`).waitFor();
      // Changing to a child identity removes editing while retaining filters.
      app.services.homeworkStudyService.pauseSession(record.id, activeId);
      await page.evaluate(({ child, token }) => {
        sessionStorage.setItem('board_child_session', '1'); sessionStorage.removeItem('taskie_parent_token');
        sessionStorage.setItem('taskie_child_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
      }, { child, token: app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }) });
      await goto(`/child/${child.id}/today`);
      await card('数学：课程作业已修改').getByRole('button', { name: '更多任务操作' }).click();
      assert.equal(await page.getByRole('button', { name: '修改作业', exact: true }).count(), 0);
      assert.equal(await page.getByRole('group', { name: '筛选任务' }).count(), 1);
      console.log(`PASS ${engine.name()} ${width}/${theme}: child sees filters but cannot open the homework edit shortcut`);
    } catch (err) {
      const page = context.pages()[0];
      if (page) console.error('Dialog state:', await page.getByRole('dialog').allTextContents());
      throw err;
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
