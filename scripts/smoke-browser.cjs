// Browser smoke test for the main family flows, run against an isolated Docker container that is
// always removed afterwards. Build the image first (default tag taskie:reliability):
//   docker build -t taskie:reliability . && node scripts/smoke-browser.cjs
// Set TASKIE_TEST_IMAGE for another image, CHROMIUM_PATH to use an installed Chromium, and
// PLAYWRIGHT_MODULE_PATH if playwright is installed outside this project.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const name = `taskie-ui-check-${process.pid}`;
const DEFAULT_PIN = '1234';
const NEW_PIN = '2580';
let started = false, browser;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const pass = message => console.log(`PASS ${message}`);

async function main() {
  docker(['run', '-d', '--name', name, '--tmpfs', '/app/data', '-p', '127.0.0.1::3000', process.env.TASKIE_TEST_IMAGE || 'taskie:reliability']);
  started = true;
  const base = `http://${docker(['port', name, '3000/tcp']).split('\n')[0]}`;
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, docker(['logs', name]));
  // The entrypoint drops privileges and execs node as PID 1.
  assert.equal(docker(['exec', name, 'stat', '-c', '%u', '/proc/1']), '1000', 'the app must run as uid 1000');

  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pressPin = async pin => { for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click(); };

  // --- Device authorization: everything is blocked until this browser is paired.
  const blocked = await fetch(`${base}/api/children`);
  assert.equal(blocked.status, 401);
  assert.equal((await blocked.json()).code, 'DEVICE_NOT_AUTHORIZED');
  await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByText('这台设备还没有授权').waitFor();
  const code = (await page.locator('#code').innerText()).replace(/\D/g, '');
  assert.match(code, /^\d{6}$/);
  assert.match(docker(['exec', name, 'node', 'src/cli.js', 'approve-device', code, '冒烟测试浏览器']), /已授权设备/);
  // The pairing page notices the approval and opens the requested page.
  await page.waitForURL('**/parent/login');
  const deviceCookie = (await context.cookies()).find(cookie => cookie.name === 'taskie_device');
  assert.ok(deviceCookie?.httpOnly, 'the device token must be an HttpOnly cookie');
  const device = { cookie: `taskie_device=${deviceCookie.value}` };
  pass('browser is blocked until paired, then the server command authorizes it');

  // --- First login must replace the default parent PIN.
  await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/parent/login');
  await page.getByText(`初始 PIN 码为 ${DEFAULT_PIN}`).waitFor();
  await pressPin(DEFAULT_PIN);
  await page.waitForURL('**/parent/setup-pin');
  await page.goto(`${base}/parent/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/parent/setup-pin');
  await pressPin(DEFAULT_PIN);
  await pressPin(NEW_PIN);
  await pressPin(NEW_PIN);
  await page.waitForURL('**/parent/dashboard');
  assert.ok(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')));
  assert.deepEqual(await (await fetch(`${base}/api/auth/setup`, { headers: device })).json(), { parent_pin_is_default: false });
  pass('browser forces replacing the default parent PIN, then signs in with the new one');

  // Test data through the API, as the parent.
  const login = await (await fetch(`${base}/api/auth/parent-login`, { method: 'POST', headers: { ...device, 'content-type': 'application/json' }, body: JSON.stringify({ pin: NEW_PIN }) })).json();
  assert.equal(login.must_change_pin, false);
  const api = async (method, url, body) => {
    const headers = { ...device, authorization: `Bearer ${login.token}`, ...(body ? { 'content-type': 'application/json' } : {}) };
    const response = await fetch(`${base}/api${url}`, { method, headers, body: body && JSON.stringify(body) });
    assert.ok(response.ok, `${method} ${url}: ${await response.clone().text()}`);
    return response.json();
  };
  const child = await api('POST', '/children', { name: '浏览器测试孩子' });
  await api('POST', '/task-templates', { title: '浏览器口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], points: 10 });
  await api('POST', `/children/${child.id}/goals`, { title: '浏览器读绘本', subject: '语文', mode: 'progress', input_mode: 'position', total_amount: 40, unit: '页', points: 1, daily_required: true });
  await api('POST', '/reward-items', { title: '浏览器奖励', cost: 15 });

  // --- Parent pages: weekly template, one-off task.
  await page.goto(`${base}/parent/tasks`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /新增任务模板/ }).click();
  await page.getByPlaceholder(/例如：/).fill('浏览器周阅读');
  await page.getByRole('button', { name: /每周完成特定次数/ }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByText('浏览器周阅读', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('每周完成特定次数：每周 3 次', { exact: true }).waitFor();
  pass('browser weekly template persists after reload');
  // Whether a weekly task is required depends on the weekday, so it is removed before the child steps.
  const weekly = (await api('GET', '/task-templates')).find(t => t.title === '浏览器周阅读');
  await api('DELETE', `/task-templates/${weekly.id}`);

  await page.goto(`${base}/parent/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /➕ 添加/ }).click();
  await page.getByPlaceholder(/订正数学练习/).fill('浏览器临时任务');
  await page.getByRole('button', { name: '确认添加', exact: true }).click();
  await page.getByText(/浏览器临时任务/).waitFor();
  await page.getByText('浏览器读绘本').waitFor();
  pass('browser parent adds a one-off task and sees the long-term task on the dashboard');

  // --- The next-class reminder advances even when no task timer runs.
  const reminderDate = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const reminderClasses = [];
  for (const [title, start_time, end_time] of [['提醒午间课', '12:00', '13:00'], ['提醒下午课', '16:30', '17:30']]) {
    reminderClasses.push(await api('POST', '/outside-classes', {
      title, days_of_week: [0, 1, 2, 3, 4, 5, 6], start_date: reminderDate, start_time, end_time
    }));
  }
  const reminderContext = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Shanghai' });
  await reminderContext.addCookies(await context.cookies());
  await reminderContext.addInitScript(token => sessionStorage.setItem('taskie_parent_token', token), login.token);
  const reminderPage = await reminderContext.newPage();
  await reminderPage.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.abort());
  await reminderPage.clock.install({ time: new Date(`${reminderDate}T10:00:00+08:00`) });
  await reminderPage.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  await reminderPage.getByTitle('今天的课', { exact: true }).getByText('12:00', { exact: true }).waitFor();
  await reminderPage.clock.fastForward(4 * 3600 * 1000);
  await reminderPage.getByTitle('今天的课', { exact: true }).getByText('16:30', { exact: true }).waitFor();
  await reminderContext.close();
  for (const cls of reminderClasses) await api('DELETE', `/outside-classes/${cls.id}`);
  pass('browser next-class reminder advances without running a task timer');

  // --- Backup round trip; restoring ends every session.
  await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '立即创建备份', exact: true }).click();
  await page.getByText('备份已保存，可以下载到另一台设备。', { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).first().click();
  const archive = await (await downloadEvent).path();
  assert.ok(archive);
  await page.locator('input[type=file]').setInputFiles(archive);
  await page.getByLabel('当前家长 PIN', { exact: false }).fill(NEW_PIN);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.waitForURL('**/parent/login');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')), null);
  pass('browser backup creation, download, restore and session invalidation');

  // --- Child: today's tasks, long-term progress, all done.
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /浏览器测试孩子/ }).click();
  await page.waitForURL(`**/child/${child.id}/today`);
  assert.ok(await page.evaluate(() => sessionStorage.getItem('taskie_child_token')));
  // 浏览器口算, the one-off task and the long-term task's daily item.
  await page.getByText('临时', { exact: true }).waitFor();
  await page.getByText(/完成 0 \/ 3/).waitFor();
  await page.locator('h4', { hasText: '浏览器口算' }).click();
  await page.locator('h4', { hasText: '浏览器临时任务' }).click();
  await page.getByText(/完成 2 \/ 3/).waitFor();
  await page.getByText('每天要记录 · 今天还没记').waitFor();
  const panelValue = await page.getByText(/^第 \d+ 页$/).innerText();
  await page.getByRole('button', { name: '记录读到这里', exact: true }).click();
  await page.getByText('今天已记录 ✓').waitFor();
  await page.getByText(`读到第 ${panelValue.match(/\d+/)[0]} / 40 页`).waitFor();
  await page.getByText('太棒啦！今日作业任务已全部完成！').waitFor();
  pass('browser child checks off tasks, logs long-term progress by page and reaches all done');

  // Later page entries depend on earlier positions: only the latest can be undone.
  const firstPosition = Number(panelValue.match(/\d+/)[0]);
  await page.evaluate(async ({ childId, position }) => {
    const headers = { Authorization: `Bearer ${sessionStorage.getItem('taskie_child_token')}`, 'content-type': 'application/json' };
    const goals = await (await fetch(`/api/children/${childId}/goals`, { headers })).json();
    const book = goals.find(goal => goal.title === '浏览器读绘本');
    const response = await fetch(`/api/period-tasks/${book.id}/logs`, { method: 'POST', headers, body: JSON.stringify({ position }) });
    if (!response.ok) throw new Error(await response.text());
  }, { childId: child.id, position: firstPosition + 1 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const earlierUndo = page.getByRole('button', { name: `今天 读到第 ${firstPosition} 页 · 撤销`, exact: true });
  const latestUndo = page.getByRole('button', { name: `今天 读到第 ${firstPosition + 1} 页 · 撤销`, exact: true });
  await latestUndo.waitFor();
  assert.equal(await earlierUndo.isDisabled(), true);
  assert.equal(await latestUndo.isEnabled(), true);
  await latestUndo.click();
  await page.getByText(`读到第 ${firstPosition} / 40 页`).waitFor();
  assert.equal(await earlierUndo.isEnabled(), true);
  await page.getByText('太棒啦！今日作业任务已全部完成！').waitFor();
  pass('browser only allows undoing the latest page entry and preserves the daily completion');

  // --- Child redeems a reward.
  await page.goto(`${base}/child/${child.id}/rewards`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '兑换', exact: true }).click();
  await page.getByRole('button', { name: '确定兑换？', exact: true }).click();
  await page.getByText('等待确认', { exact: true }).waitFor();
  pass('browser child requests a reward and the points are held');

  // --- Private photos.
  await page.evaluate(async childId => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new FormData(); data.append('child_id', childId); data.append('subject', '数学'); data.append('description', '照片访问测试'); data.append('file', blob, 'test.png');
    const response = await fetch('/api/mistakes', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('taskie_child_token')}` }, body: data });
    if (!response.ok) throw new Error(await response.text());
  }, child.id);
  await page.goto(`${base}/child/${child.id}/mistakes`, { waitUntil: 'domcontentloaded' });
  await page.locator('img[alt="错题图片"]').waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="错题图片"]')?.naturalWidth > 0);
  pass('browser authenticated photo upload and private image rendering');

  // --- Character and word book: a word with a category; strokes load from the app, not a CDN.
  const cdnRequests = [];
  page.on('request', request => { if (request.url().includes('hanzi-writer-data')) cdnRequests.push(request.url()); });
  await page.goto(`${base}/child/${child.id}/characters`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
  const lookup = page.getByRole('dialog');
  const strokes = page.waitForResponse(response => response.url().includes(`/hanzi-data/${encodeURIComponent('行')}.json`) && response.status() === 200);
  await lookup.getByPlaceholder('输入汉字或词语（如：学、春天）').fill('银行');
  await strokes;
  await lookup.getByText('yín háng', { exact: true }).waitFor();
  await lookup.getByRole('button', { name: /笔画要改正/ }).click();
  await lookup.getByRole('button', { name: /加入生字生词本/ }).click();
  await lookup.getByText('已在生字生词本').waitFor();
  await lookup.getByTitle('关闭').click();
  await page.locator('.font-kai', { hasText: '银' }).first().click();
  const detail = page.getByRole('dialog');
  const fixMark = detail.getByRole('button', { name: /笔画要改正/ });
  assert.equal(await fixMark.getAttribute('aria-pressed'), 'true');
  await fixMark.click();
  await detail.getByText('去掉「笔画要改正」需要家长操作').waitFor();
  assert.equal(await detail.getByRole('button', { name: '移出', exact: true }).isDisabled(), true);
  await detail.getByRole('button', { name: /会写/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button[aria-pressed="true"]')].map(b => b.textContent.trim()).join() .includes('会写'));
  await detail.getByTitle('关闭弹窗').click();
  await page.getByRole('button', { name: /易错字/ }).click();
  await page.getByText('当前筛选下没有字词').waitFor();
  await page.getByRole('button', { name: /笔画要改正/ }).click();
  await page.locator('.font-kai', { hasText: '行' }).first().waitFor();
  assert.deepEqual(cdnRequests, []);
  pass('browser child adds a word with a category, may add but not remove categories, and strokes load locally');

  await page.goto(`${base}/parent/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/parent/login');
  pass('browser password-free child receives credentials and cannot open parent pages');

  // --- Parent approves the redemption.
  await pressPin(NEW_PIN);
  await page.waitForURL('**/parent/dashboard');
  await page.goto(`${base}/parent/rewards`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '✓ 确认兑换', exact: true }).click();
  await page.getByText('已兑换', { exact: true }).waitFor();
  pass('browser parent approves the redemption');

  // --- The parent opens the child's word book from the console and takes a category away.
  await page.goto(`${base}/parent/children`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: '📖 字词本' }).click();
  await page.waitForURL(`**/child/${child.id}/characters`);
  await page.locator('.font-kai', { hasText: '银' }).first().click();
  const parentDetail = page.getByRole('dialog');
  await parentDetail.getByText('点一下添加或去掉').waitFor();
  await parentDetail.getByRole('button', { name: /笔画要改正/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button[aria-pressed="false"]')].some(button => button.textContent.includes('笔画要改正')));
  assert.equal(await parentDetail.getByRole('button', { name: '移出', exact: true }).isEnabled(), true);
  await parentDetail.getByTitle('关闭弹窗').click();
  pass('browser parent opens the word book from the console and removes a category');

  // --- Network failure is reported, and the app recovers.
  // Let the login page finish its own requests first, so the failure comes from the click.
  await page.goto(`${base}/parent/login`, { waitUntil: 'networkidle' });
  await context.setOffline(true);
  await page.getByRole('link', { name: /返回孩子端/ }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /无法连接服务器/);
  pass('browser network failure is visible');
  await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /浏览器测试孩子/ }).waitFor();
  assert.equal(errors.length, 0, JSON.stringify(errors));
  pass('browser network recovery and zero JavaScript errors');

  // --- A second device (a phone) is authorized from the parent console by its pairing code.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Shanghai' });
  const mobile = await phone.newPage();
  await mobile.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.abort());
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto(base, { waitUntil: 'domcontentloaded' });
  await mobile.getByText('这台设备还没有授权').waitFor();
  const phoneCode = (await mobile.locator('#code').innerText()).replace(/\D/g, '');
  await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('例如 384921').fill(phoneCode);
  await page.getByPlaceholder('例如 妈妈的 iPhone').fill('冒烟测试手机');
  await page.getByRole('button', { name: '授权这台设备', exact: true }).click();
  await page.getByText('已授权「冒烟测试手机」').waitFor();
  await page.getByText('当前设备').waitFor();
  await mobile.getByRole('button', { name: /浏览器测试孩子/ }).waitFor();
  pass('browser parent authorizes a second device by its pairing code, which then opens the app');

  // Both approvals are in the parent console's history and the container log.
  await page.getByText('授权了「冒烟测试手机」').waitFor();
  await page.getByText('授权了「冒烟测试浏览器」').waitFor();
  await page.getByText('服务器命令').first().waitFor();
  const logs = execFileSync('docker', ['logs', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(logs, /设备授权：授权了设备「冒烟测试浏览器」（服务器命令）/);
  assert.match(logs, /设备授权：授权了设备「冒烟测试手机」（在「冒烟测试浏览器」上操作）/);
  assert.match(logs, new RegExp(`设备授权：新设备请求配对，配对码 ${phoneCode}`));
  assert.doesNotMatch(logs, new RegExp(deviceCookie.value));
  pass('browser device authorization history shows both approvals, which also reach the container log without tokens');
  await context.close();

  // --- Phones: every page fits the screen width, and the child tab bar navigates.
  const fitsWidth = async path => {
    await mobile.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    const width = await mobile.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= 390, `${path} is ${width}px wide on a 390px phone`);
  };
  await mobile.getByRole('button', { name: /浏览器测试孩子/ }).click();
  await mobile.waitForURL(`**/child/${child.id}/today`);
  for (const tab of ['homework', 'rewards', 'mistakes', 'characters', 'history', 'today']) await fitsWidth(`/child/${child.id}/${tab}`);
  await mobile.getByRole('link', { name: /积分/ }).last().click();
  await mobile.waitForURL(`**/child/${child.id}/rewards`);
  await mobile.goto(`${base}/parent/login`, { waitUntil: 'domcontentloaded' });
  for (const digit of NEW_PIN) await mobile.getByRole('button', { name: digit, exact: true }).click();
  await mobile.waitForURL('**/parent/dashboard');
  for (const path of ['/parent/dashboard', '/parent/children', '/parent/tasks', '/parent/periods', '/parent/rewards', '/parent/settings']) await fitsWidth(path);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  pass('phone layout: every child and parent page fits 390px and the child tab bar navigates');
  await phone.close();
}

main().catch(error => { console.error(error); if (started) console.error(docker(['logs', '--tail', '30', name])); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (started) docker(['rm', '-f', name]);
});
