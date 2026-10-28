// Build first. Opt-in settings, both attendance paths, homework navigation and last-lesson fallback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-class-homework-'));
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
  const errors = [];
  const today = getTodayDate(), weekday = getDayOfWeek(today);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: `作业${width}${theme}` });
    const other = app.services.childrenService.createChild({ name: `隔离${width}${theme}` });
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
    const context = await browser.newContext({ viewport: { width, height: width === 1180 ? 820 : 1180 }, hasTouch: true, colorScheme: theme,
      timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block' });
    let childContext;
    try {
      await context.addInitScript(({ token, child, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const goto = url => page.goto(`${base}${url}`, { waitUntil: 'networkidle' });
      await goto(`/parent/schedule?child=${child.id}`);
      await page.getByRole('button', { name: '➕ 新增课外班', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '新增课外班', exact: true });
      const title = `钢琴${width}${theme}`;
      await dialog.getByLabel('课程名称', { exact: true }).fill(title);
      await dialog.getByRole('button', { name: weekdays[weekday], exact: true }).click();
      await dialog.getByLabel('总课次', { exact: true }).fill('3');
      await dialog.getByRole('button', { name: new RegExp(child.name) }).click();
      assert.equal(await dialog.getByLabel('确认上课后自动生成作业', { exact: true }).isChecked(), false);
      await dialog.getByLabel('确认上课后自动生成作业', { exact: true }).check();
      const labelHeight = await dialog.getByLabel('确认上课后自动生成作业', { exact: true }).evaluate(input => input.closest('label').getBoundingClientRect().height);
      assert.ok(labelHeight >= 44);
      if (process.env.CLASS_HOMEWORK_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.CLASS_HOMEWORK_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.CLASS_HOMEWORK_SCREENSHOT_DIR, `settings-${width}-${theme}.png`) });
      }
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      const cls = app.services.scheduleService.listClasses().find(row => row.title === title);
      assert.ok(cls.auto_homework && !cls.create_task);
      const card = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(title, { exact: true }) });
      await card.getByText('确认上课后生成作业', { exact: true }).waitFor();
      await card.getByRole('button', { name: '编辑', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '编辑课外班', exact: true });
      assert.equal(await dialog.getByLabel('确认上课后自动生成作业', { exact: true }).isChecked(), true);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await card.getByRole('button', { name: '出勤与学费', exact: true }).click();
      dialog = page.getByRole('dialog', { name: `${child.name} · ${title}`, exact: true });
      const row = dialog.locator(`[data-lesson-date="${today}"]`);
      await row.getByRole('button', { name: '记录出勤', exact: true }).click();
      await row.getByRole('button', { name: '保存出勤', exact: true }).click();
      await row.locator('[data-class-homework]').getByText(`本课次作业已生成，截止 ${shiftDate(today, 7)}`, { exact: true }).waitFor();
      // Re-saving attendance retains the one homework, and its link cannot navigate away mid-save.
      await row.getByRole('button', { name: '记录出勤', exact: true }).click();
      let release, arrived;
      const gate = new Promise(resolve => { release = resolve; });
      const seen = new Promise(resolve => { arrived = resolve; });
      const hold = async route => { arrived(); await gate; await route.continue(); };
      const attendancePath = `**/outside-classes/${cls.id}/attendance`;
      await page.route(attendancePath, hold);
      try {
        await row.getByRole('button', { name: '保存出勤', exact: true }).click();
        await Promise.race([seen, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Missing attendance save')), 10000); seen.then(() => clearTimeout(timer)); })]);
        assert.equal(await row.getByRole('link', { name: '查看作业', exact: true }).count(), 0);
        await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
      } finally { release(); }
      await row.getByRole('link', { name: '查看作业', exact: true }).waitFor();
      await page.unroute(attendancePath, hold);
      assert.equal(app.services.homeworkService.list(child.id).length, 1);
      const [record] = app.services.homeworkService.list(child.id);
      assert.equal(record.due_date, shiftDate(today, 7));
      assert.equal(app.services.homeworkService.list(other.id).length, 0);
      await row.getByRole('link', { name: '查看作业', exact: true }).click();
      await page.waitForURL(`**/homework#homework-${record.id}`);
      await page.locator(`#homework-${record.id}`).getByText('确认上课后自动生成', { exact: false }).waitFor();
      // In-app navigation uses pushState, which never updates :target; the linked record is still marked.
      assert.equal(await page.locator(`#homework-${record.id}`).evaluate(el => el.matches('[data-linked]') && getComputedStyle(el).boxShadow !== 'none'), true);
      assert.equal(await page.locator('li[data-linked]').count(), 1);
      await page.locator(`#homework-${record.id}`).getByRole('button', { name: '修改', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('作业内容', { exact: true }).fill('老师补充的钢琴练习');
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(app.services.homeworkService.get(record.id).content, '老师补充的钢琴练习');
      console.log(`PASS ${engine.name()} ${width}/${theme}: opt-in create/edit, manual attendance, exact next-lesson deadline, homework navigation/edit and child isolation`);

      const settings = { start_date: today, days_of_week: [weekday], start_time: '16:00', end_time: '17:00', total_lessons: 2, auto_homework: true, child_ids: [child.id] };
      const last = app.services.scheduleService.createClass({ ...settings, title: `末次${width}${theme}`, total_lessons: 1 });
      const checkin = app.services.scheduleService.createClass({ ...settings, title: `打卡${width}${theme}`, create_task: true });
      await goto(`/child/${child.id}/today`);
      await page.locator('button[title="今天的课"]').click();
      dialog = page.getByRole('dialog', { name: '今天的课', exact: true });
      const lastRow = dialog.locator(`[data-class-id="${last.id}"]`);
      await lastRow.getByRole('button', { name: '已上课', exact: true }).click();
      await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      await lastRow.getByText('已保存作业记录，待设置截止日期后生成任务。', { exact: true }).waitFor();
      await lastRow.getByRole('button', { name: '撤销确认', exact: true }).click();
      await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      await lastRow.getByText('更正出勤后，本课次已生成的作业仍保留。', { exact: true }).waitFor();
      assert.equal(app.services.homeworkService.list(child.id).filter(r => r.class_id === last.id).length, 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log(`PASS ${engine.name()} ${width}/${theme}: board attendance, last-lesson record-only fallback and retained homework after undo`);

      const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch(), child_epoch: child.session_epoch ?? null });
      childContext = await browser.newContext({ viewport: { width, height: width === 1180 ? 820 : 1180 }, hasTouch: true, colorScheme: theme, timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block' });
      await childContext.addInitScript(({ token, child, theme }) => {
        sessionStorage.setItem('taskie_child_token', token); sessionStorage.setItem('current_child', JSON.stringify(child)); localStorage.setItem('taskie_theme', theme);
      }, { token: childToken, child, theme });
      const childPage = await childContext.newPage(); childPage.setDefaultTimeout(15000);
      childPage.on('pageerror', error => errors.push(error.message));
      await childPage.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await childPage.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      const checkinCard = childPage.locator('[data-task-card]').filter({ has: childPage.getByRole('heading', { name: new RegExp(checkin.title) }) });
      await checkinCard.getByRole('button', { name: '完成任务', exact: true }).click();
      await childPage.locator('[data-class-homework]').getByText(`本课次作业已生成，截止 ${shiftDate(today, 7)}`, { exact: true }).waitFor();
      const generated = app.services.homeworkService.list(child.id).filter(r => r.class_id === checkin.id);
      assert.equal(generated.length, 1);
      await childPage.locator('[data-task-card]').filter({ has: childPage.getByRole('heading', { name: new RegExp(`${checkin.title}：`) }) }).waitFor();
      if (process.env.CLASS_HOMEWORK_SCREENSHOT_DIR) await childPage.screenshot({ path: path.join(process.env.CLASS_HOMEWORK_SCREENSHOT_DIR, `board-${width}-${theme}.png`), fullPage: true });
      assert.ok(await childPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(app.services.homeworkService.list(other.id).length, 0);
      console.log(`PASS ${engine.name()} ${width}/${theme}: child check-in creates one homework, refreshes task cards and displays the result`);
    } catch (error) { await reportBrowserFailure(`Class homework ${width}/${theme}`, error, context); throw error; }
    finally { if (childContext) await childContext.close(); await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
