// Build first. Regression cases from the frontend review: real isolated API/data, lost HTTP
// responses, concurrent devices, family midnight, and phone/tablet in both themes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const RealDate = Date;
const midnight = RealDate.parse('2026-10-22T15:59:30Z');
let now = midnight;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-frontend-regression-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: process.env.CLIENT_DIST || path.resolve(__dirname, '../frontend/dist') });
let browser, base, child, token, currentContext;
const today = '2026-10-22';
const results = [];
async function api(method, url, payload) {
  const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
  assert.ok(response.statusCode < 300, response.body);
  return response.json();
}
async function open(role, width = 390, theme = 'dark') {
  now = midnight;
  currentContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme: theme, timezoneId: 'America/Los_Angeles' });
  const auth = role === 'parent' ? token : app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() });
  await currentContext.addInitScript(({ role, auth, child, theme }) => {
    sessionStorage.setItem(`taskie_${role}_token`, auth);
    sessionStorage.setItem('current_child', JSON.stringify(child));
    localStorage.setItem('taskie_theme', theme);
    localStorage.setItem('app_sound_muted', 'true');
  }, { role, auth, child, theme });
  const page = await currentContext.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', err => { throw err; });
  await page.clock.install({ time: new RealDate(now) });
  await page.clock.pauseAt(new RealDate(now));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return page;
}
async function check(name, fn) {
  if (process.env.REGRESSION_FILTER && !name.includes(process.env.REGRESSION_FILTER)) return;
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (err) { results.push({ name, passed: false, error: err.message }); console.error('FAIL', name, err.message); }
  finally { await currentContext?.close(); currentContext = null; }
}
async function snapshot(page, name) {
  if (!process.env.SMOKE_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, `${name}.png`) });
}
const pending = page => page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith('taskie_pending_write_v1:')).map(k => JSON.parse(sessionStorage.getItem(k))));

