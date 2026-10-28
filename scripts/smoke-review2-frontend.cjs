// Build first. Regression cases from the frontend review: real isolated API/data, lost HTTP
// responses, concurrent devices, family midnight, and phone/tablet in both themes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');
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
  page.setDefaultTimeout(15000);
  page.on('pageerror', err => { throw err; });
  // Start before the pause target so a busy CI worker cannot advance past it between calls.
  await page.clock.install({ time: new RealDate(now - 60000) });
  await page.clock.pauseAt(new RealDate(now));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return page;
}
async function check(name, fn) {
  if (process.env.REGRESSION_FILTER && !process.env.REGRESSION_FILTER.split(',').some(part => name.includes(part))) return;
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (err) {
    results.push({ name, passed: false, error: err.message }); console.error('FAIL', name, err);
    await reportBrowserFailure(name, err, currentContext);
  }
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
    slots: ['数学', '美', '体'].map((subject, i) => ({ id: `s${i + 1}`, kind: 'class', label: subject, start_time: `0${8 + i}:00`.slice(-5), end_time: `0${8 + i}:40`.slice(-5) })),
    lessons: [0, 1, 2, 3, 4, 5, 6].flatMap(weekday => ['数学', '美', '体'].map((subject, i) => ({ slot_id: `s${i + 1}`, weekday, subject }))) });
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

  await check('K7 fee revision survives same-clock changes and clearing', async () => {
    const cls = await api('POST', '/outside-classes', { title: '独立版本钢琴', start_date: shiftDate(today, -2), days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00', total_lessons: 5 });
    const page = await open('parent', 1180, 'light');
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    const card = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(cls.title, { exact: true }) });
    await card.getByRole('button', { name: '出勤与学费', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${child.name} · ${cls.title}`, exact: true });
    const fee = dialog.locator('#class-fee');
    await fee.fill('150');
    // Same server millisecond, value returns to null, but the initial null version is stale.
    await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: 20000 });
    await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: null });
    let response = page.waitForResponse(r => r.url().endsWith('/fee') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: '保存学费', exact: true }).click();
    let saved = await response;
    assert.equal(saved.status(), 409);
    assert.equal(saved.request().postDataJSON().expected_revision, null);
    assert.equal(await fee.inputValue(), '150');
    await dialog.getByRole('button', { name: '已看过最新金额，保留输入继续修改' }).click();
    response = page.waitForResponse(r => r.url().endsWith('/fee') && r.request().method() === 'PUT');
    await dialog.getByRole('button', { name: '保存学费', exact: true }).click();
    saved = await response; assert.equal(saved.status(), 200);
    assert.ok(saved.request().postDataJSON().expected_revision, 'fee clear retains a non-null revision');
    await dialog.getByText('总学费 ¥150.00', { exact: true }).waitFor();
  });

  await check('K7 attendance revision survives same-clock changes and clearing', async () => {
    const cls = await api('POST', '/outside-classes', { title: '出勤版本钢琴', start_date: shiftDate(today, -2), days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00', total_lessons: 5 });
    const page = await open('parent', 1180, 'light');
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    const card = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(cls.title, { exact: true }) });
    await card.getByRole('button', { name: '出勤与学费', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${child.name} · ${cls.title}`, exact: true });
    const lessonDate = shiftDate(today, -1);
    const row = dialog.locator(`[data-lesson-date="${lessonDate}"]`);
    await row.getByRole('button', { name: '记录出勤', exact: true }).click();
    await row.getByLabel('出勤备注').fill('保留的出勤草稿');
    await api('PUT', `/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: lessonDate, status: 'leave', charged: false });
    await api('PUT', `/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: lessonDate, status: 'pending' });
    let response = page.waitForResponse(r => r.url().endsWith('/attendance') && r.request().method() === 'PUT');
    await row.getByRole('button', { name: '保存出勤', exact: true }).click();
    let saved = await response; assert.equal(saved.status(), 409);
    assert.equal(saved.request().postDataJSON().expected_revision, null);
    assert.equal(await row.getByLabel('出勤备注').inputValue(), '保留的出勤草稿');
    // Conflict reload shows the current record and adopts its tombstone for an explicit retry.
    await dialog.getByRole('alert').waitFor();
    await page.waitForFunction(() => !document.querySelector('[role=dialog] button[type=submit]:disabled'));
    response = page.waitForResponse(r => r.url().endsWith('/attendance') && r.request().method() === 'PUT');
    await row.getByRole('button', { name: '保存出勤', exact: true }).click();
    saved = await response; assert.equal(saved.status(), 200);
    assert.ok(saved.request().postDataJSON().expected_revision, 'attendance clear retains a non-null revision');
    await row.getByText('保留的出勤草稿', { exact: true }).waitFor();
  });

  for (const viaBar of [false, true]) await check(`K9 changed rest target ${viaBar ? 'via bar' : 'at rest end'}`, async () => {
    const first = app.services.tasksService.createAdhocTask(child.id, { title: '休息前的任务', subject: '数学', track_time: true });
    app.services.taskStudyService.start(first.id);
    const page = await open('child', viaBar ? 1180 : 390, viaBar ? 'light' : 'dark');
    await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
    const bar = page.getByRole('region', { name: /正在计时|计时已暂停/ }).filter({ visible: true });
    await bar.getByRole('button', { name: '休息一下', exact: true }).click();
    await page.getByRole('dialog', { name: '☕ 休息一下', exact: true }).getByRole('button', { name: '5 分钟', exact: true }).click();
    // Choosing a rest awaits the server pause before it writes localStorage.
    await page.getByRole('dialog', { name: '☕ 休息中', exact: true }).waitFor();
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
      // Single-character subjects and explicit CSS minima work even without CJK fonts.
      for (const subject of ['数学', '美', '体']) {
        const option = dialog.getByRole('button', { name: subject, exact: true });
        await option.click();
        const size = await option.evaluate(el => ({ min: parseFloat(getComputedStyle(el).minWidth), width: el.getBoundingClientRect().width }));
        assert.ok(size.min >= 44 && size.width >= 44, `${subject}: ${JSON.stringify(size)}`);
      }
      await dialog.getByLabel('截止日期', { exact: true }).fill(shiftDate(today, 5));
      await dialog.getByRole('checkbox', { name: /生成打卡任务/ }).check();
      await dialog.getByRole('checkbox', { name: /记录用时/ }).check();
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
    // The panel also hides while a retry is in flight; wait for confirmed success first.
    await page.getByRole('status').getByText('操作已确认。', { exact: true }).waitFor();
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
        return route.fulfill({ json: { backups: [{ name: 'tiny.gz', created_at: `${today}T00:00:00Z`, size: 2048 }, { name: 'large.gz', created_at: `${today}T00:00:00Z`, size: 2097152 }], interval_hours: 0, retention: 7,
          photo_export: { last_complete_at: null, exported_count: 0, pending_count: 1 },
          missing_photos: { count: 1, absent: 1, mismatch: 0, sample: [{ name: 'missing.webp', subject: '数学', description: '合成错题', created_at: `${today}T00:00:00Z`, reason: 'absent' }] } } });
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
        await page.getByRole('status').filter({ hasText: '已补齐或修复 1 张照片' }).waitFor();
        assert.equal(await page.getByRole('progressbar').count(), 0);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    });
  }


  for (const [width, theme] of [[390, 'light'], [1180, 'dark']]) await check(`N1 related option minimum sizes ${width}/${theme}`, async () => {
    const page = await open('parent', width, theme);
    const assertSize = async control => {
      const size = await control.evaluate(el => ({ min: parseFloat(getComputedStyle(el).minWidth), minH: parseFloat(getComputedStyle(el).minHeight), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
      assert.ok(size.min >= 44 && size.minH >= 44 && size.width >= 44 && size.height >= 44, `${await control.textContent()}: ${JSON.stringify(size)}`);
    };
    await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
    await assertSize(page.getByRole('button', { name: '美', exact: true }));
    await assertSize(page.getByRole('button', { name: '体', exact: true }));
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: '➕ 新增课外班', exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (const name of ['周一', '周日', child.name]) await assertSize(dialog.getByRole('button', { name: new RegExp(name) }));
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '✏️ 编辑', exact: true }).click();
    await page.locator('form').filter({ has: page.getByRole('heading', { name: '🏫 编辑课程表', exact: true }) }).locator('td button').first().click();
    const chooser = page.locator('form').filter({ has: page.getByRole('heading', { name: /周.*（/ }) });
    await assertSize(chooser.getByRole('button', { name: '美术', exact: true }));
    await assertSize(chooser.getByRole('button', { name: '体育', exact: true }));
  });

  for (const kind of ['progress', 'backfill']) await check(`N2 edited uncertain ${kind} cannot create another record`, async () => {
    const goal = await api('POST', `/children/${child.id}/goals`, { title: `修改失败表单-${kind}`, subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: 100, unit: '页', points: 1, start_date: shiftDate(today, -10), track_time: kind === 'progress', expected_minutes: kind === 'progress' ? 2 : null });
    const page = await open(kind === 'backfill' ? 'parent' : 'child');
    const bodies = []; let lose = true;
    await page.route(`**/api/period-tasks/${goal.id}/logs`, async route => {
      bodies.push(route.request().postDataJSON()); const response = await route.fetch();
      if (lose) await route.abort(); else await route.fulfill({ response });
    });
    await page.goto(kind === 'backfill' ? `${base}/parent/periods` : `${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
    let form, submit;
    if (kind === 'progress') {
      await page.locator(`[data-timer-id="${goal.id}"]`).getByRole('button', { name: '记录今天的进度' }).click();
      form = page.getByRole('dialog', { name: '⏱ 用了多久？', exact: true });
      submit = form.getByRole('button', { name: '完成', exact: true });
    } else {
      await page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) }).getByRole('button', { name: '补记进度', exact: true }).click();
      form = page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) });
      submit = form.getByRole('button', { name: '补记', exact: true });
    }
    await submit.click();
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
    await form.locator('input[type=number]').fill('3');
    if (kind === 'backfill') await form.locator('input[type=date]').fill(shiftDate(today, -2));
    await submit.click();
    await page.getByText(/请先.*待确认请求/).first().waitFor();
    assert.equal(bodies.length, 1, 'edited draft is blocked before HTTP');
    assert.equal((await pending(page)).length, 1);
    lose = false;
    const opened = currentContext.waitForEvent('page');
    await page.evaluate(url => window.open(url, '_blank'), page.url());
    const other = await opened; await other.waitForLoadState('networkidle');
    await other.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click();
    await other.getByRole('status').getByText('操作已确认。', { exact: true }).waitFor();
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor({ state: 'detached' });
    // The still-open failed form remains the old operation, even after another UI confirms it.
    await submit.click();
    await page.getByText(/原操作已确认/).first().waitFor();
    assert.equal(bodies.length, 1, 'stale form does not create a new request after confirmation');
    const rows = db.prepare('SELECT * FROM period_task_logs WHERE period_task_id=?').all(goal.id);
    assert.equal(rows.length, 1); assert.equal(rows[0].amount, 1);
    if (kind === 'progress') {
      assert.equal(rows[0].duration_seconds, 120);
      await form.getByRole('button', { name: '取消', exact: true }).click();
      await page.locator(`[data-timer-id="${goal.id}"]`).getByRole('button', { name: '⏱ 2 分钟', exact: true }).click();
      const correction = page.getByRole('dialog', { name: '⏱ 修改用时', exact: true });
      await correction.locator('input[type=number]').fill('3');
      await correction.getByRole('button', { name: '保存', exact: true }).click();
      await correction.waitFor({ state: 'detached' });
      const corrected = db.prepare('SELECT * FROM period_task_logs WHERE period_task_id=?').all(goal.id);
      assert.equal(corrected.length, 1); assert.equal(corrected[0].duration_seconds, 180);
    }
    assert.equal(db.prepare('SELECT SUM(points) AS n FROM point_logs WHERE period_log_id=?').get(rows[0].id).n, 1);
  });

  for (const kind of ['progress', 'backfill', 'redemption']) await check(`N3 copied tab confirms ${kind} and identical new action gets a fresh id`, async () => {
    const goal = kind === 'redemption' ? null : await api('POST', `/children/${child.id}/goals`, { title: `跨页确认-${kind}`, subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: 100, unit: '页', points: 1, start_date: shiftDate(today, -10) });
    const item = kind === 'redemption' ? await api('POST', '/reward-items', { title: '跨页兑换', cost: 1, icon_emoji: '🎁' }) : null;
    if (item) db.prepare('INSERT INTO point_logs (id, child_id, points, earned_at) VALUES (?, ?, ?, ?)').run('n3-points', child.id, 100, new Date().toISOString());
    const page = await open(kind === 'backfill' ? 'parent' : 'child');
    const target = goal ? `**/api/period-tasks/${goal.id}/logs` : `**/api/children/${child.id}/redemptions`;
    const bodies = []; let lose = true;
    await page.route(target, async route => {
      bodies.push(route.request().postDataJSON()); const response = await route.fetch();
      if (lose) await route.abort(); else await route.fulfill({ response });
    });
    const url = kind === 'backfill' ? `${base}/parent/periods` : `${base}/child/${child.id}/${goal ? 'today' : 'rewards'}`;
    await page.goto(url, { waitUntil: 'networkidle' });
    const perform = async () => {
      if (kind === 'progress') await page.locator(`[data-timer-id="${goal.id}"]`).getByRole('button', { name: '记录今天的进度' }).click();
      else if (kind === 'backfill') {
        await page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) }).getByRole('button', { name: '补记进度', exact: true }).click();
        await page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) }).getByRole('button', { name: '补记', exact: true }).click();
      } else {
        const card = page.locator('div.rounded-2xl.border.p-4').filter({ has: page.getByText(item.title, { exact: true }) });
        await card.getByRole('button', { name: '兑换', exact: true }).click();
        await card.getByRole('button', { name: '确定兑换？', exact: true }).click();
      }
    };
    await perform(); await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
    const first = (await pending(page))[0];
    const opened = currentContext.waitForEvent('page');
    await page.evaluate(url => window.open(url, '_blank'), url);
    const other = await opened; await other.waitForLoadState('networkidle');
    assert.equal((await pending(other))[0].request_id, first.request_id, 'native session copy');
    await other.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click();
    await other.getByRole('status').getByText('操作已确认。', { exact: true }).waitFor();
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor({ state: 'detached' });
    assert.equal((await pending(page)).length, 0, 'storage event clears original tab without reload');
    // Simulate a suspended tab missing the event but restoring an old session snapshot.
    await page.evaluate(entry => sessionStorage.setItem(`taskie_pending_write_v1:${entry.request_id}`, JSON.stringify(entry)), first);
    lose = false; await page.reload({ waitUntil: 'networkidle' });
    assert.equal((await pending(page)).length, 0, 'durable confirmation reconciles a missed event');
    await perform();
    await page.waitForFunction(() => !Object.keys(sessionStorage).some(k => k.startsWith('taskie_pending_write_v1:')));
    assert.equal(bodies.length, 2); assert.notEqual(bodies[1].request_id, first.request_id);
    const rows = goal ? db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n : db.prepare('SELECT COUNT(*) AS n FROM reward_redemptions WHERE reward_id=?').get(item.id).n;
    assert.equal(rows, 2, 'both intentional operations are recorded');
  });

  for (const outcome of ['success', 'error']) await check(`N4 obsolete opening ${outcome} cannot change fee draft or revision`, async () => {
    const cls = await api('POST', '/outside-classes', { title: `异步打开-${outcome}`, start_date: shiftDate(today, -2), days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00', total_lessons: 5 });
    await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: 10000 });
    const page = await open('parent');
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    let release, fetched, finished;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { fetched = resolve; });
    const done = new Promise(resolve => { finished = resolve; });
    let count = 0;
    await page.route(`**/api/outside-classes/${cls.id}/stats?**`, async route => {
      const response = await route.fetch();
      if (++count === 1) {
        fetched(); await gate;
        if (outcome === 'error') await route.fulfill({ status: 503, json: { error: '旧打开失败' } });
        else await route.fulfill({ response });
        finished();
      } else await route.fulfill({ response });
    });
    try {
      const opener = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(cls.title, { exact: true }) }).getByRole('button', { name: '出勤与学费', exact: true });
      await opener.click(); await ready;
      const dialog = page.getByRole('dialog', { name: `${child.name} · ${cls.title}`, exact: true });
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: 20000 });
      await opener.click(); await dialog.locator('#class-fee').fill('150');
      const currentRevision = db.prepare("SELECT revision FROM outside_class_revisions WHERE class_id=? AND child_id=? AND kind='fee'").get(cls.id, child.id).revision;
      release(); await done;
      await page.waitForLoadState('networkidle');
      assert.equal(await dialog.locator('#class-fee').inputValue(), '150');
      assert.equal(await dialog.getByRole('alert').count(), 0, 'obsolete error is not written into current dialog');
      const sent = page.waitForResponse(r => r.url().endsWith('/fee') && r.request().method() === 'PUT');
      await dialog.getByRole('button', { name: '保存学费', exact: true }).click();
      const response = await sent;
      assert.equal(response.request().postDataJSON().expected_revision, currentRevision);
      assert.equal(response.status(), 200);
    } finally { release(); }
  });

  for (const width of [390, 1180]) for (const theme of ['light', 'dark']) await check(`R1 skipped export photos ${width}/${theme}`, async () => {
    const page = await open('parent', width, theme);
    const skipped = [ { name: 'bad.webp', subject: '美', description: '坏照片题目', created_at: `${today}T00:00:00Z`, reason: 'mismatch' }, { name: 'gone.webp', subject: '数学', description: '缺照片题目', created_at: `${today}T00:00:00Z`, reason: 'absent' } ];
    await page.route('**/api/backups/photos/export-ticket', route => route.fulfill({ json: { url: '/api/test-photo-download', included_count: 2, skipped } }));
    await page.route('**/api/test-photo-download', route => route.fulfill({ body: Buffer.alloc(1024), headers: { 'Content-Disposition': 'attachment; filename="test.tar"' } }));
    await page.goto(`${base}/parent/settings`, { waitUntil: 'networkidle' });
    const warning = page.getByRole('alert').filter({ hasText: '本次导出跳过' });
    assert.equal(await warning.count(), 0);
    for (const name of ['下载全部照片', '下载新照片']) {
      await page.getByRole('button', { name, exact: true }).click();
      await warning.waitFor();
      assert.equal(await page.locator('input[accept*=tar]').isVisible(), true, 'backup-only skipped photos also have a repair upload entry');
      assert.match(await warning.textContent(), /美 · 2026-10-22 · 坏照片题目.*校验不一致/s);
      assert.match(await warning.textContent(), /数学 · 2026-10-22 · 缺照片题目.*不存在/s);
      assert.match(await warning.textContent(), /上传.*正确.*照片包/);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.route('**/api/backups/photos/export-ticket', route => route.fulfill({ json: { url: '/api/test-photo-download', included_count: 4, skipped: [] } }));
    await page.getByRole('button', { name: '下载全部照片', exact: true }).click();
    await warning.waitFor({ state: 'detached' });
    assert.equal(await page.locator('input[accept*=tar]').count(), 0, 'no skipped or missing photos means no repair entry');
  });

  await check('B-F1 evicted receipt replays the same request without duplicate rewards', async () => {
    const item = await api('POST', '/reward-items', { title: '回执淘汰重试', cost: 1, icon_emoji: '🎁' });
    db.prepare('INSERT INTO point_logs (id, child_id, points, earned_at) VALUES (?, ?, ?, ?)').run('b-f1-points', child.id, 100, new Date().toISOString());
    const page = await open('child');
    await page.route(`**/api/children/${child.id}/redemptions`, async route => {
      await route.fetch(); await route.abort();
    });
    await page.goto(`${base}/child/${child.id}/rewards`, { waitUntil: 'networkidle' });
    const card = page.locator('div.rounded-2xl.border.p-4').filter({ has: page.getByText(item.title, { exact: true }) });
    await card.getByRole('button', { name: '兑换', exact: true }).click();
    await card.getByRole('button', { name: '确定兑换？', exact: true }).click();
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
    const first = (await pending(page))[0];
    await page.unroute(`**/api/children/${child.id}/redemptions`);
    // Receipt has expired/been evicted in a copied or suspended tab, but its pending
    // operation remains. The server must still see the original id and exact body.
    await page.evaluate(id => localStorage.removeItem(`taskie_confirmed_write_v1:${id}`), first.request_id);
    const request = page.waitForRequest(r => r.url().endsWith('/redemptions') && r.method() === 'POST');
    await page.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click();
    assert.equal((await request).postDataJSON().request_id, first.request_id);
    await page.getByRole('status').getByText('操作已确认。', { exact: true }).waitFor();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reward_redemptions WHERE reward_id=?').get(item.id).n, 1);
  });

  await check('B-F2 parent browsing another child preserves the original pending request', async () => {
    const other = await api('POST', '/children', { name: '家长浏览的另一个孩子' });
    const goal = await api('POST', `/children/${child.id}/goals`, { title: '跨孩子保留补记', subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: 100, unit: '页', points: 1, start_date: shiftDate(today, -10) });
    const page = await open('parent');
    const target = `**/api/period-tasks/${goal.id}/logs`;
    const bodies = []; let lose = true;
    await page.route(target, async route => {
      bodies.push(route.request().postDataJSON());
      if (lose) await route.abort(); else await route.continue();
    });
    await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
    await page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) }).getByRole('button', { name: '补记进度', exact: true }).click();
    await page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) }).getByRole('button', { name: '补记', exact: true }).click();
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
    const first = (await pending(page))[0];
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 0);
    await page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
    await page.locator(`a[href="/child/${other.id}/today"]`).first().click();
    await page.waitForFunction(id => JSON.parse(sessionStorage.getItem('current_child'))?.id === id, other.id);
    assert.deepEqual(await pending(page), [first], 'viewing B must preserve the parent request for A');
    await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
    lose = false;
    await page.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click();
    await page.getByRole('status').getByText('操作已确认。', { exact: true }).waitFor();
    assert.deepEqual(bodies[1], bodies[0], 'the retry must preserve the original id and payload');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 1);
    assert.deepEqual(await pending(page), []);
  });

  await check('B-F2 logout and switching children remove local pending request details', async () => {
    const other = await api('POST', '/children', { name: '切换后孩子' });
    const page = await open('parent');
    await page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
    const seed = async role => page.evaluate(({ role, child }) => {
      sessionStorage.setItem('taskie_pending_write_v1:private-old-request', JSON.stringify({ request_id: 'private-old-request', role, kind: 'progress', child_id: child.id, task_id: 'private-task', child_name: '旧会话私密姓名', title: '旧会话私密内容', payload: { amount: 1 } }));
      window.dispatchEvent(new Event('taskie:pending-writes'));
    }, { role, child });
    await seed('parent');
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
    await page.getByRole('button', { name: '打开家长设置菜单' }).click();
    await page.getByRole('button', { name: '退出家长，返回孩子选择' }).click();
    await page.waitForURL(base + '/');
    assert.deepEqual(await pending(page), []);
    // Another old child request on this device must be removed by the actual login flow.
    await seed('child');
    await page.getByText(other.name, { exact: true }).click();
    await page.waitForURL(`**/child/${other.id}/today`);
    assert.deepEqual(await pending(page), []);
    assert.equal(await page.getByText('旧会话私密内容', { exact: false }).count(), 0);
  });


  await check('I1 lost progress survives 401 and same child login, replaying the original id once', async () => {
    const goal = await api('POST', `/children/${child.id}/goals`, { title: '会话过期保留进度', subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: 100, unit: '页', points: 1, start_date: shiftDate(today, -10) });
    const page = await open('child');
    const bodies = []; let lose = true;
    await page.route(`**/api/period-tasks/${goal.id}/logs`, async route => {
      bodies.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (lose) await route.abort(); else await route.fulfill({ response });
    });
    await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
    await page.locator(`[data-timer-id="${goal.id}"]`).getByRole('button', { name: '记录今天的进度' }).click();
    const panel = page.getByRole('complementary', { name: '待确认请求' });
    await panel.waitFor();
    const first = (await pending(page))[0];
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 1);
    lose = false;
    await page.evaluate(expired => sessionStorage.setItem('taskie_child_token', expired), app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }, { expiresIn: -1 }));
    const rejected = page.waitForResponse(r => r.url().endsWith(`/period-tasks/${goal.id}/logs`) && r.status() === 401);
    await panel.getByRole('button', { name: '确认这次操作' }).click();
    await rejected; await page.waitForURL(base + '/');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_child_token')), null);
    assert.deepEqual(await pending(page), [first], '401 clears credentials, preserving the entire uncertain request');
    await page.getByText(child.name, { exact: true }).click();
    await page.waitForURL(`**/child/${child.id}/today`);
    await panel.waitFor();
    assert.deepEqual(await pending(page), [first]);
    await panel.getByRole('button', { name: '确认这次操作' }).click();
    await page.getByRole('status').getByText('操作已确认。', { exact: true }).waitFor();
    assert.equal(bodies.length, 3);
    assert.deepEqual(bodies[1], bodies[0]); assert.deepEqual(bodies[2], bodies[0]);
    const rows = db.prepare('SELECT * FROM period_task_logs WHERE period_task_id=?').all(goal.id);
    assert.equal(rows.length, 1);
    assert.equal(db.prepare('SELECT SUM(points) AS n FROM point_logs WHERE period_log_id=?').get(rows[0].id).n, 1);
    assert.deepEqual(await pending(page), []);
  });

  const seedIdentityRequest = async (page, role = 'parent') => {
    const entry = { request_id: 'identity-pending-request', role, kind: 'backfill', child_id: child.id, task_id: 'old-task', title: '身份保留测试', child_name: child.name, payload: { amount: 1, date: today } };
    await page.evaluate(entry => {
      sessionStorage.setItem(`taskie_pending_write_v1:${entry.request_id}`, JSON.stringify(entry));
      window.dispatchEvent(new Event('taskie:pending-writes'));
    }, entry);
    return entry;
  };
  const enterPin = async (page, pin) => { for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click(); };

  await check('I2 expired child A requests are removed when child B signs in', async () => {
    const other = await api('POST', '/children', { name: '过期后登录的孩子B' });
    const page = await open('child');
    await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
    await seedIdentityRequest(page, 'child');
    await page.evaluate(expired => sessionStorage.setItem('taskie_child_token', expired), app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }, { expiresIn: -1 }));
    await page.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click();
    await page.waitForURL(base + '/');
    assert.equal((await pending(page)).length, 1, 'retained until the next identity is known');
    await page.getByText(other.name, { exact: true }).click();
    await page.waitForURL(`**/child/${other.id}/today`);
    assert.deepEqual(await pending(page), []);
    assert.equal(await page.getByRole('complementary', { name: '待确认请求' }).count(), 0);
  });

  await check('I3 parent 401 and same parent login retain requests targeting any child', async () => {
    const page = await open('parent');
    await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
    const first = await seedIdentityRequest(page);
    await page.evaluate(expired => sessionStorage.setItem('taskie_parent_token', expired), app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: -1 }));
    await page.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click();
    await page.waitForURL('**/parent/login');
    assert.deepEqual(await pending(page), [first]);
    await enterPin(page, '1234');
    await page.waitForURL('**/parent/dashboard');
    assert.deepEqual(await pending(page), [first]);
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
  });

  for (const forced of [false, true]) await check(`I4 ${forced ? 'first-use' : 'settings'} parent PIN change retains requests after reauthentication`, async () => {
    const page = await open('parent');
    const originalPinHash = db.prepare("SELECT value FROM settings WHERE key='parent_pin_hash'").get().value;
    try {
      if (forced) db.prepare("UPDATE settings SET value='1' WHERE key='parent_pin_is_default'").run();
      await page.goto(`${base}/parent/${forced ? 'setup-pin' : 'settings'}`, { waitUntil: 'networkidle' });
      const first = await seedIdentityRequest(page);
      if (forced) {
        await enterPin(page, '1234'); await enterPin(page, '5678'); await enterPin(page, '5678');
      } else {
        const form = page.locator('form').filter({ has: page.getByRole('button', { name: '保存 PIN', exact: true }) });
        await form.locator('input[type=password]').nth(0).fill('1234');
        await form.locator('input[type=password]').nth(1).fill('5678');
        await form.getByRole('button', { name: '保存 PIN', exact: true }).click();
        await page.waitForURL('**/parent/login');
        assert.deepEqual(await pending(page), [first]);
        await enterPin(page, '5678');
      }
      await page.waitForURL('**/parent/dashboard');
      assert.deepEqual(await pending(page), [first]);
    } finally {
      // Restore only the isolated fixture's PIN. The public API deliberately forbids
      // choosing the default PIN; retain the new epoch so old tokens stay invalid.
      db.prepare("UPDATE settings SET value=? WHERE key='parent_pin_hash'").run(originalPinHash);
      token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
      db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
    }
  });

  for (const entry of ['today', 'sidebar', 'more']) await check(`I5 explicit child switch from ${entry} clears requests and credentials`, async () => {
    const page = await open('child', entry === 'sidebar' ? 1180 : 390);
    await page.goto(`${base}/child/${child.id}/${entry === 'today' ? 'today' : 'rewards'}`, { waitUntil: 'networkidle' });
    await seedIdentityRequest(page, 'child');
    if (entry === 'more') await page.getByRole('button', { name: '更多学习功能' }).click();
    await page.getByRole('link', { name: entry === 'today' ? '🔄 切换' : '切换小朋友', exact: true }).click();
    await page.waitForURL(base + '/');
    assert.deepEqual(await pending(page), []);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_child_token')), null);
  });

  for (const width of [390, 1180]) for (const theme of ['light', 'dark']) await check(`G-R1 parent to child confirmation ${width}/${theme}`, async () => {
    const page = await open('parent', width, theme);
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    const first = await seedIdentityRequest(page);
    let logins = 0;
    page.on('request', request => { if (request.url().endsWith('/auth/child-login')) logins++; });
    const parentToken = await page.evaluate(() => sessionStorage.getItem('taskie_parent_token'));
    await page.getByText(child.name, { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认操作', exact: true });
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /以孩子身份登录会退出家长，并清除家长未确认的操作。/);
    assert.match(await dialog.textContent(), /1 项/);
    assert.equal(logins, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0);
    await snapshot(page, `generation-switch-${width}-${theme}`);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.deepEqual(await pending(page), [first]);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')), parentToken);
    assert.equal(logins, 0);
    await page.getByText(child.name, { exact: true }).click();
    await dialog.getByRole('button', { name: '确认', exact: true }).click();
    await page.waitForURL(`**/child/${child.id}/today`);
    assert.equal(logins, 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')), null);
    assert.deepEqual(await pending(page), []);
  });

  await check('G-R1 parent without pending still confirms; no parent skips confirmation', async () => {
    const page = await open('parent');
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await page.getByText(child.name, { exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '确认操作', exact: true });
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /退出家长/);
    assert.doesNotMatch(await dialog.textContent(), /项家长操作/);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(() => { sessionStorage.removeItem('taskie_parent_token'); });
    await page.getByText(child.name, { exact: true }).click();
    await page.waitForURL(`**/child/${child.id}/today`);
    assert.equal(await dialog.count(), 0);
  });

  await check('G-D1 409 removes pending and closes the original backfill form', async () => {
    const goal = await api('POST', `/children/${child.id}/goals`, { title: '恢复后旧表单', subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: 100, unit: '页', points: 1, start_date: shiftDate(today, -10) });
    const page = await open('parent');
    const url = `**/api/period-tasks/${goal.id}/logs`;
    let writes = 0;
    await page.route(url, async route => {
      writes++;
      await route.fulfill({ status: 409, json: { code: 'DATA_RESTORED', error: '数据已恢复，这次操作没有执行，请核对后重新操作' } });
    });
    await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
    const card = page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) });
    await card.getByRole('button', { name: '补记进度', exact: true }).click();
    const form = page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) });
    await form.getByRole('button', { name: '补记', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '数据已恢复，这次操作没有执行，请核对后重新操作' }).first().waitFor();
    await form.waitFor({ state: 'detached' });
    assert.deepEqual(await pending(page), []);
    assert.equal(writes, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 0);
  });

  // Restore changes the complete dataset and session epoch. Run these cases last.
  await check('G-D1 two tabs: lost response, real restore, re-login discards old generation', async () => {
    const goal = await api('POST', `/children/${child.id}/goals`, { title: '跨页恢复隔离', subject: '数学', mode: 'progress', input_mode: 'increment', total_amount: 100, unit: '页', points: 1, start_date: shiftDate(today, -10) });
    const backup = await app.backupService.create();
    const page = await open('parent');
    await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
    const restorePage = await currentContext.newPage();
    await restorePage.goto(`${base}/parent/settings`, { waitUntil: 'networkidle' });
    const url = `**/api/period-tasks/${goal.id}/logs`;
    let writes = 0;
    let firstHeader;
    await page.route(url, async route => {
      writes++;
      firstHeader ||= route.request().headers()['x-taskie-data-generation'];
      if (writes === 1) { await route.fetch(); await route.abort(); }
      else await route.continue();
    });
    await page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) }).getByRole('button', { name: '补记进度', exact: true }).click();
    await page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) }).getByRole('button', { name: '补记', exact: true }).click();
    await page.getByRole('complementary', { name: '待确认请求' }).waitFor();
    const [first] = await pending(page);
    await page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) }).getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(first.data_generation, firstHeader);
    assert.equal(typeof firstHeader, 'string');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 1);
    await restorePage.locator('input[accept=".gz"]').setInputFiles(app.backupService.getPath(backup.name));
    await restorePage.getByLabel('当前家长 PIN', { exact: true }).fill('1234');
    await restorePage.getByRole('checkbox', { name: '我确认用备份替换当前数据' }).check();
    await restorePage.getByRole('button', { name: '确认恢复', exact: true }).click();
    await restorePage.waitForURL('**/parent/login');
    assert.deepEqual(await pending(page), [first], 'other tab retains the uncertain write until login');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 0);
    await Promise.all([
      page.waitForResponse(r => r.url().endsWith(`/period-tasks/${goal.id}/logs`) && r.status() === 401),
      page.getByRole('complementary', { name: '待确认请求' }).getByRole('button', { name: '确认这次操作' }).click()
    ]);
    await page.waitForURL('**/parent/login');
    assert.deepEqual(await pending(page), [first]);
    await enterPin(page, '1234');
    await page.waitForURL('**/parent/dashboard');
    assert.deepEqual(await pending(page), []);
    assert.equal(await page.getByRole('complementary', { name: '待确认请求' }).count(), 0);
    assert.equal(writes, 2, 'old write cannot be replayed after reauthentication');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM period_task_logs WHERE period_task_id=?').get(goal.id).n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM point_logs WHERE period_log_id=?').get(first.request_id).n, 0);
    assert.notEqual(await page.evaluate(() => sessionStorage.getItem('taskie_data_generation')), first.data_generation);
    token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  });

  await check('I6 failed restore preserves requests; successful backup restore clears them', async () => {
    const backup = await app.backupService.create();
    const page = await open('parent');
    await page.goto(`${base}/parent/settings`, { waitUntil: 'networkidle' });
    const first = await seedIdentityRequest(page);
    await page.locator('input[accept=".gz"]').setInputFiles(app.backupService.getPath(backup.name));
    await page.getByLabel('当前家长 PIN', { exact: true }).fill('0000');
    await page.getByRole('checkbox', { name: '我确认用备份替换当前数据' }).check();
    const rejected = page.waitForResponse(r => r.url().endsWith('/backups/restore'));
    await page.getByRole('button', { name: '确认恢复', exact: true }).click();
    assert.ok((await rejected).status() >= 400);
    assert.deepEqual(await pending(page), [first], 'a rejected restore leaves the original data and pending request intact');
    await page.getByLabel('当前家长 PIN', { exact: true }).fill('1234');
    const restored = page.waitForResponse(r => r.url().endsWith('/backups/restore'));
    await page.getByRole('button', { name: '确认恢复', exact: true }).click();
    assert.equal((await restored).status(), 200);
    await page.waitForURL('**/parent/login');
    assert.deepEqual(await pending(page), []);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_parent_token')), null);
  });

  const passed = results.filter(r => r.passed).length;
  console.log(`RESULT ${passed} passed, ${results.length - passed} failed`);
  if (results.some(r => !r.passed)) process.exitCode = 1;
}
main().catch(async err => { console.error(err); await reportBrowserFailure('frontend-recovery setup or cleanup', err, browser); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
