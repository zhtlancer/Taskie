// Run npm run build first. Verifies the rest countdown from the timer bar: it pauses the study
// timer, counts down on this device (across a reload), rings at the end and offers to resume, can be
// ended early, and fits the phone bar and tablet sidebar in light and dark themes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-rest-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const { childrenService, tasksService, taskStudyService, timersService } = app.services;
  const child = childrenService.createChild({ name: '休息验收' });
  const task = tasksService.createAdhocTask(child.id, { title: '口算练习', subject: '数学', track_time: true, points: 5 });
  taskStudyService.start(task.id);
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const errors = [];
  async function open(viewport, colorScheme = 'light') {
    const context = await browser.newContext({ viewport, colorScheme, timezoneId: 'Asia/Shanghai' });
    await context.addInitScript(value => sessionStorage.setItem('taskie_child_token', value),
      app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }));
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.clock.install();
    return page;
  }

  // Phone, dark theme: starting a rest pauses the study timer and shows the countdown.
  let page = await open({ width: 390, height: 844 }, 'dark');
  await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'domcontentloaded' });
  const runningBar = page.getByRole('region', { name: '正在计时', exact: true });
  await runningBar.getByText('数学 · 口算练习').waitFor();
  await runningBar.getByRole('button', { name: '休息一下', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '☕ 休息一下', exact: true });
  assert.deepEqual(await picker.getByRole('button', { name: /分钟$/ }).allTextContents(), ['5 分钟', '10 分钟', '15 分钟']);
  await picker.getByRole('button', { name: '5 分钟', exact: true }).click();
  const resting = page.getByRole('dialog', { name: '☕ 休息中', exact: true });
  await resting.locator('[data-rest-clock]').getByText('05:00').waitFor();
  assert.equal(timersService.running(child.id), null, 'the study timer is paused on the server');
  const banked = taskStudyService.details(task.id).active.duration_seconds;
  await page.clock.runFor(61000);
  await resting.locator('[data-rest-clock]').getByText('03:59').waitFor();
  console.log('PASS choosing 5 minutes pauses the study timer and counts the rest down');

  // Tucked away, the bar keeps the countdown; it survives a reload on this device.
  await resting.getByRole('button', { name: '收起', exact: true }).click();
  await resting.waitFor({ state: 'detached' });
  const pausedBar = page.getByRole('region', { name: '计时已暂停', exact: true });
  const chip = pausedBar.getByRole('button', { name: /^休息还剩 03:5\d/ });
  await chip.waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the phone bar fits while resting');
  for (const button of await pausedBar.getByRole('button').all()) assert.ok((await button.boundingBox()).height >= 44);
  await chip.click();
  await resting.waitFor();
  // A reload on this device brings the countdown straight back.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await resting.locator('[data-rest-clock]').getByText(/^03:5\d$/).waitFor();
  console.log('PASS the tucked-away rest shows in the bar, reopens from it and survives a reload');

  // The end rings, brings the dialog back and resumes the same study session; rest time is not study time.
  await resting.getByRole('button', { name: '收起', exact: true }).click();
  await page.clock.runFor(4 * 60000);
  const over = page.getByRole('dialog', { name: '⏰ 休息结束', exact: true });
  await over.getByText('休息结束，回来继续吧！').waitFor();
  assert.equal(taskStudyService.details(task.id).active.duration_seconds, banked, 'the rest added no study time');
  const session = taskStudyService.details(task.id).active.id;
  await over.getByRole('button', { name: '▶ 继续计时', exact: true }).click();
  await over.waitFor({ state: 'detached' });
  await runningBar.getByRole('button', { name: '休息一下', exact: true }).waitFor();
  assert.equal(timersService.running(child.id).session_id, session, 'resuming continues the same session');
  assert.equal(await page.evaluate(id => localStorage.getItem(`taskie_rest_${id}`), child.id), null);
  console.log('PASS the end of the rest reappears and resumes the same session without adding rest time');

  // Ending early leaves the timer paused and clears the rest.
  await runningBar.getByRole('button', { name: '休息一下', exact: true }).click();
  await picker.getByRole('button', { name: '15 分钟', exact: true }).click();
  await resting.locator('[data-rest-clock]').getByText('15:00').waitFor();
  await resting.getByRole('button', { name: '提前结束休息', exact: true }).click();
  await resting.waitFor({ state: 'detached' });
  await pausedBar.getByRole('button', { name: '休息一下', exact: true }).waitFor();
  assert.equal(timersService.running(child.id), null);
  console.log('PASS ending a rest early clears it and leaves the timer paused');

  // Resuming from the bar during a rest ends the rest.
  await pausedBar.getByRole('button', { name: '休息一下', exact: true }).click();
  await picker.getByRole('button', { name: '10 分钟', exact: true }).click();
  await resting.getByRole('button', { name: '收起', exact: true }).click();
  await pausedBar.getByRole('button', { name: '▶ 继续', exact: true }).click();
  await runningBar.getByRole('button', { name: '休息一下', exact: true }).waitFor();
  assert.equal(await page.evaluate(id => localStorage.getItem(`taskie_rest_${id}`), child.id), null);
  console.log('PASS resuming study from the bar ends the rest');
  await page.context().close();

  // Tablet, light theme: the sidebar card offers the rest too.
  page = await open({ width: 1180, height: 820 });
  await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  const sidebar = page.getByRole('complementary', { name: '学习导航' }).getByRole('region', { name: '正在计时', exact: true });
  const restButton = sidebar.getByRole('button', { name: '休息一下', exact: true });
  assert.ok((await restButton.boundingBox()).height >= 44);
  await restButton.click();
  await page.getByRole('dialog', { name: '☕ 休息一下', exact: true }).getByRole('button', { name: '10 分钟', exact: true }).click();
  const tabletRest = page.getByRole('dialog', { name: '☕ 休息中', exact: true });
  await tabletRest.locator('[data-rest-clock]').getByText('10:00').waitFor();
  await page.keyboard.press('Escape');
  await tabletRest.waitFor({ state: 'detached' });
  await page.getByRole('complementary', { name: '学习导航' }).getByRole('button', { name: /^休息还剩 10:00/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS the tablet sidebar card offers the rest and keeps its countdown');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
