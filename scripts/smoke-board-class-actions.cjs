// Build first. Real HTTP service, isolated SQLite, no mocked successful API responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-board-classes-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser, passed = 0, failed = 0;
const errors = [];
const today = getTodayDate(), tomorrow = shiftDate(today, 1);
const confirmation = page => page.getByRole('dialog', { name: '确认操作', exact: true });
const modalFor = page => page.getByRole('dialog', { name: '今天的课', exact: true });
const rowFor = (page, cls, source = today, actual = source) => modalFor(page).locator(`[data-class-id="${cls.id}"][data-source-date="${source}"][data-schedule-date="${actual}"]`);
async function confirm(page, name) {
  const dialog = confirmation(page);
  await dialog.getByText(new RegExp(`只对 ${name} 生效`)).waitFor();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
}
async function action(page, row, label, child, status = 200) {
  await row.getByRole('button', { name: label, exact: true }).click();
  const response = page.waitForResponse(r => ['PUT', 'DELETE'].includes(r.request().method()) && /outside-class/.test(r.url()));
  await confirm(page, child.name);
  const result = await response;
  assert.equal(result.status(), status, await result.text());
  await modalFor(page).getByRole('button', { name: '关闭', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[role=dialog][aria-modal=true] button[aria-label="关闭"]')?.disabled);
  return result.request().postDataJSON();
}
async function layout(page, modal) {
  await modal.locator('button').last().scrollIntoViewIfNeeded();
  assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'dialog must fit the viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const small = await modal.locator('button:visible').evaluateAll(nodes => nodes.filter(el => {
    const box = el.getBoundingClientRect(); return box.height < 43.9 || box.width < 43.9;
  }).map(el => el.textContent));
  assert.deepEqual(small, [], '44px touch targets');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await modal.getByRole('button', { name: '关闭', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await modal.evaluate(el => el.contains(document.activeElement)), true, 'focus stays inside dialog');
}
async function openMove(page, row, date) {
  await row.getByRole('button', { name: '调课', exact: true }).click();
  const form = page.getByRole('dialog', { name: '调整这节课', exact: true });
  assert.equal(await form.getByLabel('开始时间').inputValue(), '16:00');
  assert.equal(await form.getByLabel('结束时间').inputValue(), '17:00');
  assert.ok((await form.getByRole('link', { name: '更多设置 →' }).getAttribute('href')).includes('/parent/schedule?child='));
  await form.getByLabel('新日期').fill(date);
  await form.getByLabel('开始时间').fill('18:00');
  await form.getByLabel('结束时间').fill('19:00');
  await form.getByRole('button', { name: '确认调课', exact: true }).click();
  return form;
}
async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const api = async (method, url, payload) => {
    const result = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(result.statusCode < 300, result.body); return result.json();
  };
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 1180]) for (const colorScheme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: '看板甲' });
    const other = app.services.childrenService.createChild({ name: '看板乙' });
    const cls = app.services.scheduleService.createClass({ title: `看板钢琴-${width}-${colorScheme}`, child_ids: [child.id, other.id],
      start_date: today, days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00', total_lessons: 5, create_task: true });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme, hasTouch: true, timezoneId: 'America/Los_Angeles' });
    await context.addInitScript(({ token, child }) => {
      sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
    }, { token, child });
    let childContext;
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    try {
      await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      const task = page.locator('[data-task-card]').filter({ hasText: cls.title });
      await task.waitFor();
      await page.locator('button[title="今天的课"]').click();
      const modal = modalFor(page), row = rowFor(page, cls), next = rowFor(page, cls, tomorrow);
      await modal.getByText(`只对 ${child.name} 生效`, { exact: true }).waitFor();
      await row.getByText('未确认', { exact: true }).waitFor();
      assert.equal(await next.getByRole('button', { name: '已上课', exact: true }).count(), 0);
      assert.equal(await next.getByRole('button', { name: '缺席', exact: true }).count(), 0);
      await layout(page, modal);
      if (process.env.SMOKE_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
        await modal.locator('.overflow-y-auto').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, `board-classes-${width}-${colorScheme}.png`) });
      }
      // Cancel confirmation: no mutation.
      await row.getByRole('button', { name: '请假', exact: true }).click();
      await confirmation(page).getByText(/今天请假会取消当天还没完成的打卡任务/).waitFor();
      await confirmation(page).getByText(/请假默认不扣课时/).waitFor();
      await confirmation(page).getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(db.prepare('SELECT COUNT(*) n FROM outside_class_exceptions WHERE child_id = ?').get(child.id).n, 0);
      let arrived, release;
      const started = new Promise(resolve => { arrived = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(`**/outside-classes/${cls.id}/exceptions`, async route => { arrived(); await gate; await route.continue(); }, { times: 1 });
      const leaveAction = action(page, row, '请假', child);
      const timeout = setTimeout(release, 8000);
      try {
        await Promise.race([started, leaveAction.then(() => { throw new Error('Expected held request'); })]);
        assert.equal(await modal.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape'); assert.equal(await modal.count(), 1);
        assert.equal(await row.getByRole('button', { name: '请假', exact: true }).isDisabled(), true);
      } finally { release(); clearTimeout(timeout); }
      const leave = await leaveAction;
      assert.deepEqual([leave.child_id, leave.date, leave.expected_exception_id], [child.id, today, null]);
      await row.getByText('已请假', { exact: true }).waitFor();
      await task.waitFor({ state: 'detached' });
      assert.equal((await api('GET', `/children/${other.id}/schedule?from=${today}`))[0].outside[0].status, 'scheduled');
      await action(page, row, '撤销请假', child);
      await row.getByText('未确认', { exact: true }).waitFor(); await task.waitFor();
      // Tomorrow can be moved or put on leave, but cannot confirm attendance.
      await action(page, next, '请假', child); await next.getByText('已请假', { exact: true }).waitFor();
      await action(page, next, '撤销请假', child);
      await openMove(page, next, shiftDate(today, 2));
      const moved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
      await confirm(page, child.name); assert.equal((await moved).status(), 200);
      await next.getByText(`已调到 ${Number(shiftDate(today, 2).slice(5, 7))}/${Number(shiftDate(today, 2).slice(8))} 日`, { exact: true }).waitFor();
      await action(page, next, '撤销调课', child);
      // Incoming lessons use their source date, even if the source is in the future.
      await openMove(page, next, today);
      await confirm(page, child.name);
      const incoming = rowFor(page, cls, tomorrow, today);
      await incoming.getByRole('button', { name: '已上课', exact: true }).waitFor();
      const attendedIncoming = await action(page, incoming, '已上课', child);
      assert.equal(attendedIncoming.lesson_date, tomorrow);
      await incoming.getByText('已上课', { exact: true }).waitFor();
      await action(page, incoming, '撤销确认', child);
      await action(page, incoming, '撤销调课', child);
      const attended = await action(page, row, '已上课', child);
      assert.equal(attended.expected_revision, null); assert.equal(Object.hasOwn(attended, 'charged'), false);
      await row.getByText('已上课', { exact: true }).waitFor();
      assert.equal(await row.getByRole('button', { name: '请假', exact: true }).count(), 0);
      const cleared = await action(page, row, '撤销确认', child);
      assert.ok(cleared.expected_revision); assert.equal(cleared.status, 'pending');
      await row.getByRole('button', { name: '缺席', exact: true }).waitFor();
      // Another parent changes attendance while the current confirmation is open.
      await row.getByRole('button', { name: '缺席', exact: true }).click();
      await api('PUT', `/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: today, status: 'attended' });
      let conflict = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/attendance'));
      await confirm(page, child.name); assert.equal((await conflict).status(), 409);
      await modal.getByRole('alert').getByText(/出勤刚被其他设备修改过/).waitFor();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      await row.getByText('已上课', { exact: true }).waitFor();
      await action(page, row, '撤销确认', child);
      await action(page, row, '缺席', child); await row.getByText('缺席', { exact: true }).waitFor();
      // Exception conflict is a real concurrent write, not a fabricated 409.
      await next.getByRole('button', { name: '请假', exact: true }).click();
      await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: tomorrow, kind: 'leave', expected_exception_id: null });
      conflict = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
      await confirm(page, child.name); assert.equal((await conflict).status(), 409);
      await modal.getByRole('alert').getByText(/请假或调课刚被修改过/).waitFor();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      await next.getByText('已请假', { exact: true }).waitFor();
      // Transport failure: one request only, exact uncertainty message, explicit refresh.
      await action(page, next, '撤销请假', child);
      let requests = 0;
      await page.route(`**/outside-classes/${cls.id}/exceptions`, route => { requests++; return route.abort('connectionfailed'); }, { times: 1 });
      await next.getByRole('button', { name: '请假', exact: true }).click();
      await confirm(page, child.name);
      await modal.getByRole('alert').getByText('操作未确认，请刷新后核对', { exact: true }).waitFor();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      assert.equal(requests, 1);
      assert.equal(await next.getByRole('button', { name: '请假', exact: true }).isDisabled(), true);
      await modal.getByRole('alert').getByRole('button', { name: '刷新日程和打卡任务', exact: true }).click();
      await next.getByRole('button', { name: '请假', exact: true }).waitFor();
      assert.equal(db.prepare('SELECT COUNT(*) n FROM outside_class_attendance WHERE child_id = ?').get(other.id).n, 0);
      await modal.getByRole('button', { name: '关闭', exact: true }).click();
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
      // Child session is independent, with readable statuses and no action buttons.
      const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch(), child_epoch: child.session_epoch ?? null });
      childContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme, hasTouch: true, timezoneId: 'America/Los_Angeles' });
      await childContext.addInitScript(({ token, child }) => {
        sessionStorage.setItem('taskie_child_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
      }, { token: childToken, child });
      await childContext.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const childPage = await childContext.newPage(); childPage.setDefaultTimeout(10000);
      childPage.on('pageerror', error => errors.push(error.message));
      await childPage.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      await childPage.locator('button[title="今天的课"]').click();
      await rowFor(childPage, cls).getByText('缺席', { exact: true }).waitFor();
      await rowFor(childPage, cls, tomorrow).getByText('未确认', { exact: true }).waitFor();
      assert.equal(await modalFor(childPage).locator('[aria-label="家长课程操作"]').count(), 0);
      assert.equal(await modalFor(childPage).getByRole('button').count(), 1, 'only dialog close is available');
      const forbidden = await app.inject({ method: 'PUT', url: `/api/outside-classes/${cls.id}/attendance`, headers: { authorization: `Bearer ${childToken}` }, payload: { child_id: child.id, lesson_date: today, status: 'attended' } });
      assert.equal(forbidden.statusCode, 403);
      assert.deepEqual(errors, []);
      passed++; console.log(`PASS ${width}px ${colorScheme}: leave/move/attendance/undo, task refresh, isolation, conflicts, network uncertainty, child read-only, layout`);
    } catch (error) {
      failed++; console.error(`FAIL ${width}px ${colorScheme}:`, error);
    } finally { if (childContext) await childContext.close(); await context.close(); }
  }
  console.log(`board-class-actions: ${passed} passed, ${failed} failed`);
  assert.equal(failed, 0);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
