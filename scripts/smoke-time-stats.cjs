// Focused browser regression using in-memory SQLite and a temporary local server.
// Run npm run build first. Set PLAYWRIGHT_MODULE_PATH / CHROMIUM_PATH if needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-time-stats-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({
  db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'),
  authorizedTokensFile: path.join(dir, 'tokens'), clientDistDir: path.resolve(__dirname, '../frontend/dist')
});
let browser;
const pass = message => console.log(`PASS ${message}`);
const render = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Capture a real response, then deliver it only when the test releases it. This exercises the
// component's response handling with deterministic network ordering, including stale failures.
async function holdResponse(page, pattern, failure = false) {
  let arrive, release, finish;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const finished = new Promise(resolve => { finish = resolve; });
  let handled = false;
  const handler = async route => {
    if (handled) return route.continue();
    handled = true;
    try {
      const response = await route.fetch();
      arrive();
      await gate;
      if (failure) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: '旧请求失败' }) });
      else await route.fulfill({ response });
    } finally {
      finish();
    }
  };
  await page.route(pattern, handler);
  return {
    arrived: async () => {
      let timeout;
      try {
        await Promise.race([arrived, new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(`Request not intercepted: ${pattern}`)), 10000);
        })]);
      } finally {
        clearTimeout(timeout);
      }
    },
    release: async () => { release(); await finished; await render(page); },
    dispose: async () => { release(); await page.unroute(pattern, handler); }
  };
}

