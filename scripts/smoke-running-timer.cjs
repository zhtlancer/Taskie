// Run npm run build first. Verifies the board keeps its scroll position when a timer starts, the
// timer bar on phones, the sidebar card on tablets and the parent's child cards, against a real
// in-memory API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-running-timer-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const { childrenService, tasksService, taskStudyService, timersService } = app.services;
  const child = childrenService.createChild({ name: '计时条验收' });
  for (let i = 1; i <= 9; i++) tasksService.createAdhocTask(child.id, { title: `前面的任务${i}`, subject: '语文', points: 1 });
  const timed = tasksService.createAdhocTask(child.id, { title: '最后的口算', subject: '数学', track_time: true, points: 5 });
  const parentToken = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const goal = (await app.inject({ method: 'POST', url: `/api/children/${child.id}/goals`, headers: { authorization: `Bearer ${parentToken}` },
    payload: { title: '验收阅读', subject: '语文', mode: 'progress', unit: '页', total_amount: 100, track_time: true } })).json();
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  const errors = [];
  async function open(viewport, parent = false) {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Shanghai' });
    const token = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() });
    await context.addInitScript(({ key, value }) => sessionStorage.setItem(key, value),
      { key: parent ? 'taskie_parent_token' : 'taskie_child_token', value: parent ? parentToken : token });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    return page;
  }

  // Phone: the board stays where it was, and the bar follows the child across pages.
  let page = await open({ width: 390, height: 844 });
  await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: '最后的口算', exact: true }) });
  await card.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => scrollY);
  assert.ok(scrolled > 300, `the timed card should sit far down the board (${scrolled})`);
  await card.getByRole('button', { name: '学习 / 记录', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '分次学习', exact: true });
  const reloaded = page.waitForResponse(response => response.url().includes('/api/daily-tasks?'));
  await modal.getByRole('button', { name: '开始本次', exact: true }).click();
  await reloaded;
  await modal.getByRole('button', { name: '暂停', exact: true }).waitFor();
  const bar = page.getByRole('region', { name: '正在计时', exact: true });
  await bar.waitFor();
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await modal.waitFor({ state: 'detached' });
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrolled) <= 2, 'starting a timer must not move the board back to the top');
  assert.equal(await page.getByText('正在加载今日任务...').count(), 0);
  console.log('PASS starting a timer from a task far down the board keeps the board in place');

  await bar.getByText('数学 · 最后的口算').waitFor();
  const clock = bar.locator('[data-running-clock]');
  const first = await clock.textContent();
  assert.match(first, /^\d\d:\d\d$/);
  await page.waitForFunction(([el, text]) => el.textContent !== text, [await clock.elementHandle(), first]);
  const nav = await page.getByRole('navigation', { name: '学生导航' }).boundingBox();
  const barBox = await bar.boundingBox();
  assert.ok(barBox.y + barBox.height <= nav.y + 1, 'the bar sits above the tab bar');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const mainBox = await page.locator('main').boundingBox();
  assert.ok(mainBox.y + mainBox.height <= barBox.y + 1, 'the end of the board scrolls clear of the bar');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const button of await bar.getByRole('button').all()) assert.ok((await button.boundingBox()).height >= 44);

  await page.getByRole('navigation', { name: '学生导航' }).getByRole('link', { name: /作业/ }).click();
  await page.waitForURL(/\/homework$/);
  await bar.getByText('数学 · 最后的口算').waitFor();
  await bar.getByRole('button').first().click();
  await page.waitForURL(url => url.pathname.endsWith('/today') && !url.search);
  modal = page.getByRole('dialog', { name: '分次学习', exact: true });
  await modal.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  console.log('PASS the phone bar ticks above the tab bar, follows other pages and reopens its study session');

  await bar.getByRole('button', { name: '⏸ 暂停', exact: true }).click();
  const pausedBar = page.getByRole('region', { name: '计时已暂停', exact: true });
  await pausedBar.getByText('数学 · 最后的口算').waitFor();
  await bar.waitFor({ state: 'detached' });
  const active = taskStudyService.details(timed.id).active;
  assert.equal(active.timer_started_at, null);
  assert.ok(active.duration_seconds >= 1);
  assert.equal(timersService.running(child.id), null);
  const pausedClock = await pausedBar.locator('[data-running-clock]').textContent();
  await page.waitForTimeout(1500);
  assert.equal(await pausedBar.locator('[data-running-clock]').textContent(), pausedClock, 'a paused clock stands still');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pausedBar.getByRole('button', { name: '▶ 继续', exact: true }).click();
  await bar.getByText('数学 · 最后的口算').waitFor();
  assert.equal(taskStudyService.details(timed.id).active.id, active.id, 'resuming continues the same session');
  assert.equal(timersService.running(child.id).session_id, active.id);
  console.log('PASS pausing from the bar keeps it, paused with the time banked, across a reload; resuming continues the session');
  await page.context().close();

  // Tablet: the sidebar card brings a long-term task back into view and pauses it.
  page = await open({ width: 1180, height: 820 });
  await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  const goalRow = page.locator(`[data-timer-id="${goal.id}"]`);
  await goalRow.getByRole('button', { name: '⏱ 开始计时', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: '学习导航' }).getByRole('region', { name: '正在计时', exact: true });
  await sidebar.getByText('语文 · 验收阅读').waitFor();
  // As if it had run two minutes, so the paused card offers to resume.
  db.prepare('UPDATE period_tasks SET timer_started_at = ? WHERE id = ?').run(new Date(Date.now() - 120000).toISOString(), goal.id);
  assert.equal(await page.getByRole('region', { name: '正在计时', exact: true }).count(), 1, 'tablets show only the sidebar card');
  await page.getByRole('complementary', { name: '学习导航' }).getByRole('link', { name: /字词本/ }).click();
  await page.waitForURL(/\/characters$/);
  await sidebar.getByRole('button').first().click();
  await page.waitForURL(url => url.pathname.endsWith('/today') && !url.search);
  await goalRow.waitFor();
  await page.waitForFunction(id => {
    const box = document.querySelector(`[data-timer-id="${id}"]`)?.getBoundingClientRect();
    return box && box.top >= 0 && box.bottom <= innerHeight;
  }, goal.id);
  await sidebar.getByRole('button', { name: '⏸ 暂停', exact: true }).click();
  await sidebar.waitFor({ state: 'detached' });
  await page.getByRole('complementary', { name: '学习导航' }).getByRole('region', { name: '计时已暂停', exact: true }).getByText('语文 · 验收阅读').waitFor();
  await goalRow.getByRole('button', { name: '▶ 继续', exact: true }).waitFor();
  assert.equal(timersService.running(child.id), null);
  assert.deepEqual(errors, []);
  console.log('PASS the tablet sidebar card shows a long-term timer on other pages, returns to it and keeps it once paused');
  await page.context().close();

  // A polling read during a slow pause must not make the successful mutation disappear.
  timersService.apply('goal', goal.id, 'start');
  page = await open({ width: 390, height: 844 });
  await page.goto(`${base}/child/${child.id}/homework`);
  const raceBar = page.getByRole('region', { name: '正在计时', exact: true });
  await raceBar.waitFor();
  const loadedAt = await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runningTimer').timer.timer_loaded_at);
  let releasePause, pauseArrived;
  const pauseGate = new Promise(resolve => { releasePause = resolve; });
  const pauseSeen = new Promise(resolve => { pauseArrived = resolve; });
  await page.route('**/current-timer/pause', async route => {
    pauseArrived();
    await pauseGate;
    await route.continue();
  });
  await raceBar.getByRole('button', { name: '⏸ 暂停', exact: true }).click();
  await pauseSeen;
  const poll = page.waitForResponse(response => response.url().endsWith('/current-timer'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await poll;
  // Wait until the poll has written its running timer into the store (a new load time), rather than
  // just arriving at the browser, so the pause response is the one that lands last.
  await page.waitForFunction(before => {
    const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runningTimer');
    return s.busy && s.timer && s.timer.timer_loaded_at !== before;
  }, loadedAt);
  releasePause();
  await raceBar.waitFor({ state: 'detached' });
  await page.getByRole('region', { name: '计时已暂停', exact: true }).getByText('语文 · 验收阅读').waitFor();
  assert.equal(timersService.running(child.id), null);
  console.log('PASS a refresh during pause cannot keep the stopped timer visible on another page');
  await page.context().close();

  // The pause can finish on the server before its response arrives. A different page/device may
  // start a new timer in that gap; the old pause response must not clear that newer state.
  timersService.apply('goal', goal.id, 'start');
  page = await open({ width: 390, height: 844 });
  await page.goto(`${base}/child/${child.id}/homework`);
  const newerBar = page.getByRole('region', { name: '正在计时', exact: true });
  await newerBar.getByText('语文 · 验收阅读').waitFor();
  let releaseOldPause, oldPauseArrived;
  const oldPauseGate = new Promise(resolve => { releaseOldPause = resolve; });
  const oldPauseSeen = new Promise(resolve => { oldPauseArrived = resolve; });
  await page.route('**/current-timer/pause', async route => {
    const response = await route.fetch();
    oldPauseArrived();
    await oldPauseGate;
    await route.fulfill({ response });
  });
  await newerBar.getByRole('button', { name: '⏸ 暂停', exact: true }).click();
  await oldPauseSeen;
  assert.equal(timersService.running(child.id), null);
  timersService.apply('task', timed.id, 'start');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await newerBar.getByText('数学 · 最后的口算').waitFor();
  releaseOldPause();
  await page.waitForFunction(() => !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runningTimer').busy);
  assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runningTimer').timer?.id), timed.id);
  await newerBar.getByText('数学 · 最后的口算').waitFor();
  assert.equal(timersService.running(child.id).id, timed.id);
  console.log('PASS a delayed pause response cannot erase a newly started timer');
  await page.context().close();

  // An old board response arriving after navigation cannot switch the shared timer back to child A.
  const other = childrenService.createChild({ name: '另一个孩子' });
  const otherTask = tasksService.createAdhocTask(other.id, { title: '另一个计时', subject: '数学', track_time: true });
  timersService.apply('task', otherTask.id, 'start');
  page = await open({ width: 390, height: 844 }, true);
  let releaseTasks, tasksArrived, tasksDelivered;
  const tasksGate = new Promise(resolve => { releaseTasks = resolve; });
  const tasksSeen = new Promise(resolve => { tasksArrived = resolve; });
  const tasksDone = new Promise(resolve => { tasksDelivered = resolve; });
  await page.route('**/api/daily-tasks?**', async route => {
    if (new URL(route.request().url()).searchParams.get('child_id') !== child.id) return route.continue();
    const response = await route.fetch();
    tasksArrived();
    await tasksGate;
    await route.fulfill({ response });
    tasksDelivered();
  });
  await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  await tasksSeen;
  await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(`/child/${id}/homework`), other.id);
  await page.getByRole('region', { name: '正在计时', exact: true }).getByText('数学 · 另一个计时').waitFor();
  releaseTasks();
  await tasksDone;
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('runningTimer').childId), other.id);
  await page.getByRole('region', { name: '正在计时', exact: true }).getByText('数学 · 另一个计时').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS a stale board response cannot replace the new child’s running timer');
  await page.context().close();

  // Parent: each child's card shows the running or paused timer and opens it on the child's board.
  page = await open({ width: 1180, height: 820 }, true);
  await page.goto(`${base}/parent/dashboard`, { waitUntil: 'domcontentloaded' });
  const childCard = name => page.locator('div.rounded-3xl').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const strip = childCard('计时条验收').locator('[data-child-timer]');
  await strip.getByText('数学 · 最后的口算').waitFor();
  await strip.getByText('计时中', { exact: true }).waitFor();
  await childCard('另一个孩子').locator('[data-child-timer]').getByText('数学 · 另一个计时').waitFor();
  const shown = await strip.locator('.tabular-nums').textContent();
  await page.waitForFunction(([el, text]) => el.textContent !== text, [await strip.locator('.tabular-nums').elementHandle(), shown]);
  timersService.pauseCurrent(child.id);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await strip.getByText('⏸ 已暂停', { exact: true }).waitFor();
  assert.ok((await strip.boundingBox()).height >= 44);
  await strip.click();
  await page.waitForURL(url => url.pathname === `/child/${child.id}/today` && !url.search);
  await page.getByRole('dialog', { name: '分次学习', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS parent child cards show running and paused timers, tick, and open the task on the board');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
