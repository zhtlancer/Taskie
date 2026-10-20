// Run npm run build first. Uses in-memory SQLite and cleans up its local server and files.
// Set PLAYWRIGHT_MODULE_PATH / CHROMIUM_PATH if Chromium is installed outside this project, and
// SCREENSHOT_DIR to keep screenshots of the homework pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../backend/src/utils/date');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-homework-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({
  db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist')
});
let browser;
const pass = message => console.log(`PASS ${message}`);
const shot = async (page, name) => {
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`) });
};

async function main() {
  await app.ready();
  const parentToken = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${parentToken}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };
  const today = getTodayDate();
  const child = await api('POST', '/children', { name: '作业验收' });
  // 科学 once a week, three days from today; 数学 on every other day, with a daily workbook task.
  const scienceDay = getDayOfWeek(shiftDate(today, 3));
  await api('POST', `/children/${child.id}/timetables`, {
    name: '本学期', start_date: shiftDate(today, -60), end_date: shiftDate(today, 90),
    slots: [{ id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' }, { id: 's2', kind: 'class', label: '第2节', start_time: '08:50', end_time: '09:30' }],
    lessons: [{ slot_id: 's1', weekday: scienceDay, subject: '科学' },
      ...[0, 1, 2, 3, 4, 5, 6].filter(d => d !== scienceDay).map(weekday => ({ slot_id: 's2', weekday, subject: '数学' }))]
  });
  await api('POST', '/task-templates', { title: '数学练习册', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6] });
  const childToken = (await app.inject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json().token;

  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const errors = [];
  const open = async (role, token, viewport = { width: 1180, height: 820 }) => {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Shanghai' });
    await context.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [`taskie_${role}_token`, token]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    return page;
  };

  // A child records 科学 homework: due the day before the next lesson, and the task is requested.
  const childPage = await open('child', childToken);
  await childPage.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'domcontentloaded' });
  await childPage.getByRole('button', { name: '➕ 记作业' }).click();
  await childPage.locator('form').getByRole('button', { name: '科学', exact: true }).click();
  await childPage.getByPlaceholder(/抄写第 5 课/).fill('完成实验报告\n画出电路图');
  const due = childPage.locator('form input[type=date]').nth(1);
  await childPage.waitForFunction(() => document.querySelectorAll('form input[type=date]')[1]?.value);
  assert.equal(await due.inputValue(), shiftDate(today, 2));
  const request = childPage.getByLabel(/请家长生成打卡任务/);
  assert.equal(await request.isChecked(), true);
  await shot(childPage, '1-child-record-form');
  await childPage.getByRole('button', { name: '保存', exact: true }).click();
  await childPage.getByText('等家长确认').waitFor();
  await shot(childPage, '2-child-homework-book');
  pass('a child records homework due before the next lesson and asks for its task');

  // The parent creates the task from the dashboard.
  const parentPage = await open('parent', parentToken);
  await parentPage.goto(`${base}/parent/dashboard`, { waitUntil: 'domcontentloaded' });
  await parentPage.getByText('孩子记的作业，等你确认生成任务').waitFor();
  await shot(parentPage, '3-parent-dashboard-request');
  await parentPage.getByRole('button', { name: '生成任务', exact: true }).click();
  await parentPage.getByText('孩子记的作业，等你确认生成任务').waitFor({ state: 'detached' });
  const [record] = await api('GET', `/children/${child.id}/homework`);
  assert.equal(record.task_state, 'open');
  pass('the parent creates the requested task from the dashboard');

  // The board shows the task with its homework.
  await childPage.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  await childPage.getByText('科学：完成实验报告', { exact: true }).waitFor();
  await childPage.getByText(/📒 完成实验报告/).waitFor();
  await shot(childPage, '4-child-board-task');
  pass('the board shows the homework task and its full content');

  // Several learning sessions on one day, from the board; no completion or points yet.
  await childPage.getByRole('button', { name: '学习 / 记录', exact: true }).click();
  const study = childPage.getByRole('dialog', { name: '分次做作业' });
  await study.getByRole('button', { name: '开始本次', exact: true }).click();
  await childPage.waitForTimeout(1100);
  await study.getByRole('button', { name: '暂停', exact: true }).click();
  await study.getByRole('button', { name: '继续本次', exact: true }).click();
  await study.getByPlaceholder(/例如：写完第一部分/).fill('第一部分已完成');
  await study.getByRole('button', { name: '结束本次学习', exact: true }).click();
  await study.getByText('第一部分已完成', { exact: true }).waitFor();
  await study.getByRole('button', { name: '开始本次', exact: true }).click();
  await study.getByRole('button', { name: '结束本次学习', exact: true }).click();
  await study.getByRole('button', { name: '＋ 手动补记学习', exact: true }).click();
  await study.getByLabel('本次用时（分钟）').fill('5');
  await study.getByPlaceholder('本次进展（选填）').fill('手动补记的一次');
  await study.getByRole('button', { name: '保存本次', exact: true }).click();
  await study.getByText('手动补记的一次', { exact: true }).waitFor();
  const detail = await api('GET', `/homework/${record.id}/study`);
  assert.equal(detail.sessions.length, 3);
  assert.ok(detail.total_seconds >= 301);
  assert.equal(detail.record.task.is_completed, false);
  await shot(childPage, '8-homework-study-sessions');
  await study.getByRole('button', { name: '关闭', exact: true }).click();
  pass('same-day sessions, pause/resume and manual study time work without marking homework complete');


  // A parent recording 数学 homework is warned about the daily workbook, and no task is preset.
  await parentPage.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'domcontentloaded' });
  await parentPage.getByRole('button', { name: '➕ 记作业' }).click();
  await parentPage.locator('form').getByRole('button', { name: '数学', exact: true }).click();
  await parentPage.getByText(/这天已有「数学练习册」/).waitFor();
  assert.equal(await parentPage.getByLabel(/生成打卡任务/).isChecked(), false);
  await parentPage.getByPlaceholder(/抄写第 5 课/).fill('练习册第 12 页');
  await shot(parentPage, '5-parent-record-form-same-subject');
  await parentPage.getByRole('button', { name: '保存', exact: true }).click();
  await parentPage.getByText('练习册第 12 页').waitFor();
  assert.equal((await api('GET', `/children/${child.id}/homework`)).find(r => r.content === '练习册第 12 页').task_state, 'none');
  pass('same-subject daily tasks are flagged and the task is left out by default');

  // The summary counts each course's homework; a course opens its records.
  await parentPage.getByRole('button', { name: '📊 按课程统计' }).click();
  await parentPage.getByRole('button', { name: '全部', exact: true }).click();
  const scienceRow = parentPage.locator('li button').filter({ hasText: '科学' });
  await scienceRow.getByText('待完成 1').waitFor();
  await parentPage.locator('li button').filter({ hasText: '数学' }).getByText('仅记录 1').waitFor();
  await shot(parentPage, '7-parent-course-summary');
  await scienceRow.click();
  await parentPage.getByText('完成实验报告').waitFor();
  assert.equal(await parentPage.getByText('练习册第 12 页').count(), 0);
  pass('the course summary counts homework per course and opens a course\'s records');

  // Phones: the homework book fits the screen and the tab bar links to it.
  const phone = await open('child', childToken, { width: 390, height: 844 });
  await phone.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'domcontentloaded' });
  await phone.getByText('完成实验报告').waitFor();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await phone.locator('nav a[href$="/homework"]').waitFor();
  await shot(phone, '6-phone-homework-book');
  await phone.getByRole('button', { name: '学习 / 记录', exact: true }).click();
  await phone.getByRole('dialog', { name: '分次做作业' }).waitFor();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot(phone, '9-phone-study-sessions');
  await phone.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();

  await phone.getByRole('button', { name: '📊 按课程统计' }).click();
  await phone.getByText('完成率', { exact: true }).first().waitFor();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  pass('the homework book fits a phone screen');

  // Overdue homework remains learnable, but a child cannot complete it without a parent.
  const late = await api('POST', `/children/${child.id}/homework`, { subject: '科学', content: '超期练习', due_date: today, create_task: true });
  const yesterday = shiftDate(today, -1);
  db.prepare('UPDATE daily_tasks SET date = ?, due_date = NULL WHERE id = ?').run(yesterday, late.task.id);
  db.prepare('UPDATE homework_records SET assigned_date = ?, due_date = ? WHERE id = ?').run(yesterday, yesterday, late.id);
  await childPage.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'domcontentloaded' });
  await childPage.locator('li').filter({ hasText: '超期练习' }).getByRole('button', { name: '学习 / 记录', exact: true }).click();
  const lateStudy = childPage.getByRole('dialog', { name: '分次做作业' });
  await lateStudy.getByRole('button', { name: '开始本次', exact: true }).click();
  await lateStudy.getByRole('button', { name: '申请作业全部完成', exact: true }).click();
  await lateStudy.getByText(/已申请全部完成，等待家长确认/).waitFor();
  assert.equal((await api('GET', `/homework/${late.id}/study`)).record.task.is_completed, false);
  await parentPage.goto(`${base}/parent/dashboard`, { waitUntil: 'domcontentloaded' });
  await parentPage.getByText('📒 超期作业全部完成申请', { exact: true }).waitFor();
  await parentPage.getByRole('button', { name: '确认完成', exact: true }).click();
  await parentPage.getByText('📒 超期作业全部完成申请', { exact: true }).waitFor({ state: 'detached' });
  assert.equal((await api('GET', `/homework/${late.id}/study`)).record.task.is_completed, true);
  pass('a child studies overdue homework and only parent confirmation completes it');

  assert.deepEqual(errors, []);
}

main().then(() => console.log('Homework browser smoke test passed'), error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