async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };
  const today = getTodayDate();
  const child = await api('POST', '/children', { name: '用时验收小明' });
  const sister = await api('POST', '/children', { name: '用时验收小红' });
  const template = await api('POST', '/task-templates', { title: '验收口算', subject: '数学', days_of_week: [0, 1, 2, 3, 4, 5, 6], track_time: true, expected_minutes: 15 });
  db.prepare('UPDATE children SET created_at = ?').run(`${shiftDate(today, -180)}T04:00:00Z`);
  db.prepare('UPDATE task_templates SET created_at = ?').run(`${shiftDate(today, -180)}T04:00:00Z`);
  const tasks = app.services.tasksService;
  for (const [delta, seconds] of [[0, 600], [-1, null], [-2, 600], [-8, 1200], [-20, 1800]]) {
    const date = shiftDate(today, delta);
    const task = tasks.getDailyTasks(child.id, date).find(t => t.template_id === template.id);
    tasks.completeDailyTask(task.id, { duration_seconds: seconds });
    if (delta < 0) db.prepare('UPDATE daily_tasks SET completed_at = ? WHERE id = ?').run(`${date}T12:00:00Z`, task.id);
  }
  tasks.completeDailyTask(tasks.getDailyTasks(sister.id, today)[0].id, { duration_seconds: 3600 });
  const goal = await api('POST', `/children/${child.id}/goals`, { title: '验收阅读', subject: '语文', mode: 'progress', unit: '页', total_amount: 100, track_time: true });
  await api('POST', `/period-tasks/${goal.id}/logs`, { amount: 5, duration_seconds: 600 });
  await api('POST', `/children/${child.id}/timetables`, {
    name: '验收学期', start_date: shiftDate(today, -120), end_date: shiftDate(today, 30),
    slots: [{ id: 's1', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' }], lessons: []
  });
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, timezoneId: 'Asia/Shanghai' });
  await context.addInitScript(value => sessionStorage.setItem('taskie_parent_token', value), token);
  const page = await context.newPage();
  const errors = [];
  const prepare = async page => {
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  };
  await prepare(page);
  await page.goto(`${base}/parent/time-stats?child=${child.id}`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('div.bg-white.rounded-2xl.p-4').filter({ has: page.getByText('记录的用时', { exact: true }) });
  const expectTime = value => card.getByText(value, { exact: true }).waitFor();
  const chooseRange = name => page.getByRole('button', { name, exact: true }).click();
  const chooseChild = name => page.getByRole('button', { name: new RegExp(name) }).click();
  const daily = page.locator('section').filter({ has: page.getByRole('heading', { name: '📅 每天的作业用时', exact: true }) });
  await expectTime('30 分');
  await page.getByText('每页 2 分钟', { exact: true }).waitFor();
  await daily.getByRole('button', { name: '📋 看表格', exact: true }).click();
  await daily.getByRole('columnheader', { name: '含估算', exact: true }).waitFor();
  await chooseRange('近 30 天');
  await expectTime('1 小时 20 分');
  await chooseRange('本学期（验收学期）');
  await expectTime('1 小时 20 分');
  await chooseChild('用时验收小红');
  await expectTime('1 小时');
  assert.equal(await page.getByRole('button', { name: '本学期（验收学期）', exact: true }).count(), 0);
  await chooseChild('用时验收小明');
  await expectTime('30 分');
  pass('parent totals, chart/table views, 7/30-day and term filters, child switching and per-page speed');

  // Zero-height columns produce an empty tooltip item list after filtering.
  const chartButton = daily.getByRole('button', { name: '📊 看图', exact: true });
  if (await chartButton.count()) await chartButton.click();
  const canvas = daily.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  for (let i = 1; i <= 9; i++) {
    await page.mouse.move(box.x + box.width * i / 10, box.y + box.height * 0.5);
    await render(page);
  }
  assert.deepEqual(errors, []);
  pass('hovering zero-time days produces no chart errors');

  // Both a successful stale response and a stale failure must leave the latest 7-day view intact.
  const thirtyDays = url => url.pathname.endsWith('/time-stats') && url.searchParams.get('from') === shiftDate(today, -29);
  for (const failure of [false, true]) {
    const held = await holdResponse(page, thirtyDays, failure);
    try {
      await chooseRange('近 30 天');
      await held.arrived();
      await chooseRange('近 7 天');
      await expectTime('30 分');
      await held.release();
      await expectTime('30 分');
      assert.equal(await page.getByText('旧请求失败', { exact: true }).count(), 0);
      assert.match(await page.getByRole('button', { name: '近 7 天', exact: true }).getAttribute('class'), /bg-slate-800/);
    } finally {
      await held.dispose();
    }
  }
  pass('late range responses and failures cannot overwrite the selected range');

  // Completing an old request must not dismiss the newest request's loading state.
  const oldRange = await holdResponse(page, thirtyDays);
  const newRange = await holdResponse(page, url => url.pathname.endsWith('/time-stats') && url.searchParams.get('from') === shiftDate(today, -6));
  try {
    await chooseRange('近 30 天');
    await oldRange.arrived();
    await chooseRange('近 7 天');
    await newRange.arrived();
    await oldRange.release();
    assert.equal(await page.getByText('正在统计...', { exact: false }).isVisible(), true);
    assert.equal(await card.count(), 0);
    await newRange.release();
    await expectTime('30 分');
  } finally {
    await oldRange.dispose();
    await newRange.dispose();
  }
  pass('late responses cannot clear the latest request loading state');

  // Old-child results must not restore its term or replace the selected child's totals.
  const oldTimetable = await holdResponse(page, `**/api/children/${child.id}/timetables`);
  try {
    await chooseChild('用时验收小明');
    await oldTimetable.arrived();
    await chooseChild('用时验收小红');
    await expectTime('1 小时');
    await oldTimetable.release();
    await expectTime('1 小时');
    assert.equal(await page.getByRole('button', { name: '本学期（验收学期）', exact: true }).count(), 0);
  } finally {
    await oldTimetable.dispose();
  }
  const oldStats = await holdResponse(page, `**/api/children/${child.id}/time-stats?*`);
  try {
    await chooseChild('用时验收小明');
    await oldStats.arrived();
    await chooseChild('用时验收小红');
    await expectTime('1 小时');
    await oldStats.release();
    await expectTime('1 小时');
  } finally {
    await oldStats.dispose();
  }
  pass('late child timetable and stats responses cannot change the selected child');

  await page.setViewportSize({ width: 390, height: 844 });
  // The chart resizes to the narrower page over a few frames.
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 2000 });
  const childContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai' });
  const childPage = await childContext.newPage();
  await prepare(childPage);
  await childPage.goto(base, { waitUntil: 'domcontentloaded' });
  await childPage.getByRole('button', { name: /用时验收小明/ }).click();
  // Navigating before the login response arrives would open the history page without a child session.
  await childPage.waitForURL(`**/child/${child.id}/today`);
  await childPage.goto(`${base}/child/${child.id}/history`, { waitUntil: 'domcontentloaded' });
  const childSection = childPage.locator('section').filter({ has: childPage.getByRole('heading', { name: '⏱ 我的作业用时（近 7 天）', exact: true }) });
  await childSection.getByText('👍 验收口算 平均比之前快了 10 分钟', { exact: true }).waitFor();
  assert.equal(await childSection.getByText(/估算|超时/).count(), 0);
  await childSection.getByRole('button', { name: '📋 看表格', exact: true }).click();
  assert.equal(await childSection.getByRole('columnheader', { name: '含估算', exact: true }).count(), 0);
  await render(childPage);
  assert.ok(await childPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const denied = await childPage.evaluate(async id => {
    const response = await fetch(`/api/children/${id}/time-stats`, { headers: { authorization: `Bearer ${sessionStorage.getItem('taskie_child_token')}` } });
    return response.status;
  }, sister.id);
  assert.equal(denied, 403);
  assert.deepEqual(errors, []);
  pass('parent/child phone layouts, child recorded-only view, positive progress and sibling data isolation');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
