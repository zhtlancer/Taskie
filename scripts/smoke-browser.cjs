// Run against an isolated Docker container; the container is always removed.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const name = `taskie-ui-check-${process.pid}`;
let started = false, browser;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function main() {
  docker(['run', '-d', '--name', name, '--tmpfs', '/app/data', '-p', '127.0.0.1::3000', process.env.TASKIE_TEST_IMAGE || 'taskie:reliability']);
  started = true;
  const base = `http://${docker(['port', name, '3000/tcp'])}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, docker(['logs', name]));
  const login = await (await fetch(`${base}/api/auth/parent-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: '1234' }) })).json();
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` };
  const child = await (await fetch(`${base}/api/children`, { method: 'POST', headers, body: JSON.stringify({ name: '浏览器测试孩子' }) })).json();
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Shanghai' });
  const page = await context.newPage();
  await page.route(/fonts\.(?:googleapis|gstatic)\.com/, route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/parent/login');
  for (const digit of ['1', '2', '3', '4']) await page.getByRole('button', { name: digit, exact: true }).click();
  await page.waitForURL('**/parent/dashboard');
  assert.ok(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')));
  console.log('PASS browser parent route guard and PIN login');

  await page.goto(`${base}/parent/tasks`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /新增任务模板/ }).click();
  await page.getByPlaceholder(/例如：/).fill('浏览器周阅读');
  await page.getByRole('button', { name: /每周完成特定次数/ }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByText('浏览器周阅读', { exact: true }).waitFor();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('每周完成特定次数：每周 3 次', { exact: true }).waitFor();
  console.log('PASS browser weekly template persists after reload');

  await page.goto(`${base}/parent/settings`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '立即创建备份', exact: true }).click();
  await page.getByText('备份已保存，可以下载到另一台设备。', { exact: true }).waitFor();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).first().click();
  const download = await downloadEvent;
  const archive = await download.path();
  assert.ok(archive);
  await page.locator('input[type=file]').setInputFiles(archive);
  await page.getByLabel('当前家长 PIN', { exact: false }).fill('1234');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await page.waitForURL('**/parent/login');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')), null);
  console.log('PASS browser backup creation, download, restore and session invalidation');

  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /浏览器测试孩子/ }).click();
  await page.waitForURL(`**/child/${child.id}/today`);
  assert.ok(await page.evaluate(() => sessionStorage.getItem('taskie_child_token')));
  await page.evaluate(async childId => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new FormData(); data.append('child_id', childId); data.append('subject', '数学'); data.append('description', '照片访问测试'); data.append('file', blob, 'test.png');
    const response = await fetch('/api/mistakes', { method: 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('taskie_child_token')}` }, body: data });
    if (!response.ok) throw new Error(await response.text());
  }, child.id);
  await page.goto(`${base}/child/${child.id}/mistakes`, { waitUntil: 'domcontentloaded' });
  const photo = page.locator('img[alt="错题图片"]');
  await photo.waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="错题图片"]')?.naturalWidth > 0);
  console.log('PASS browser authenticated photo upload and private image rendering');
  await page.goto(`${base}/parent/tasks`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/parent/login');
  console.log('PASS browser password-free child receives credentials and cannot open parent pages');

  await context.setOffline(true);
  await page.getByRole('link', { name: /返回孩子端/ }).click();
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /无法连接服务器/);
  const demo = await page.evaluate(() => JSON.parse(localStorage.getItem('homework_app_state_v2') || 'null'));
  assert.equal(demo, null, 'Production must not initialize or write a demo database');
  console.log('PASS browser network failure is visible; no automatic demo switch');
  await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /浏览器测试孩子/ }).waitFor();
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('PASS browser network recovery and zero JavaScript errors');
  await context.close();
}

main().catch(error => { console.error(error); if (started) console.error(docker(['logs', '--tail', '30', name])); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (started) docker(['rm', '-f', name]);
});
