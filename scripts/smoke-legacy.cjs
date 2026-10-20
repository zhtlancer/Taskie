// Run npm run build first. Verifies parent-only legacy corrections against a real in-memory API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-legacy-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const { childrenService, tasksService, taskStudyService, homeworkService, homeworkStudyService, rewardsService } = app.services;
  const child = childrenService.createChild({ name: '累计更正验收' });
  const today = getTodayDate();
  const ordinary = tasksService.createAdhocTask(child.id, { title: '旧普通任务', subject: '语文', track_time: true, points: 10 });
  const course = homeworkService.create(child.id, { subject: '数学', content: '旧课程练习', due_date: shiftDate(today, 2), create_task: true, points: 10 }, 'parent');
  const cases = [ { task: ordinary, service: taskStudyService, id: ordinary.id, course: false, title: '旧普通任务' },
    { task: course.task, service: homeworkStudyService, id: course.id, course: true, title: '旧课程练习' } ];
  for (const c of cases) {
    db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = 900 WHERE id = ?').run(c.task.id);
    c.service.manual(c.id, { request_id: `smoke_legacy_${c.task.id}`, duration_seconds: 300, note: '真实分次记录' }, 'parent');
    c.service.complete(c.id, 'parent');
  }
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [];
  async function open(role, viewport) {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Shanghai' });
    const token = app.jwt.sign({ role, child_id: child.id, epoch: app.sessionEpoch() });
    await context.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [`taskie_${role}_token`, token]);
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    return page;
  }
  for (const [index, c] of cases.entries()) {
    const page = await open('parent', index ? { width: 1180, height: 820 } : { width: 390, height: 844 });
    await page.goto(`${base}/child/${child.id}/${c.course ? 'homework' : 'today'}`, { waitUntil: 'domcontentloaded' });
    const card = c.course ? page.locator('li').filter({ hasText: c.title }) : page.locator('div.select-none.border-2').filter({ has: page.getByRole('heading', { name: c.title, exact: true }) });
    await card.getByRole('button', { name: c.course ? '学习 / 记录' : '查看记录', exact: true }).click();
    const modal = page.getByRole('dialog', { name: c.course ? '分次做作业' : '分次学习', exact: true });
    const sessions = c.service.details(c.id).sessions;
    for (const [minutes, reason, expected] of [[10, '核实后改为十分钟', 600], [0, '核实旧累计应归零', 0]]) {
      await modal.getByRole('button', { name: '更正旧累计用时', exact: true }).click();
      await modal.getByLabel('旧累计用时（分钟）', { exact: true }).fill(String(minutes));
      await modal.getByLabel('更正原因', { exact: true }).fill(reason);
      await modal.getByRole('button', { name: '保存旧累计更正', exact: true }).click();
      await modal.getByRole('button', { name: '保存旧累计更正', exact: true }).waitFor({ state: 'detached' });
      const result = c.service.details(c.id);
      assert.equal(result.legacy_seconds, expected);
      assert.equal(result.total_seconds, expected + 300);
      assert.deepEqual(result.sessions, sessions);
      assert.equal(result.record.task.is_completed, true);
    }
    await modal.locator('summary').filter({ hasText: '旧累计更正记录' }).click();
    await modal.getByText('核实旧累计应归零', { exact: true }).waitFor();
    // Two parent devices: reject a stale edit, retaining its draft for review.
    await modal.getByRole('button', { name: '更正旧累计用时', exact: true }).click();
    await modal.getByLabel('旧累计用时（分钟）', { exact: true }).fill('3');
    await modal.getByLabel('更正原因', { exact: true }).fill('本设备尚未保存的原因');
    c.service.correctLegacy(c.id, { duration_seconds: 120, expected_old_seconds: 0, reason: '另一个设备核实' }, 'parent');
    await modal.getByRole('button', { name: '保存旧累计更正', exact: true }).click();
    await modal.getByRole('alert').getByText(/旧累计用时已变化/).waitFor();
    assert.equal(await modal.getByLabel('更正原因', { exact: true }).inputValue(), '本设备尚未保存的原因');
    assert.equal(c.service.details(c.id).legacy_seconds, 120);
    await modal.getByRole('button', { name: '取消', exact: true }).click();
    await modal.getByRole('button', { name: '更正旧累计用时', exact: true }).click();
    assert.equal(await modal.getByLabel('旧累计用时（分钟）', { exact: true }).inputValue(), '2');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log(`PASS ${c.course ? 'tablet homework' : 'phone ordinary task'} corrects and zeros legacy time, audits changes and retains drafts on conflict`);
    await page.context().close();
  }
  const page = await open('child', { width: 390, height: 844 });
  await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'domcontentloaded' });
  await page.locator('li').filter({ hasText: '旧课程练习' }).getByRole('button', { name: '学习 / 记录', exact: true }).click();
  await page.getByRole('dialog', { name: '分次做作业' }).waitFor();
  assert.equal(await page.getByRole('button', { name: '更正旧累计用时', exact: true }).count(), 0);
  assert.equal(rewardsService.getTotalPoints(child.id), 20);
  assert.deepEqual(errors, []);
  console.log('PASS child has no correction control and all parent corrections retain earned points');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
