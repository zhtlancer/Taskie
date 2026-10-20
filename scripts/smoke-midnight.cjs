// Run npm run build first. Real UI/API with independent, deterministic browser and server clocks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const RealDate = Date;
let now = RealDate.parse('2026-10-20T15:59:50Z');
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-midnight-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function signal(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out waiting for intercepted browser request')), 15000);
    })]);
  } finally { clearTimeout(timer); }
}
async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' });
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.statusCode < 300, response.body);
    return response.json();
  };
  const child = await api('POST', '/children', { name: '跨日验收' });
  await api('POST', '/task-templates', { title: '每日练习', subject: '数学', track_time: true, days_of_week: [0,1,2,3,4,5,6] });
  const old = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '昨天的练习', subject: '其他', track_time: true, points: 7 });
  const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }, { expiresIn: '7d' });
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  // Device timezone deliberately differs from the server business timezone.
  const context = await browser.newContext({ timezoneId: 'UTC', viewport: { width: 390, height: 844 } });
  await context.addInitScript(value => sessionStorage.setItem('taskie_child_token', value), childToken);
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new RealDate(now) });
  await page.clock.pauseAt(new RealDate(now));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
  const card = title => page.locator('div.select-none.border-2').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await card('昨天的练习').getByRole('button', { name: '学习 / 记录', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '分次学习', exact: true });
  await modal.getByRole('button', { name: '开始本次', exact: true }).click();
  await modal.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await modal.getByPlaceholder(/例如：写完第一部分/).fill('跨日仍保留的进展');
  now = RealDate.parse('2026-10-20T16:00:10Z');
  await page.clock.runFor(20000);
  await page.getByText('10月21日', { exact: false }).first().waitFor();
  assert.equal(await modal.getByPlaceholder(/例如：写完第一部分/).inputValue(), '跨日仍保留的进展');
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  const unfinished = page.getByRole('region', { name: '未结束的学习' });
  await unfinished.getByText(/昨天的练习/).waitFor();
  assert.equal(await card('昨天的练习').count(), 0);
  await card('每日练习').getByRole('button', { name: '学习 / 记录', exact: true }).click();
  await modal.getByRole('button', { name: '开始本次', exact: true }).click();
  await modal.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await unfinished.getByText('已暂停', { exact: true }).waitFor();
  await unfinished.getByRole('button', { name: '结束 / 查看记录', exact: true }).click();
  assert.equal(await modal.getByRole('button', { name: '继续本次', exact: true }).count(), 0);
  await modal.getByRole('button', { name: '结束本次学习', exact: true }).click();
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await unfinished.waitFor({ state: 'detached' });
  const details = await api('GET', `/daily-tasks/${old.id}/study`);
  assert.equal(details.total_seconds, 20);
  assert.equal(details.active, null);
  assert.equal(details.record.task.is_completed, false);
  console.log('PASS midnight refresh preserves draft, retains paused historical session access and saves time without points');
  now = RealDate.parse('2026-10-21T16:00:10Z');
  await page.clock.setSystemTime(new RealDate(now));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByText('10月22日', { exact: false }).first().waitFor();
  await unfinished.getByText(/每日练习/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('PASS resume refreshes the business day on a UTC phone without horizontal overflow');
  const race = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '午夜完成请求', subject: '其他', track_time: true, points: 9 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await card('午夜完成请求').getByRole('button', { name: '学习 / 记录', exact: true }).click();
  await modal.getByRole('button', { name: '开始本次', exact: true }).click();
  await modal.getByRole('button', { name: '暂停', exact: true }).waitFor();
  await modal.getByPlaceholder(/例如：写完第一部分/).fill('跨日完成时保存');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let arrived;
  const intercepted = new Promise(resolve => { arrived = resolve; });
  await page.route('**/sessions/*/finish', async route => { arrived(); await gate; await route.continue(); });
  try {
    await modal.getByRole('button', { name: '结束计时并完成任务', exact: true }).click();
    await signal(intercepted);
    now = RealDate.parse('2026-10-22T16:00:10Z');
    await page.clock.setSystemTime(new RealDate(now));
    await page.clock.runFor(1000);
  } finally { release(); }
  await modal.getByRole('status').getByText(/学习已保存/).waitFor();
  await modal.getByText('跨日完成时保存', { exact: true }).waitFor();
  const saved = await api('GET', `/daily-tasks/${race.id}/study`);
  assert.equal(saved.active, null);
  assert.equal(saved.record.task.is_completed, false);
  assert.equal(saved.sessions[0].note, '跨日完成时保存');
  assert.equal(app.services.rewardsService.getTotalPoints(child.id), 0);
  console.log('PASS a finish request crossing midnight saves the session and explains rejected completion');
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '旧请求专属任务', subject: '其他', points: 1 });
  let releaseOld, oldArrived;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const oldReady = new Promise(resolve => { oldArrived = resolve; });
  const heldDate = now;
  let responseReturned;
  const returned = new Promise(resolve => { responseReturned = resolve; });
  await page.route('**/api/daily-tasks?*', async route => {
    if (now !== heldDate) return route.continue();
    const response = await route.fetch();
    oldArrived();
    await oldGate;
    await route.fulfill({ response });
    responseReturned();
  });
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await signal(oldReady);
    now = RealDate.parse('2026-10-23T16:00:10Z');
    await page.clock.setSystemTime(new RealDate(now));
    await page.clock.runFor(1000);
    await page.getByText('10月24日', { exact: false }).first().waitFor();
    await card('每日练习').waitFor();
  } finally { releaseOld(); }
  await signal(returned);
  // Let the browser consume the delayed old response and Vue render any resulting change.
  await page.clock.runFor(100);
  assert.equal(await card('旧请求专属任务').count(), 0);
  console.log('PASS a delayed prior-day task response cannot overwrite the refreshed board');
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  global.Date = RealDate;
});
