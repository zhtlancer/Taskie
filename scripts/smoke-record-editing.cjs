// Build first. Isolated multi-device dashboard and in-place record editing regressions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-record-editing-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0, uploadDir: path.join(dir, 'uploads'),
  backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser, currentContext;
const errors = [];
const pass = message => console.log('PASS', message);
async function snapshot(page, name) {
  if (!process.env.SMOKE_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, name + '.png') });
}
async function reloadWithConsent(page, dialog, button, label, original, fresh) {
  await dialog.getByRole('button', { name: button, exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '确认操作', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await dialog.getByLabel(label).inputValue(), original);
  assert.ok(await page.evaluate(value => Object.keys(localStorage).filter(key => key.startsWith('taskie_form_draft_v1:'))
    .some(key => Object.values(JSON.parse(localStorage.getItem(key)).payload.form).includes(value)), original));
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await confirmation.getByRole('button', { name: '确认', exact: true }).click();
  await confirmation.waitFor({ state: 'hidden' });
  await page.waitForFunction(value => [...document.querySelectorAll('input, textarea')].some(input => input.value === value), fresh);
}
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: `编辑${width}${theme}` });
    const today = getTodayDate(), { tasksService: tasks, mistakesService: mistakes, homeworkService: homework } = app.services;
    const add = data => tasks.createAdhocTask(child.id, { title: '临时手抄报', subject: '数学', due_date: shiftDate(today, 2), ...data });
    const task = add({ track_time: true, expected_minutes: 20 });
    tasks.setDailyPriority(task.id, 2);
    app.services.taskStudyService.start(task.id);
    const sessions = db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(task.id);
    const done = add({ title: '跨设备完成', points: 7 });
    const skip = add({ title: '跨设备跳过' });
    const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
    const context = currentContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : width === 820 ? 1180 : 820 }, colorScheme: theme, serviceWorkers: 'block', timezoneId: 'Pacific/Honolulu' });
    try {
      await context.addInitScript(({ token, child, theme }) => {
        if (!sessionStorage.getItem('editing_child_session')) sessionStorage.setItem('taskie_parent_token', token);
        sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 1000));
      const goto = route => page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      await goto('/parent/dashboard');
      await page.getByRole('button', { name: '修改 临时手抄报', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: `✏️ 修改${child.name}的临时任务`, exact: true });
      await dialog.getByLabel('任务名称').fill('刷新期间保留的输入');
      await dialog.getByRole('checkbox').uncheck();
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: '请先结束本次学习' }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), false);
      assert.equal(await dialog.getByLabel('任务名称').inputValue(), '刷新期间保留的输入');
      await dialog.getByRole('checkbox').check();
      pass(`${width}/${theme}: business rejection keeps draft editable and allows adjusting timing before retry`);
      await snapshot(page, `adhoc-${width}-${theme}`);
      tasks.completeDailyTask(done.id);
      app.services.skipsService.requestSkip(skip.id, '另一设备的申请', { role: 'child' });
      homework.create(child.id, { subject: '语文', content: '另一设备记下的作业', due_date: shiftDate(today, 2), create_task: true }, 'child');
      const late = homework.create(child.id, { subject: '英语', content: '另一设备的超期完成', due_date: today, create_task: true }, 'parent');
      db.prepare('UPDATE homework_records SET due_date = ? WHERE id = ?').run(shiftDate(today, -1), late.id);
      db.prepare('UPDATE daily_tasks SET date = ?, due_date = ? WHERE id = ?').run(shiftDate(today, -1), shiftDate(today, -1), late.task.id);
      app.services.homeworkStudyService.complete(late.id, 'child');
      await page.clock.fastForward(61000);
      await page.getByText('理由：另一设备的申请', { exact: true }).last().waitFor();
      await page.getByText('另一设备记下的作业', { exact: true }).last().waitFor();
      await page.getByText('全部完成申请', { exact: false }).waitFor();
      assert.equal(await dialog.getByLabel('任务名称').inputValue(), '刷新期间保留的输入');
      const card = page.locator('div.grid > div').filter({ has: page.getByRole('heading', { name: child.name, exact: true }) }).first();
      assert.match(await card.innerText(), /今日积分\s*\+7/);
      pass(`${width}/${theme}: periodic refresh loads completion, points and all three approval queues, retaining draft`);
      await dialog.getByLabel('截止日期（可不填）').fill(shiftDate(today, 4));
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(tasks.getAdhocTask(task.id).title, '刷新期间保留的输入');
      assert.equal(tasks.getAdhocTask(task.id).due_date, shiftDate(today, 4));
      assert.deepEqual([tasks.getAdhocTask(task.id).default_priority, tasks.getAdhocTask(task.id).priority_override], [1, 2]);
      assert.deepEqual(db.prepare('SELECT * FROM homework_sessions WHERE task_id = ?').all(task.id), sessions);
      pass(`${width}/${theme}: one-off edit keeps identity and active study session`);
      await page.getByRole('button', { name: '修改 刷新期间保留的输入', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('任务名称').fill('本机未保存');
      tasks.updateAdhocTask(task.id, { title: '另一家长已修改', expected_version: tasks.getAdhocTask(task.id).edit_version });
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: '其他设备' }).waitFor();
      assert.equal(await dialog.getByLabel('任务名称').inputValue(), '本机未保存');
      assert.equal(tasks.getAdhocTask(task.id).title, '另一家长已修改');
      await reloadWithConsent(page, dialog, '重新读取任务', '任务名称', '本机未保存', '另一家长已修改');
      await dialog.getByLabel('任务名称').fill('核对后的临时任务');
      await dialog.getByRole('radio', { name: '低', exact: true }).check();
      let release, seen = 0;
      const gate = new Promise(resolve => { release = resolve; });
      const delayEdit = async route => { if (route.request().method() !== 'PUT') return route.continue(); seen++; await gate; await route.continue(); };
      await page.route(`**/api/adhoc-tasks/${task.id}`, delayEdit);
      try {
        await Promise.all([
          page.waitForRequest(request => request.method() === 'PUT' && request.url().endsWith(`/adhoc-tasks/${task.id}`)),
          dialog.getByRole('button', { name: '保存修改', exact: true }).click()
        ]);
        await page.keyboard.press('Escape');
        assert.equal(await dialog.count(), 1);
        assert.equal(await dialog.getByLabel('任务名称').isDisabled(), true);
      } finally { release(); }
      await dialog.waitFor({ state: 'hidden' }); await page.unroute(`**/api/adhoc-tasks/${task.id}`, delayEdit);
      assert.equal(seen, 1);
      assert.deepEqual([tasks.getAdhocTask(task.id).default_priority, tasks.getAdhocTask(task.id).priority_override], [0, null]);
      pass(`${width}/${theme}: stale edit is rejected with draft intact; saving locks fields and close`);
      const resumeSkip = add({ title: '恢复页面后的申请' });
      app.services.skipsService.requestSkip(resumeSkip.id, '回到页面应当看到', { role: 'child' });
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await page.getByText('理由：回到页面应当看到', { exact: true }).last().waitFor();
      await page.getByRole('button', { name: '刷新总览', exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      pass(`${width}/${theme}: resume and manual refresh work without horizontal overflow`);
      const abortChildren = route => route.abort();
      await page.route('**/api/children', abortChildren);
      await page.getByRole('button', { name: '刷新总览', exact: true }).click();
      await page.getByText('刷新失败，当前显示上次读取的数据，请重试。', { exact: true }).waitFor();
      assert.equal(await card.getByRole('button', { name: '修改 核对后的临时任务', exact: true }).count(), 1);
      await page.unroute('**/api/children', abortChildren);
      await page.getByRole('button', { name: '刷新总览', exact: true }).click();
      await page.getByText('刷新失败，当前显示上次读取的数据，请重试。', { exact: true }).waitFor({ state: 'hidden' });
      pass(`${width}/${theme}: failed refresh keeps previous cards and can be retried`);
      const record = mistakes.createMistake({ child_id: child.id, subject: '数学', description: '错题原始描述', photo_path: '/uploads/retained.png' });
      const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=', 'base64');
      fs.writeFileSync(path.join(dir, 'uploads', 'retained.png'), photo);
      await goto(`/child/${child.id}/mistakes`);
      const mistakeCard = page.locator('[data-mistake-card]').filter({ hasText: '错题原始描述' });
      await mistakeCard.getByRole('button', { name: '修改', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '✏️ 修改错题记录', exact: true });
      await dialog.getByLabel('题目内容与错误原因描述').fill('家长补充的解题方法');
      await snapshot(page, `mistake-${width}-${theme}`);
      mistakes.markMastered(record.id, true);
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(mistakes.getMistake(record.id).is_mastered, true);
      assert.equal(mistakes.getMistake(record.id).photo_path, record.photo_path);
      assert.deepEqual(fs.readFileSync(path.join(dir, 'uploads', 'retained.png')), photo);
      pass(`${width}/${theme}: mistake edit preserves photo and concurrent mastery change`);
      const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() });
      await page.evaluate(token => { sessionStorage.setItem('editing_child_session', '1'); sessionStorage.removeItem('taskie_parent_token'); sessionStorage.setItem('taskie_child_token', token); }, childToken);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('[data-mistake-card]').getByRole('button', { name: '修改', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('题目内容与错误原因描述').fill('孩子保留的草稿');
      mistakes.updateMistake(record.id, { description: '另一设备最新错题', expected_version: mistakes.getMistake(record.id).edit_version });
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: '其他设备' }).waitFor();
      assert.equal(await dialog.getByLabel('题目内容与错误原因描述').inputValue(), '孩子保留的草稿');
      await reloadWithConsent(page, dialog, '重新读取错题', '题目内容与错误原因描述', '孩子保留的草稿', '另一设备最新错题');
      await dialog.getByLabel('选择学科').selectOption('英语');
      await dialog.getByLabel('题目内容与错误原因描述').fill('孩子核对后的订正');
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.getByText('孩子核对后的订正', { exact: true }).waitFor();
      assert.equal(mistakes.getMistake(record.id).subject, '英语');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      pass(`${width}/${theme}: child can edit own mistake after resolving conflict, in both themes`);
    } catch (error) { await reportBrowserFailure(`Record editing ${width}/${theme}`, error, context); throw error; }
    finally { await context.close(); currentContext = null; }
  }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { if (browser) await browser.close(); }
  finally { await app.close(); if (db.open) db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