async function main() {
  await app.ready();
  token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  child = app.services.childrenService.createChild({ name: '前端回归孩子' });
  await api('POST', `/children/${child.id}/timetables`, { name: '回归课表', start_date: shiftDate(today, -30), end_date: shiftDate(today, 30),
    slots: [{ id: 's1', kind: 'class', label: '一', start_time: '08:00', end_time: '08:40' }],
    lessons: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ slot_id: 's1', weekday, subject: '数学' })) });
  base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());

  await check('K8 fee draft version survives range reads and requires acknowledgement', async () => {
    const cls = await api('POST', '/outside-classes', { title: '并发钢琴', start_date: shiftDate(today, -2), days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00', total_lessons: 5 });
    await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: 10000 });
    const page = await open('parent');
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    const card = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(cls.title, { exact: true }) });
    await card.getByRole('button', { name: '出勤与学费', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${child.name} · ${cls.title}`, exact: true });
    const input = dialog.locator('#class-fee');
    await input.fill('150');
    now += 2000;
    await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: 20000 });
    await dialog.getByRole('button', { name: '往前 30 天' }).click();
    await dialog.getByText('总学费 ¥200.00', { exact: true }).waitFor();
    const response = page.waitForResponse(r => r.url().endsWith('/fee') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: '保存学费' }).click();
    assert.equal((await response).status(), 409, 'range navigation must not rebase the old draft');
    assert.equal(await input.inputValue(), '150');
    await dialog.getByRole('button', { name: '已看过最新金额，保留输入继续修改' }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '保存学费' }).isDisabled(), true);
    assert.equal(db.prepare('SELECT total_fee_cents FROM outside_class_fees WHERE class_id=? AND child_id=?').get(cls.id, child.id).total_fee_cents, 20000);
    await dialog.getByRole('button', { name: '已看过最新金额，保留输入继续修改' }).click();
    now += 2000;
    await dialog.getByRole('button', { name: '保存学费' }).click();
    await dialog.getByText('总学费 ¥150.00', { exact: true }).waitFor();
  });

  for (const viaBar of [false, true]) await check(`K9 changed rest target ${viaBar ? 'via bar' : 'at rest end'}`, async () => {
    const first = app.services.tasksService.createAdhocTask(child.id, { title: '休息前的任务', subject: '数学', track_time: true });
    app.services.taskStudyService.start(first.id);
    const page = await open('child', viaBar ? 1180 : 390, viaBar ? 'light' : 'dark');
    await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
    const bar = page.getByRole('region', { name: /正在计时|计时已暂停/ }).filter({ visible: true });
    await bar.getByRole('button', { name: '休息一下', exact: true }).click();
    await page.getByRole('dialog', { name: '☕ 休息一下', exact: true }).getByRole('button', { name: '5 分钟', exact: true }).click();
    const saved = await page.evaluate(id => JSON.parse(localStorage.getItem(`taskie_rest_${id}`)), child.id);
    const second = app.services.tasksService.createAdhocTask(child.id, { title: '另一设备的新任务', subject: '语文', track_time: true });
    app.services.taskStudyService.start(second.id);
    app.services.timersService.pauseCurrent(child.id);
    await page.reload({ waitUntil: 'networkidle' });
    await bar.getByText('语文 · 另一设备的新任务', { exact: true }).waitFor();
    if (viaBar) {
      await page.getByRole('dialog', { name: '☕ 休息中', exact: true }).getByRole('button', { name: '收起', exact: true }).click();
      await bar.getByRole('button', { name: '▶ 继续', exact: true }).click();
    } else {
      await page.clock.runFor(301000);
      await page.getByRole('dialog', { name: '⏰ 休息结束', exact: true }).getByRole('button', { name: '▶ 继续计时', exact: true }).click();
    }
    await page.waitForFunction(() => document.body.textContent.includes('计时任务已变化') || !document.querySelector('[role=dialog]'));
    assert.equal(app.services.timersService.running(child.id), null, 'no timer is resumed before consent');
    await page.getByText('计时任务已变化，现在是「语文 · 另一设备的新任务」。要继续这项任务吗？', { exact: true }).waitFor();
    assert.equal(saved.target?.id, first.id, 'rest saves the actual paused target');
    assert.ok(saved.target.session_id, 'rest saves the paused session');
    await snapshot(page, `rest-target-${viaBar}`);
    await page.getByRole('button', { name: '暂不继续', exact: true }).click();
    assert.equal(app.services.timersService.running(child.id), null);
    if (viaBar) {
      await page.getByRole('dialog', { name: '☕ 休息中', exact: true }).getByRole('button', { name: '收起', exact: true }).click();
      await bar.getByRole('button', { name: '▶ 继续', exact: true }).click();
    } else await page.getByRole('button', { name: '▶ 继续计时', exact: true }).click();
    await page.getByRole('button', { name: '继续「语文 · 另一设备的新任务」计时', exact: true }).waitFor();
    // A third device change between the prompt and consent must ask about the newest target again.
    app.services.taskStudyService.start(first.id); app.services.timersService.pauseCurrent(child.id);
    await page.getByRole('button', { name: '继续「语文 · 另一设备的新任务」计时', exact: true }).click();
    await page.getByRole('button', { name: '继续「数学 · 休息前的任务」计时', exact: true }).waitFor();
    assert.equal(app.services.timersService.running(child.id), null);
    await page.getByRole('button', { name: '继续「数学 · 休息前的任务」计时', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(app.services.timersService.running(child.id).id, first.id);
    app.services.timersService.pauseCurrent(child.id);
  });

  for (const width of [390, 1180]) for (const theme of ['light', 'dark']) {
    const label = `${width}/${theme}`;
    await check(`K10 open homework family midnight ${label}`, async () => {
      const page = await open('parent', width, theme);
      await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '➕ 记作业', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '📒 记作业', exact: true });
      await dialog.getByLabel('作业内容').fill('跨日仍保留的内容');
      await dialog.getByLabel('布置日期').fill(shiftDate(today, -1));
      await dialog.getByLabel('截止日期', { exact: true }).fill(today);
      now = midnight + 61000;
      await page.clock.runFor(61000);
      assert.equal(await dialog.getByLabel('布置日期').getAttribute('max'), shiftDate(today, 1));
      assert.equal(await dialog.getByLabel('布置日期').inputValue(), shiftDate(today, -1), 'manual date is retained');
      assert.equal(await dialog.getByLabel('截止日期', { exact: true }).inputValue(), today);
      assert.equal(await dialog.getByLabel('作业内容').inputValue(), '跨日仍保留的内容');
      const lastLesson = dialog.getByRole('button', { name: /^上次课/ });
      await lastLesson.waitFor();
      assert.ok((await lastLesson.boundingBox()).height >= 44, 'last lesson shortcut has a 44px target');
      assert.equal(await dialog.getByRole('checkbox', { name: /生成打卡任务/ }).isDisabled(), true, 'eligibility follows the family day');
      await dialog.getByRole('button', { name: '今天', exact: true }).click();
      assert.equal(await dialog.getByLabel('布置日期').inputValue(), shiftDate(today, 1));
    });
    await check(`K13 homework date touch targets ${label}`, async () => {
      const page = await open('parent', width, theme);
      await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '➕ 记作业', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '📒 记作业', exact: true });
      await dialog.getByLabel('截止日期', { exact: true }).fill(shiftDate(today, 5));
      const targets = dialog.locator('input[type=date], button').filter({ visible: true });
      for (const control of await targets.all()) {
        const box = await control.boundingBox();
        assert.ok(box.height >= 44 && box.width >= 44, `${await control.textContent() || await control.getAttribute('id')}: ${JSON.stringify(box)}`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await snapshot(page, `homework-${width}-${theme}`);
    });
  }

  for (const kind of ['progress', 'backfill', 'redemption']) await check(`K11 lost response and reload ${kind}`, async () => {
    const goal = kind === 'redemption' ? null : await api('POST', `/children/${child.id}/goals`, { title: `原请求-${kind}`, subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: kind === 'progress' ? 1 : 100, unit: '页', points: 1, start_date: shiftDate(today, -10), track_time: kind === 'progress', expected_minutes: kind === 'progress' ? 2 : null });
    const item = kind === 'redemption' ? await api('POST', '/reward-items', { title: '原兑换', cost: 1, icon_emoji: '🎁' }) : null;
    if (kind === 'redemption') db.prepare('INSERT INTO point_logs (id, child_id, points, earned_at) VALUES (?, ?, ?, ?)').run('synthetic-redemption-points', child.id, 100, new Date().toISOString());
    const page = await open(kind === 'backfill' ? 'parent' : 'child');
    const url = kind === 'redemption' ? `**/api/children/${child.id}/redemptions` : `**/api/period-tasks/${goal.id}/logs`;
    const bodies = [];
    let lose = true;
    await page.route(url, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      bodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      assert.ok(response.status() < 300, await response.text());
      if (lose) await route.abort(); else await route.fulfill({ response });
    });
    if (kind === 'progress') {
      await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      await page.locator(`[data-timer-id="${goal.id}"]`).getByRole('button', { name: '记录今天的进度' }).click();
      await page.getByRole('dialog', { name: '⏱ 用了多久？', exact: true }).getByRole('button', { name: '完成', exact: true }).click();
    } else if (kind === 'backfill') {
      await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
      const card = page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) });
      await card.getByRole('button', { name: '补记进度', exact: true }).click();
      const form = page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) });
      await form.locator('input[type=number]').fill('3');
      await form.locator('input[type=date]').fill(shiftDate(today, -2));
      await form.getByRole('button', { name: '补记', exact: true }).click();
    } else {
      await page.goto(`${base}/child/${child.id}/rewards`, { waitUntil: 'networkidle' });
      const card = page.locator('div.rounded-2xl.border.p-4').filter({ has: page.getByText(item.title, { exact: true }) });
      await card.getByRole('button', { name: '兑换', exact: true }).click();
      await card.getByRole('button', { name: '确定兑换？', exact: true }).click();
    }
    await page.getByRole('alert').filter({ hasText: '无法连接服务器' }).first().waitFor();
    const before = await pending(page);
    assert.equal(before.length, 1, 'entire uncertain request is persisted');
    assert.equal(before[0].child_id, child.id);
    assert.equal(before[0].task_id, goal?.id || item.id);
    assert.deepEqual({ ...before[0].payload, request_id: before[0].request_id }, bodies[0]);
    if (kind === 'progress') assert.equal(before[0].payload.duration_seconds, 120);
    assert.equal(await page.getByRole('button', { name: '刷新重试', exact: true }).count(), 0);
    assert.ok(!(await page.getByRole('alert').first().textContent()).includes('刷新重试'));
    if (kind === 'backfill') {
      await page.goto(`${base}/parent/login`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByRole('complementary', { name: '待确认请求' }).count(), 0, 'auth pages do not show pending child data');
      assert.deepEqual(await pending(page), before);
      await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
    }
    await page.reload({ waitUntil: 'networkidle' });
    const recovery = page.getByRole('complementary', { name: '待确认请求' });
    await recovery.getByText(new RegExp(goal?.title || item.title)).waitFor();
    assert.deepEqual(await pending(page), before);
    // Another lost response must still retain it. The successful third request finally clears it.
    await recovery.getByRole('button', { name: '确认这次操作', exact: true }).click();
    await recovery.getByRole('alert').waitFor();
    assert.deepEqual(await pending(page), before);
    lose = false;
    await recovery.getByRole('button', { name: '确认这次操作', exact: true }).click();
    await recovery.waitFor({ state: 'detached' });
    assert.equal((await pending(page)).length, 0);
    assert.equal(bodies.length, 3);
    for (const body of bodies) assert.deepEqual(body, bodies[0], 'all retries use the exact original body and id');
    if (goal) {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM point_logs WHERE period_log_id=?').get(bodies[0].request_id).n, 1);
    } else assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reward_redemptions WHERE reward_id=? AND child_id=?').get(item.id, child.id).n, 1);
  });

  for (const [width, theme] of [[390, 'light'], [1180, 'dark']]) {
    for (const setting of ['error', 'size', 'upload']) await check(`settings ${setting} ${width}/${theme}`, async () => {
      const page = await open('parent', width, theme);
      await page.route('**/api/backups', async route => {
        if (route.request().method() === 'POST') return route.fulfill({ status: 503, json: { error: '合成备份失败' } });
        return route.fulfill({ json: { backups: [{ name: 'tiny.gz', created_at: `${today}T00:00:00Z`, size: 2048 }, { name: 'large.gz', created_at: `${today}T00:00:00Z`, size: 2097152 }], interval_hours: 0, retention: 7, missing_photos: { count: 1, sample: ['missing.webp'] } } });
      });
      await page.goto(`${base}/parent/settings`, { waitUntil: 'networkidle' });
      if (setting === 'error') {
        await page.getByRole('button', { name: '立即创建备份', exact: true }).click();
        await page.getByRole('button', { name: '立即创建备份', exact: true }).waitFor();
        await page.getByText('合成备份失败', { exact: true }).first().waitFor();
        assert.equal(await page.getByRole('status').filter({ hasText: '合成备份失败' }).count(), 0, 'failure is not a green status');
        const message = page.getByRole('alert').filter({ hasText: '合成备份失败' }).first();
        await message.waitFor();
        assert.match(await message.getAttribute('class'), /rose/);
      } else if (setting === 'size') {
        assert.ok((await page.locator('main').textContent()).includes('2.0 KB'), 'small backup uses KB');
        assert.ok((await page.locator('main').textContent()).includes('2.0 MiB'));
      } else {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route('**/api/backups/photos/import', async route => { await gate; await route.fulfill({ json: { imported: 1, present: 0, unused: 0, missing: 0 } }); });
        await page.locator('input[accept*=tar]').setInputFiles({ name: 'synthetic.tar', mimeType: 'application/x-tar', buffer: Buffer.alloc(1024 * 1024) });
        try {
          await page.getByRole('button', { name: '上传照片包', exact: true }).click();
          const progress = page.getByRole('progressbar', { name: '照片包上传进度' });
          await progress.waitFor();
          assert.equal(await page.getByRole('button', { name: '上传照片包', exact: true }).isDisabled(), true);
          assert.equal(await progress.getAttribute('max'), '100');
          await progress.scrollIntoViewIfNeeded();
          await snapshot(page, `upload-${width}-${theme}`);
        } finally { release(); }
        await page.getByRole('status').filter({ hasText: '已补齐 1 张照片' }).waitFor();
        assert.equal(await page.getByRole('progressbar').count(), 0);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }
  const passed = results.filter(r => r.passed).length;
  console.log(`RESULT ${passed} passed, ${results.length - passed} failed`);
  if (results.some(r => !r.passed)) process.exitCode = 1;
}
main().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
