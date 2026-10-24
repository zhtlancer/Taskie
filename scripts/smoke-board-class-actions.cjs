// Build first. Real HTTP service, isolated SQLite, no mocked successful API responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-board-classes-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser, passed = 0, failed = 0;
const errors = [];
const today = getTodayDate(), tomorrow = shiftDate(today, 1);
const confirmation = page => page.getByRole('dialog', { name: '确认操作', exact: true });
const modalFor = page => page.getByRole('dialog', { name: '今天的课', exact: true });
const rowFor = (page, cls, source = today, actual = source) => modalFor(page).locator(`[data-class-id="${cls.id}"][data-source-date="${source}"][data-schedule-date="${actual}"]`);
async function confirm(page, name) {
  const dialog = confirmation(page);
  await dialog.getByText(new RegExp(`只对 ${name} 生效`)).waitFor();
  await dialog.getByRole('button', { name: '确认', exact: true }).click();
}
async function action(page, row, label, child, status = 200) {
  await row.getByRole('button', { name: label, exact: true }).click();
  const response = page.waitForResponse(r => ['PUT', 'DELETE'].includes(r.request().method()) && /outside-class/.test(r.url()));
  await confirm(page, child.name);
  const result = await response;
  assert.equal(result.status(), status, await result.text());
  await modalFor(page).getByRole('button', { name: '关闭', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[role=dialog][aria-modal=true] button[aria-label="关闭"]')?.disabled);
  return result.request().postDataJSON();
}
async function layout(page, modal) {
  await modal.locator('button').last().scrollIntoViewIfNeeded();
  assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'dialog must fit the viewport');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const small = await modal.locator('button:visible').evaluateAll(nodes => nodes.filter(el => {
    const box = el.getBoundingClientRect(); return box.height < 43.9 || box.width < 43.9;
  }).map(el => el.textContent));
  assert.deepEqual(small, [], '44px touch targets');
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  await modal.getByRole('button', { name: '关闭', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await modal.evaluate(el => el.contains(document.activeElement)), true, 'focus stays inside dialog');
}
async function openMove(page, row, date) {
  await row.getByRole('button', { name: '调课', exact: true }).click();
  const form = page.getByRole('dialog', { name: '调整这节课', exact: true });
  assert.equal(await form.getByLabel('开始时间').inputValue(), '16:00');
  assert.equal(await form.getByLabel('结束时间').inputValue(), '17:00');
  assert.ok((await form.getByRole('link', { name: '更多设置 →' }).getAttribute('href')).includes('/parent/schedule?child='));
  await form.getByLabel('新日期').fill(date);
  await form.getByLabel('开始时间').fill('18:00');
  await form.getByLabel('结束时间').fill('19:00');
  await form.getByRole('button', { name: '确认调课', exact: true }).click();
  return form;
}
// Each regression gets fresh children, classes and browser sessions. Successful writes
// always hit the listening Fastify service; only explicit transport/500 failures are injected.
async function regressions(base, token, api) {
  async function scenario(name, body) {
    if (process.env.BOARD_CLASS_CASE && !name.startsWith(process.env.BOARD_CLASS_CASE)) return;
    const contexts = [];
    const child = await api('POST', '/children', { name: `回归-${name}` });
    const cls = await api('POST', '/outside-classes', { title: `钢琴-${name}`.slice(0, 20), child_ids: [child.id],
      start_date: shiftDate(today, -40), days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00',
      total_lessons: 100, bring: '回归乐谱', create_task: true });
    async function board(options = {}) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
      contexts.push(context);
      await context.addInitScript(({ token, child }) => {
        sessionStorage.setItem('taskie_parent_token', token);
        sessionStorage.setItem('current_child', JSON.stringify(child));
      }, { token, child });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on('pageerror', error => errors.push(error.message));
      return page;
    }
    async function open(page) {
      await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      await page.locator('button[title="今天的课"]').click();
    }
    async function move(page, row, start = '18:00', end = '19:00', status = 200) {
      await row.getByRole('button', { name: '调课', exact: true }).click();
      const form = page.getByRole('dialog', { name: '调整这节课', exact: true });
      await form.getByLabel('开始时间').fill(start); await form.getByLabel('结束时间').fill(end);
      await form.getByRole('button', { name: '确认调课', exact: true }).click();
      const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
      await confirm(page, child.name); assert.equal((await response).status(), status);
      await form.waitFor({ state: 'detached' });
    }
    try {
      await body({ child, cls, board, open, move });
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failed++; console.error(`FAIL ${name}:`, error); }
    finally { for (const context of contexts) await context.close(); }
  }
  for (const fault of ['stats', 'schedule', 'classes', 'pending']) await scenario(`D4-${fault}`, async ({ child, cls, board }) => {
    const original = await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: tomorrow,
      kind: 'moved', new_date: tomorrow, new_start_time: '18:00', new_end_time: '19:00' });
    const oldId = original.exceptions.find(e => e.date === tomorrow).id;
    const width = ['schedule', 'pending'].includes(fault) ? 1180 : 390;
    const page = await board({ viewport: { width, height: 844 }, colorScheme: ['schedule', 'classes'].includes(fault) ? 'dark' : 'light' });
    page.setDefaultTimeout(10000);
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    const card = page.locator(`[data-class-id="${cls.id}"]`);
    const lesson = card.locator(`button[data-source-date="${tomorrow}"]`);
    const form = page.getByRole('dialog', { name: new RegExp(cls.title) });
    await lesson.click();
    await form.locator('input[type=time]').first().fill('20:00');
    await form.locator('input[type=time]').last().fill('21:00');
    // A slow read proves the write response updates the visible lesson before refreshing.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let holdReads = true;
    let broken = true;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET') {
        if (fault === 'pending' && holdReads && (url.pathname.endsWith('/schedule') || url.pathname === '/api/outside-classes')) {
          await gate;
          return route.continue();
        }
        if (url.pathname.endsWith('/stats') || (broken && ((fault === 'schedule' && url.pathname.endsWith('/schedule')) ||
            (fault === 'classes' && url.pathname === '/api/outside-classes')))) {
          return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"刷新故障"}' });
        }
      }
      return route.continue();
    });
    async function saveException() {
      const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
      await form.getByRole('button', { name: '保存', exact: true }).click();
      const saved = await response; assert.equal(saved.status(), 200);
      await form.waitFor({ state: 'detached' });
      return (await saved.json()).exceptions.find(e => e.date === tomorrow);
    }
    try {
      const saved = await saveException(); assert.notEqual(saved.id, oldId);
      if (fault === 'pending') {
        await lesson.getByText(/20:00–21:00/).waitFor();
        assert.equal(await lesson.isDisabled(), true, 'do not edit during a pending course refresh');
        holdReads = false;
        release();
      } else if (fault !== 'stats') {
        await page.getByText('课程数据刷新失败，请刷新后再操作', { exact: true }).waitFor();
        assert.equal(await lesson.isDisabled(), true);
        assert.equal(await card.getByRole('button', { name: '编辑', exact: true }).isDisabled(), true);
        broken = false;
        await page.getByRole('button', { name: '刷新课程数据', exact: true }).click();
      } else {
        await page.getByRole('status').getByText('出勤与学费统计刷新失败，请重试', { exact: true }).waitFor();
        assert.equal(await page.getByText('课程数据刷新失败，请刷新后再操作', { exact: true }).count(), 0);
      }
      await lesson.click();
      assert.equal(await form.locator('input[type=time]').first().inputValue(), '20:00', 'never reopen with the old saved time');
      await saveException(); // Saving an unchanged form must preserve the latest time and rotate its ID.
      await lesson.click();
      const latest = db.prepare('SELECT * FROM outside_class_exceptions WHERE class_id = ? AND child_id = ? AND date = ?').get(cls.id, child.id, tomorrow);
      assert.equal(latest.new_start_time, '20:00'); assert.equal(latest.new_end_time, '21:00');
      const restored = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/outside-class-exceptions/'));
      await form.getByRole('button', { name: '恢复正常上课', exact: true }).click();
      const response = await restored; assert.equal(response.status(), 200); assert.ok(response.url().endsWith(latest.id));
      await form.waitFor({ state: 'detached' });
      await lesson.click();
      assert.equal(await form.getByRole('button', { name: '恢复正常上课', exact: true }).count(), 0);
      await form.getByRole('button', { name: '🔁 调课', exact: true }).click();
      await form.locator('input[type=time]').first().fill('20:00');
      await form.locator('input[type=time]').last().fill('21:00');
      await saveException();
      assert.equal(db.prepare('SELECT new_start_time FROM outside_class_exceptions WHERE class_id = ? AND date = ?').get(cls.id, tomorrow).new_start_time, '20:00');
    } finally {
      release();
      await page.unroute('**/api/**');
    }
  });
  await scenario('D4-class-save-stats-500', async ({ child, cls, board }) => {
    const page = await board();
    page.setDefaultTimeout(10000);
    await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
    await page.route('**/api/outside-classes/stats?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"统计刷新失败"}' }));
    const card = page.locator(`[data-class-id="${cls.id}"]`);
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    const edit = page.getByRole('dialog', { name: '编辑课外班', exact: true });
    const title = '统计失败仍更新课程';
    await edit.getByLabel('课程名称', { exact: true }).fill(title);
    await edit.getByRole('button', { name: '保存', exact: true }).click();
    await edit.waitFor({ state: 'detached' });
    await card.getByText(title, { exact: true }).waitFor();
    await card.getByRole('button', { name: '编辑', exact: true }).click();
    assert.equal(await edit.getByLabel('课程名称', { exact: true }).inputValue(), title);
    await edit.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '➕ 新增课外班', exact: true }).click();
    const create = page.getByRole('dialog', { name: '新增课外班', exact: true });
    await create.getByLabel('课程名称', { exact: true }).fill('统计失败仍可新建');
    await create.getByRole('button', { name: '周一', exact: true }).click();
    await create.getByRole('button', { name: '保存', exact: true }).click();
    await create.waitFor({ state: 'detached' });
    await page.getByText('统计失败仍可新建', { exact: true }).waitFor();
    await card.getByRole('button', { name: '删除', exact: true }).click();
    await confirmation(page).getByRole('button', { name: '确认', exact: true }).click();
    await card.waitFor({ state: 'detached' });
  });
  for (const staleAction of ['modify', 'delete']) await scenario(`D1-${staleAction}`, async ({ child, cls, board, open, move }) => {
    await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: tomorrow, kind: 'moved',
      new_date: today, new_start_time: '16:00', new_end_time: '17:00' });
    const a = await board(), b = await board();
    await open(a); await open(b);
    const ra = rowFor(a, cls, tomorrow, today), rb = rowFor(b, cls, tomorrow, today);
    await move(a, ra);
    const current = (await api('GET', `/outside-classes`)).find(item => item.id === cls.id).exceptions[0];
    if (staleAction === 'modify') await move(b, rb, '20:00', '21:00', 409);
    else await action(b, rb, '撤销调课', child, 404);
    await modalFor(b).getByRole('alert').getByText(staleAction === 'modify' ? /请假或调课刚被修改过/ : /请假或调课已被修改或撤销/).waitFor();
    await rb.getByText('18:00–19:00', { exact: false }).waitFor();
    const saved = (await api('GET', '/outside-classes')).find(item => item.id === cls.id).exceptions[0];
    assert.deepEqual(saved, current, 'stale browser must not overwrite or delete the newer arrangement');
  });
  await scenario('D2-stats-500', async ({ cls, board, open }) => {
    const page = await board(); let statsRequests = 0;
    await page.route('**/api/outside-classes/**', route => {
      if (new URL(route.request().url()).pathname.endsWith('/stats')) {
        statsRequests++; return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"统计不可用"}' });
      }
      return route.continue();
    });
    await open(page);
    await page.getByText(/🎒 明天要带：.*回归乐谱/).waitFor();
    await rowFor(page, cls).getByText('未确认', { exact: true }).waitFor();
    await modalFor(page).getByText('回归乐谱', { exact: false }).first().waitFor();
    assert.equal(statsRequests, 0, 'board schedule must not request class statistics');
  });
  await scenario('D2-attendance-revision', async ({ child, cls, board, open }) => {
    const page = await board();
    await page.route('**/api/outside-classes/**/stats?*', route => route.fulfill({ status: 500, body: '{"error":"统计不可用"}' }));
    await open(page);
    const row = rowFor(page, cls);
    const first = await action(page, row, '已上课', child); assert.equal(first.expected_revision, null);
    await action(page, row, '撤销确认', child);
    const lesson = (await api('GET', `/children/${child.id}/schedule?from=${today}`))[0].outside.find(item => item.class_id === cls.id);
    assert.equal(lesson.attendance, null); assert.ok(lesson.attendance_revision);
    const next = await action(page, row, '缺席', child);
    assert.equal(next.expected_revision, lesson.attendance_revision);
  });
  await scenario('R-A-orphan-attendance', async ({ child, cls, board, open }) => {
    await api('PUT', `/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: today, status: 'attended' });
    await api('PUT', `/outside-classes/${cls.id}/fee`, { child_id: child.id, total_fee_cents: 10000 });
    db.prepare('DELETE FROM outside_class_revisions WHERE class_id = ? AND child_id = ?').run(cls.id, child.id);
    const page = await board(); await open(page);
    const row = rowFor(page, cls);
    await row.getByText('已上课', { exact: true }).waitFor();
    assert.equal(await row.getByText('未确认', { exact: true }).count(), 0);
    const lesson = (await api('GET', `/children/${child.id}/schedule?from=${today}`))[0].outside.find(item => item.class_id === cls.id);
    const stats = await api('GET', `/outside-classes/${cls.id}/stats?child_id=${child.id}`);
    assert.ok(lesson.attendance_revision);
    assert.equal(stats.lessons.find(item => item.lesson_date === today).revision, lesson.attendance_revision);
    assert.ok(stats.summary.fee_revision);
    const stale = await fetch(`${base}/api/outside-classes/${cls.id}/attendance`, { method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ child_id: child.id, lesson_date: today, status: 'absent', expected_revision: null }) });
    assert.equal(stale.status, 409);
    const undo = await action(page, row, '撤销确认', child);
    assert.equal(undo.expected_revision, lesson.attendance_revision);
    await row.getByText('未确认', { exact: true }).waitFor();
    await action(page, row, '缺席', child);
    await row.getByText('缺席', { exact: true }).waitFor();
  });
  await scenario('confirmation-layer', async ({ cls, board, open }) => {
    const page = await board(); await open(page);
    await rowFor(page, cls).getByRole('button', { name: '请假', exact: true }).click();
    const dialog = confirmation(page);
    await dialog.waitFor();
    // Simulate a business dialog opening from a background callback while the
    // confirmation is already mounted. Pointer input cannot reach its opener.
    await page.getByTitle('实时查笔画', { exact: true }).evaluate(button => button.click());
    const later = page.getByRole('dialog', { name: '实时查笔画', exact: true });
    await later.waitFor();
    const button = dialog.getByRole('button', { name: '确认', exact: true });
    assert.equal(await button.evaluate(el => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), true, 'global confirmation remains above a later business dialog');
    await button.focus(); await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'keyboard focus follows visual priority');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal(await later.isVisible(), true, 'Escape only cancels the top confirmation');
    assert.equal(await later.evaluate(el => el.contains(document.activeElement)), true, 'focus returns to the exposed dialog');
    await page.keyboard.press('Escape'); await later.waitFor({ state: 'detached' });
    await page.keyboard.press('Escape'); await modalFor(page).waitFor({ state: 'detached' });
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  });
  for (const duringConfirm of [false, true]) await scenario(`D3-${duringConfirm ? 'confirm' : 'open'}`, async ({ child, cls, board, open }) => {
    const page = await board(); await page.clock.install(); await open(page);
    const row = rowFor(page, cls);
    await row.getByRole('button', { name: '请假', exact: true }).waitFor();
    if (duringConfirm) await row.getByRole('button', { name: '请假', exact: true }).click();
    // Keep the original signed token, but let the browser clock pass its actual exp.
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    let writes = 0;
    page.on('request', r => { if (['PUT', 'DELETE'].includes(r.method()) && /outside-class/.test(r.url())) writes++; });
    await page.clock.fastForward(payload.exp * 1000 - Date.now() + 2000);
    if (duringConfirm) await confirm(page, child.name);
    else await page.waitForFunction(() => !document.querySelector('[aria-label="家长课程操作"]'));
    await modalFor(page).getByText('家长登录已过期，请重新登录', { exact: true }).waitFor();
    assert.equal(writes, 0);
    const login = modalFor(page).getByRole('link', { name: '重新登录', exact: true });
    assert.equal(new URL(await login.getAttribute('href'), base).searchParams.get('returnTo'), `/child/${child.id}/today`);
    if (process.env.SMOKE_SCREENSHOT_DIR && duringConfirm) await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'board-session-expired.png') });
    // Restore the real clock to complete a real PIN login and verify the return destination.
    await page.clock.setFixedTime(Date.now()); await login.click();
    for (const digit of '1234') await page.getByRole('button', { name: digit, exact: true }).click();
    await page.waitForURL(`**/child/${child.id}/today`);
  });
  for (const offset of [-40, 1]) await scenario(`settings-direct-${offset < 0 ? 'past' : 'next'}`, async ({ child, cls, board, open }) => {
    const source = shiftDate(today, offset);
    await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: source, kind: 'moved',
      new_date: today, new_start_time: '16:00', new_end_time: '17:00' });
    const page = await board(); await open(page);
    await rowFor(page, cls, source, today).getByRole('button', { name: '调课', exact: true }).click();
    await page.getByRole('link', { name: '更多设置 →', exact: true }).click();
    await page.waitForURL('**/parent/schedule?**');
    const form = page.getByRole('dialog', { name: new RegExp(cls.title) });
    await form.waitFor(); await form.getByText(new RegExp(`${Number(source.slice(5, 7))}/${Number(source.slice(8))}`)).waitFor();
    assert.equal(await form.locator('input[type=date]').inputValue(), today);
    if (process.env.SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, 'board-settings-direct.png') });
    // Saving closes the old form and reloads the latest exception ID before reopening.
    await form.locator('input[type=time]').first().fill('18:00');
    await form.locator('input[type=time]').last().fill('19:00');
    const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
    await form.getByRole('button', { name: '保存', exact: true }).click(); assert.equal((await saved).status(), 200);
    await form.waitFor({ state: 'detached' });
    const card = page.locator(`[data-class-id="${cls.id}"]`);
    // The source is outside the usual four weeks: reload the deep link to edit its new ID.
    if (offset < 0) await page.reload({ waitUntil: 'networkidle' });
    else await card.locator(`button[data-source-date="${source}"]`).click();
    await form.waitFor();
    assert.equal(await form.locator('input[type=time]').first().inputValue(), '18:00', 'manager reloads saved exception data');
    const latest = (await api('GET', '/outside-classes')).find(item => item.id === cls.id).exceptions.find(item => item.date === source);
    const restored = page.waitForResponse(r => r.request().method() === 'DELETE' && r.url().includes('/outside-class-exceptions/'));
    await form.getByRole('button', { name: '恢复正常上课', exact: true }).click();
    const response = await restored; assert.equal(response.status(), 200); assert.ok(response.url().endsWith(latest.id));
    await form.waitFor({ state: 'detached' }); await card.waitFor();
    for (const query of [`child=${child.id}&class=missing&date=${source}`, `child=${child.id}&class=${cls.id}&date=2026-02-30`, `child=missing&class=${cls.id}&date=${source}`]) {
      await page.goto(`${base}/parent/schedule?${query}`, { waitUntil: 'networkidle' });
      await page.locator('h2').getByText('课程表', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0, 'invalid targets leave the normal list usable');
    }
  });
}
// Keep this separate from D3: the session stays valid and both clocks cross only
// a fixed business midnight, regardless of the time the suite is run.
async function midnightRegressions(base) {
  const RealDate = Date;
  const { formatDate } = require('../backend/src/utils/date');
  let low = RealDate.parse('2026-10-20T00:00:00Z'), high = low + 86400000;
  const initialDate = formatDate(new RealDate(low));
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (formatDate(new RealDate(mid)) === initialDate) low = mid; else high = mid;
  }
  const midnight = high;
  for (const pending of ['leave', 'move', 'refresh-failure']) {
    const name = `F1-midnight-${pending}`;
    if (process.env.BOARD_CLASS_CASE && !name.startsWith(process.env.BOARD_CLASS_CASE)) continue;
    let context, release;
    let now = midnight - 10000;
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    };
    try {
      const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '1h' });
      const api = async (method, url, payload) => {
        const result = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
        assert.ok(result.statusCode < 300, result.body); return result.json();
      };
      const before = getTodayDate(), after = shiftDate(before, 1);
      const child = await api('POST', '/children', { name });
      const cls = await api('POST', '/outside-classes', { title: '跨午夜钢琴', child_ids: [child.id], start_date: before,
        days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00', total_lessons: 10 });
      context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles', colorScheme: pending === 'move' ? 'dark' : 'light' });
      await context.addInitScript(({ token, child }) => {
        sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
      }, { token, child });
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const page = await context.newPage(); page.setDefaultTimeout(5000);
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.install({ time: new RealDate(now) }); await page.clock.pauseAt(new RealDate(now));
      const writes = [];
      page.on('request', request => {
        if (['PUT', 'POST', 'DELETE'].includes(request.method()) && /outside-class/.test(request.url())) writes.push(request);
      });
      await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      await page.locator('button[title="今天的课"]').click();
      const modal = modalFor(page), oldPanel = await modal.elementHandle();
      const row = rowFor(page, cls, before);
      if (pending === 'move') await openMove(page, row, after);
      else await row.getByRole('button', { name: '请假', exact: true }).click();
      await confirmation(page).getByText(new RegExp(before)).waitFor();
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(`**/api/children/${child.id}/schedule?*`, async route => {
        await gate;
        if (pending === 'refresh-failure') return route.fulfill({ status: 500, body: '{"error":"测试跨日刷新失败"}', contentType: 'application/json' });
        await route.continue();
      }, { times: 1 });
      const refreshed = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === `/api/children/${child.id}/schedule`);
      // A failed assertion before releasing the route must not leave an unhandled timeout.
      refreshed.catch(() => {});
      now = midnight + 10000;
      await page.clock.runFor(20000);
      // These assertions run while the new schedule is still in flight.
      await confirmation(page).waitFor({ state: 'detached' });
      await modal.getByText('日期已变化，请重新操作', { exact: true }).waitFor();
      assert.equal(await oldPanel.evaluate(el => el.isConnected), true, 'midnight must not remount the board dialog');
      assert.equal(await page.getByRole('dialog', { name: '调整这节课', exact: true }).count(), 0, 'old move draft is discarded');
      assert.equal(await row.getByRole('button', { name: '请假', exact: true }).isDisabled(), true, 'old schedule is read-only while refreshing');
      assert.equal(await modal.getByRole('button', { name: '关闭', exact: true }).isEnabled(), true);
      release();
      assert.equal((await refreshed).status(), pending === 'refresh-failure' ? 500 : 200);
      if (pending === 'refresh-failure') {
        assert.equal(await row.getByRole('button', { name: '请假', exact: true }).isDisabled(), true);
        // Even closing/reopening after a failed read must retain a way to retry.
        await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
        assert.equal(await confirmation(page).count(), 0);
        await page.locator('button[title="今天的课"]').click();
        await modal.getByText('日期已变化，请重新操作', { exact: true }).waitFor();
        await modal.getByRole('button', { name: '刷新日程和打卡任务', exact: true }).click();
      }
      const next = rowFor(page, cls, after);
      await next.getByRole('button', { name: '请假', exact: true }).waitFor();
      assert.equal(writes.length, 0, 'cancelling the previous day must send no write');
      const saved = await action(page, next, '请假', child);
      assert.equal(saved.date, after);
      await next.getByText('已请假', { exact: true }).waitFor();
      assert.equal(writes.length, 1);
      assert.equal(writes[0].postDataJSON().date, after, 'only the new day may be written');
      assert.deepEqual(db.prepare('SELECT date FROM outside_class_exceptions WHERE child_id = ?').all(child.id).map(item => item.date), [after]);
      await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
      assert.equal(await confirmation(page).count(), 0, 'closing the board must not reveal an old confirmation');
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await page.locator('button[title="今天的课"]').click();
      await next.getByText('已请假', { exact: true }).waitFor();
      assert.ok(JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp * 1000 > now, 'login remains valid');
      assert.deepEqual(errors, []);
      passed++; console.log(`PASS ${name}`);
    } catch (error) { failed++; console.error(`FAIL ${name}:`, error); }
    finally { release?.(); if (context) await context.close(); global.Date = RealDate; }
  }
}
async function main() {
  await app.ready();
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() });
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const api = async (method, url, payload) => {
    const result = await fetch(`${base}/api${url}`, { method, headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    assert.ok(result.ok, await result.clone().text()); return result.json();
  };
  browser = await chromium.launch(launchOptions());
  if (process.env.SMOKE_SCREENSHOT_DIR) fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
  await regressions(base, token, api);
  await midnightRegressions(base);
  for (const width of process.env.BOARD_CLASS_CASE || process.env.BOARD_CLASS_REGRESSIONS_ONLY ? [] : [390, 1180]) for (const colorScheme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: '看板甲' });
    const other = app.services.childrenService.createChild({ name: '看板乙' });
    const cls = app.services.scheduleService.createClass({ title: `看板钢琴-${width}-${colorScheme}`, child_ids: [child.id, other.id],
      start_date: today, days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00', total_lessons: 5, create_task: true });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme, hasTouch: true, timezoneId: 'America/Los_Angeles' });
    await context.addInitScript(({ token, child }) => {
      sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
    }, { token, child });
    let childContext;
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    try {
      await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      const task = page.locator('[data-task-card]').filter({ hasText: cls.title });
      await task.waitFor();
      await page.locator('button[title="今天的课"]').click();
      const modal = modalFor(page), row = rowFor(page, cls), next = rowFor(page, cls, tomorrow);
      await modal.getByText(`只对 ${child.name} 生效`, { exact: true }).waitFor();
      await row.getByText('未确认', { exact: true }).waitFor();
      assert.equal(await next.getByRole('button', { name: '已上课', exact: true }).count(), 0);
      assert.equal(await next.getByRole('button', { name: '缺席', exact: true }).count(), 0);
      await layout(page, modal);
      if (process.env.SMOKE_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SMOKE_SCREENSHOT_DIR, { recursive: true });
        await modal.locator('.overflow-y-auto').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({ path: path.join(process.env.SMOKE_SCREENSHOT_DIR, `board-classes-${width}-${colorScheme}.png`) });
      }
      // Cancel confirmation: no mutation.
      await row.getByRole('button', { name: '请假', exact: true }).click();
      await confirmation(page).getByText(/今天请假会取消当天还没完成的打卡任务/).waitFor();
      await confirmation(page).getByText(/请假默认不扣课时/).waitFor();
      await confirmation(page).getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(db.prepare('SELECT COUNT(*) n FROM outside_class_exceptions WHERE child_id = ?').get(child.id).n, 0);
      let arrived, release;
      const started = new Promise(resolve => { arrived = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(`**/outside-classes/${cls.id}/exceptions`, async route => { arrived(); await gate; await route.continue(); }, { times: 1 });
      const leaveAction = action(page, row, '请假', child);
      const timeout = setTimeout(release, 8000);
      try {
        await Promise.race([started, leaveAction.then(() => { throw new Error('Expected held request'); })]);
        assert.equal(await modal.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape'); assert.equal(await modal.count(), 1);
        assert.equal(await row.getByRole('button', { name: '请假', exact: true }).isDisabled(), true);
      } finally { release(); clearTimeout(timeout); }
      const leave = await leaveAction;
      assert.deepEqual([leave.child_id, leave.date, leave.expected_exception_id], [child.id, today, null]);
      await row.getByText('已请假', { exact: true }).waitFor();
      await task.waitFor({ state: 'detached' });
      assert.equal((await api('GET', `/children/${other.id}/schedule?from=${today}`))[0].outside[0].status, 'scheduled');
      await action(page, row, '撤销请假', child);
      await row.getByText('未确认', { exact: true }).waitFor(); await task.waitFor();
      // Tomorrow can be moved or put on leave, but cannot confirm attendance.
      await action(page, next, '请假', child); await next.getByText('已请假', { exact: true }).waitFor();
      await action(page, next, '撤销请假', child);
      await openMove(page, next, shiftDate(today, 2));
      const moved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
      await confirm(page, child.name); assert.equal((await moved).status(), 200);
      await next.getByText(`已调到 ${Number(shiftDate(today, 2).slice(5, 7))}/${Number(shiftDate(today, 2).slice(8))} 日`, { exact: true }).waitFor();
      await action(page, next, '撤销调课', child);
      // Incoming lessons use their source date, even if the source is in the future.
      await openMove(page, next, today);
      await confirm(page, child.name);
      const incoming = rowFor(page, cls, tomorrow, today);
      await incoming.getByRole('button', { name: '已上课', exact: true }).waitFor();
      const attendedIncoming = await action(page, incoming, '已上课', child);
      assert.equal(attendedIncoming.lesson_date, tomorrow);
      await incoming.getByText('已上课', { exact: true }).waitFor();
      await action(page, incoming, '撤销确认', child);
      await action(page, incoming, '撤销调课', child);
      const attended = await action(page, row, '已上课', child);
      assert.equal(attended.expected_revision, null); assert.equal(Object.hasOwn(attended, 'charged'), false);
      await row.getByText('已上课', { exact: true }).waitFor();
      assert.equal(await row.getByRole('button', { name: '请假', exact: true }).count(), 0);
      const cleared = await action(page, row, '撤销确认', child);
      assert.ok(cleared.expected_revision); assert.equal(cleared.status, 'pending');
      await row.getByRole('button', { name: '缺席', exact: true }).waitFor();
      // Another parent changes attendance while the current confirmation is open.
      await row.getByRole('button', { name: '缺席', exact: true }).click();
      await api('PUT', `/outside-classes/${cls.id}/attendance`, { child_id: child.id, lesson_date: today, status: 'attended' });
      let conflict = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/attendance'));
      await confirm(page, child.name); assert.equal((await conflict).status(), 409);
      await modal.getByRole('alert').getByText(/出勤刚被其他设备修改过/).waitFor();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      await row.getByText('已上课', { exact: true }).waitFor();
      await action(page, row, '撤销确认', child);
      await action(page, row, '缺席', child); await row.getByText('缺席', { exact: true }).waitFor();
      // Exception conflict is a real concurrent write, not a fabricated 409.
      await next.getByRole('button', { name: '请假', exact: true }).click();
      await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: tomorrow, kind: 'leave', expected_exception_id: null });
      conflict = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith('/exceptions'));
      await confirm(page, child.name); assert.equal((await conflict).status(), 409);
      await modal.getByRole('alert').getByText(/请假或调课刚被修改过/).waitFor();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      await next.getByText('已请假', { exact: true }).waitFor();
      // Transport failure: one request only, exact uncertainty message, explicit refresh.
      await action(page, next, '撤销请假', child);
      let requests = 0;
      await page.route(`**/outside-classes/${cls.id}/exceptions`, route => { requests++; return route.abort('connectionfailed'); }, { times: 1 });
      await next.getByRole('button', { name: '请假', exact: true }).click();
      await confirm(page, child.name);
      await modal.getByRole('alert').getByText('操作未确认，请刷新后核对', { exact: true }).waitFor();
      await page.getByRole('button', { name: '关闭错误提示', exact: true }).click();
      assert.equal(requests, 1);
      assert.equal(await next.getByRole('button', { name: '请假', exact: true }).isDisabled(), true);
      await modal.getByRole('alert').getByRole('button', { name: '刷新日程和打卡任务', exact: true }).click();
      await next.getByRole('button', { name: '请假', exact: true }).waitFor();
      assert.equal(db.prepare('SELECT COUNT(*) n FROM outside_class_attendance WHERE child_id = ?').get(other.id).n, 0);
      await modal.getByRole('button', { name: '关闭', exact: true }).click();
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
      // Child session is independent, with readable statuses and no action buttons.
      const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch(), child_epoch: child.session_epoch ?? null });
      childContext = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme, hasTouch: true, timezoneId: 'America/Los_Angeles' });
      await childContext.addInitScript(({ token, child }) => {
        sessionStorage.setItem('taskie_child_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
      }, { token: childToken, child });
      await childContext.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const childPage = await childContext.newPage(); childPage.setDefaultTimeout(10000);
      childPage.on('pageerror', error => errors.push(error.message));
      await childPage.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      await childPage.locator('button[title="今天的课"]').click();
      await rowFor(childPage, cls).getByText('缺席', { exact: true }).waitFor();
      await rowFor(childPage, cls, tomorrow).getByText('未确认', { exact: true }).waitFor();
      assert.equal(await modalFor(childPage).locator('[aria-label="家长课程操作"]').count(), 0);
      assert.equal(await modalFor(childPage).getByRole('button').count(), 1, 'only dialog close is available');
      const forbidden = await app.inject({ method: 'PUT', url: `/api/outside-classes/${cls.id}/attendance`, headers: { authorization: `Bearer ${childToken}` }, payload: { child_id: child.id, lesson_date: today, status: 'attended' } });
      assert.equal(forbidden.statusCode, 403);
      assert.deepEqual(errors, []);
      passed++; console.log(`PASS ${width}px ${colorScheme}: leave/move/attendance/undo, task refresh, isolation, conflicts, network uncertainty, child read-only, layout`);
    } catch (error) {
      failed++; console.error(`FAIL ${width}px ${colorScheme}:`, error);
    } finally { if (childContext) await childContext.close(); await context.close(); }
  }
  console.log(`board-class-actions: ${passed} passed, ${failed} failed`);
  assert.equal(failed, 0);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
