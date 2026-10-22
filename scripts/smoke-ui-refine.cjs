// Build the frontend first. In-memory data only; closes its browser/server on exit.
// CHROMIUM_PATH selects a locally installed browser; SCREENSHOT_DIR keeps previews.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const c = createTestApp();
let browser;
const errors = [];
const pass = message => console.log(`PASS ${message}`);

async function main() {
  await c.app.ready();
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const api = async (method, url, payload) => {
    const response = await c.app.inject({ method, url: `/api${url}`, payload });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };
  const child = await api('POST', '/children', { name: '界面验收' });
  const today = getTodayDate();
  await api('POST', '/task-templates', { title: '界面计时练习', subject: '数学', track_time: true, days_of_week: [0,1,2,3,4,5,6] });
  await api('POST', '/task-templates', { title: '确认框练习', subject: '其他', days_of_week: [0,1,2,3,4,5,6] });
  c.db.prepare('UPDATE children SET created_at = ?').run(`${shiftDate(today, -10)}T00:00:00Z`);
  c.db.prepare('UPDATE task_templates SET created_at = ?').run(`${shiftDate(today, -10)}T00:00:00Z`);
  const tasks = await api('GET', `/daily-tasks?child_id=${child.id}`);
  const timed = tasks.find(task => task.title === '界面计时练习');
  c.app.services.taskStudyService.start(timed.id);
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', timezoneId: 'Asia/Shanghai' });
  await context.addInitScript(value => { if (location.protocol === 'http:') sessionStorage.setItem('taskie_parent_token', value); }, token);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  context.on('page', page => {
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => { errors.push(`Unexpected native dialog: ${dialog.message()}`); dialog.dismiss(); });
  });
  const page = await context.newPage();
  const goto = route => page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
  const expectTheme = async (target, dark) => {
    await target.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, dark);
    assert.equal(await target.evaluate(() => document.documentElement.style.colorScheme), dark ? 'dark' : 'light');
  };
  const openMore = async () => {
    await page.getByRole('button', { name: '更多学习功能', exact: true }).click();
    return page.getByRole('dialog', { name: '更多学习功能', exact: true });
  };
  await goto(`/child/${child.id}/today`);
  await expectTheme(page, true);
  let more = await openMore();
  await more.getByRole('button', { name: '☀ 浅色', exact: true }).click();
  await expectTheme(page, false);
  await page.reload({ waitUntil: 'networkidle' });
  await expectTheme(page, false);
  const sibling = await context.newPage();
  await sibling.goto(`${base}/`, { waitUntil: 'networkidle' });
  await expectTheme(sibling, false);
  more = await openMore();
  await more.getByRole('button', { name: '☾ 暗色', exact: true }).click();
  await expectTheme(page, true);
  await expectTheme(sibling, true);
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, true);
  await more.getByRole('button', { name: '跟随系统', exact: true }).click();
  await expectTheme(page, false);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectTheme(page, true);
  await sibling.evaluate(() => localStorage.removeItem('taskie_theme'));
  await expectTheme(page, true);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '更多学习功能', exact: true }).evaluate(el => el === document.activeElement), true);
  const clock = page.locator('[data-task-card]').filter({ hasText: '界面计时练习' }).getByRole('timer');
  const reading = await clock.innerText();
  await page.waitForFunction(old => [...document.querySelectorAll('[data-task-card]')].find(el => el.textContent.includes('界面计时练习'))?.querySelector('[role=timer]')?.innerText !== old, reading);
  assert.ok((await api('GET', `/daily-tasks/${timed.id}/study`)).active);
  pass('system/light/dark, reload, cross-tab changes, focus restoration and live timers');

  // All secondary destinations are still reachable from the phone menu.
  for (const [label, route] of [['字词本','characters'],['错题本','mistakes'],['课表','schedule'],['历史','history']]) {
    more = await openMore();
    await more.getByRole('link', { name: new RegExp(label) }).click();
    await page.waitForURL(`${base}/child/${child.id}/${route}`);
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  pass('all secondary phone destinations remain available');

  await goto('/parent/tasks');
  const card = page.locator('div').filter({ has: page.getByText('确认框练习', { exact: true }) }).filter({ has: page.getByRole('button', { name: '删除', exact: true }) }).last();
  const deleteButton = card.getByRole('button', { name: '删除', exact: true });
  await deleteButton.click();
  let dialog = page.getByRole('dialog', { name: '确认操作', exact: true });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: '取消', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.getByRole('button', { name: '确认', exact: true }).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await deleteButton.evaluate(el => el === document.activeElement), true);
  assert.ok((await api('GET', '/task-templates')).some(task => task.title === '确认框练习'));
  await deleteButton.click();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
  await page.getByText('确认框练习', { exact: true }).waitFor({ state: 'detached' });
  pass('delete confirmation traps keyboard focus, cancels safely and confirms a real deletion');

  await goto('/parent/dashboard');
  await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).first().click();
  await page.getByRole('dialog', { name: '确认操作', exact: true }).waitFor();
  await page.goBack();
  await page.waitForURL(`${base}/parent/dashboard`);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.ok((await api('GET', '/task-templates')).some(task => task.title === '界面计时练习'));
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  pass('browser back cancels stale confirmation without deleting data or leaving scroll locked');

  // Prompt cancellation preserves task state; a reason produces an actual parent skip.
  await goto(`/parent/children/${child.id}/backfill`);
  const backfillCard = page.locator('article').filter({ hasText: '界面计时练习' });
  await backfillCard.getByRole('button', { name: '标记跳过', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '填写原因', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('textbox', { name: '原因' }).evaluate(el => el === document.activeElement), true);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await backfillCard.getByRole('button', { name: '标记跳过', exact: true }).waitFor();
  await backfillCard.getByRole('button', { name: '标记跳过', exact: true }).click();
  await dialog.getByRole('textbox', { name: '原因' }).fill('界面验收请假');
  await page.keyboard.press('Enter');
  await backfillCard.getByRole('button', { name: '撤销跳过', exact: true }).waitFor();
  assert.equal(c.db.prepare('SELECT skip_reason FROM daily_tasks WHERE child_id = ? AND date = ?').get(child.id, shiftDate(today, -1)).skip_reason, '界面验收请假');
  pass('backfill reason prompt supports autofocus, cancellation and Enter submission');

  for (const viewport of [{width:390,height:844},{width:1180,height:820}]) {
    await page.setViewportSize(viewport);
    for (const route of ['today','homework','characters','word-study','rewards','history','schedule','mistakes']) {
      await goto(`/child/${child.id}/${route}`);
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      if (viewport.width > 1000) assert.equal(await page.getByRole('complementary', { name: '学习导航' }).isVisible(), true);
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `dark-${viewport.width}-${route}.png`) });
      }
    }
  }
  assert.deepEqual(errors, []);
  pass('phone/tablet empty states and desktop navigation fit without page errors');

  await page.setViewportSize({ width: 390, height: 844 });
  const failedChildren = '**/api/children';
  await page.route(failedChildren, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '验收网络故障' }) }));
  await goto('/parent/dashboard');
  await page.getByText('暂时无法加载孩子的进展，请重新加载。', { exact: true }).waitFor();
  assert.equal(await page.getByText('还没有添加小朋友账号哦', { exact: true }).count(), 0);
  await page.unroute(failedChildren);
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.getByRole('heading', { name: child.name, exact: true }).waitFor();
  pass('dashboard distinguishes a load failure from no children and retries successfully');

  // The learning dialog retains the attempt while its save response is pending.
  await api('POST', '/characters', { child_id: child.id, char: '山' });
  for (const skill of ['recognize', 'write']) await api('PUT', `/children/${child.id}/word-study/plans/${skill}`, { enabled: true, new_target: 1, days_of_week: [0,1,2,3,4,5,6] });
  await goto(`/child/${child.id}/word-study`);
  const plan = page.locator('section').filter({ has: page.getByRole('heading', { name: '字词认读学习', exact: true }) });
  const start = plan.getByRole('button', { name: '开始 / 继续学习 →', exact: true });
  await start.click();
  let practice = page.getByRole('dialog', { name: /认读练习/ });
  await page.keyboard.press('Escape');
  await practice.waitFor({ state: 'detached' });
  assert.equal(await start.evaluate(el => el === document.activeElement), true);
  await start.click();
  await practice.getByRole('button', { name: '我已尝试，揭晓核对', exact: true }).click();
  let release, arrive;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const attempts = '**/api/word-study/items/*/attempts';
  await page.route(attempts, async route => {
    const response = await route.fetch();
    arrive();
    await gate;
    await route.fulfill({ response });
  });
  const timeout = setTimeout(release, 10000);
  try {
    await practice.getByRole('button', { name: '独立完成', exact: true }).click();
    await arrived;
    assert.equal(await practice.getByRole('button', { name: '关闭练习', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await practice.isVisible(), true);
  } finally { release(); clearTimeout(timeout); }
  await practice.getByRole('button', { name: '下一项 / 返回清单', exact: true }).click();
  await practice.waitFor({ state: 'detached' });
  await page.unroute(attempts);
  const writing = page.locator('section').filter({ has: page.getByRole('heading', { name: '字词书写学习', exact: true }) });
  await writing.getByRole('button', { name: '开始 / 继续学习 →', exact: true }).click();
  practice = page.getByRole('dialog', { name: /书写练习/ });
  await practice.getByRole('button', { name: '我已尝试，揭晓核对', exact: true }).click();
  const paper = practice.locator('div.touch-none').first();
  assert.equal(await paper.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  await practice.getByRole('button', { name: '关闭练习', exact: true }).click();
  pass('learning modal restores focus, protects pending saves and retains white writing paper in dark mode');

  await page.setViewportSize({ width: 1180, height: 820 });
  await goto(`/child/${child.id}/characters`);
  const characterButton = page.getByRole('button', { name: '查看「山」的笔顺与详情', exact: true });
  await characterButton.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: '生字笔顺与临摹', exact: true }).waitFor();
  await page.getByRole('dialog', { name: '生字笔顺与临摹', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
  pass('tablet character cards open their detail view from the keyboard');

  const restricted = await browser.newContext({ colorScheme: 'dark' });
  await restricted.addInitScript(() => Object.defineProperty(window, 'localStorage', { value: { getItem() { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); } } }));
  const restrictedPage = await restricted.newPage();
  restrictedPage.on('pageerror', e => errors.push(e.message));
  await restrictedPage.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await restrictedPage.goto(`${base}/`, { waitUntil: 'networkidle' });
  await expectTheme(restrictedPage, true);
  await restrictedPage.getByRole('button', { name: '☀ 浅色', exact: true }).click();
  await expectTheme(restrictedPage, false);
  await restricted.close();
  assert.deepEqual(errors, []);
  pass('system appearance and in-page choices work even when storage is disabled');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await c.app.close();
  cleanupTestApp(c);
});
