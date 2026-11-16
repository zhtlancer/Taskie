// Build first. Real HTTP APIs with isolated SQLite; no application data is used.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-parent-schedule-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }), errors = [], today = getTodayDate();
  const api = async (method, url, payload) => {
    const r = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(r.statusCode < 300, r.body); return r.json();
  };
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = await api('POST', '/children', { name: `课程甲${width}${theme}` });
    const other = await api('POST', '/children', { name: `课程乙${width}${theme}` });
    const timetable = id => api('POST', `/children/${id}/timetables`, {
      name: `${id === child.id ? '甲' : '乙'}学校课程表`, start_date: today, end_date: shiftDate(today, 30),
      slots: [{ id: 'slot', kind: 'class', label: '第一节', start_time: '08:00', end_time: '08:40' }],
      lessons: [{ slot_id: 'slot', weekday: 1, week: 'all', subject: '语文' }] });
    const school = await timetable(child.id); await timetable(other.id);
    const cls = await api('POST', '/outside-classes', { title: `钢琴${width}${theme}`, child_ids: [child.id],
      start_date: today, total_lessons: 8, days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00' });
    const context = await browser.newContext({ viewport: { width, height: 1100 }, colorScheme: theme, hasTouch: true, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', err => errors.push(err.message));
      const go = (id = child.id) => page.goto(`${base}/parent/schedule?child=${id}`, { waitUntil: 'networkidle' });
      const schoolSection = page.locator('[data-schedule-section=school]');
      const courseSection = page.locator('[data-schedule-section=outside]');
      const card = page.locator(`[data-class-id="${cls.id}"]`);
      const toast = async () => { const close = page.getByRole('button', { name: '关闭错误提示', exact: true }); if (await close.count()) await close.click(); };
      const hold = async (url, method) => {
        let release, arrived, completed, writes = 0;
        const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { arrived = resolve; });
        const finished = new Promise(resolve => { completed = resolve; });
        await page.route(url, async route => {
          if (route.request().method() !== method) return route.continue();
          writes++; const response = await route.fetch(); arrived(); await gate;
          try { await route.fulfill({ response }); } finally { completed(); }
        });
        return { started, finished, release, writes: () => writes };
      };
      const protectedSave = async dialog => {
        assert.ok(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled());
        assert.ok(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled());
        assert.ok(await dialog.locator('input, select, textarea, button').evaluateAll(fields => fields.every(f => f.matches(':disabled'))));
        await page.keyboard.press('Escape'); await page.mouse.click(2, 2); assert.equal(await dialog.count(), 1);
        await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)));
        await page.keyboard.press('Enter');
        assert.ok(await page.getByRole('region', { name: '选择孩子', exact: true }).getByRole('button', { name: new RegExp(other.name) }).isDisabled());
        const before = page.url();
        await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '学习安排', exact: true }).evaluate(el => el.click());
        await page.waitForTimeout(50); assert.equal(page.url(), before);
      };
      // A slow statistics response cannot hide either independent section or lessons.
      const statsUrl = `**/api/outside-classes/stats?child_id=${child.id}`;
      const stats = await hold(statsUrl, 'GET');
      await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'domcontentloaded' }); await stats.started;
      await schoolSection.getByRole('button', { name: '➕ 新建课程表', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '🏫 新建课程表', exact: true });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await card.locator(`button[data-source-date="${today}"]`).click();
      dialog = page.getByRole('dialog', { name: new RegExp(cls.title) }); await dialog.getByRole('button', { name: '取消', exact: true }).click();
      stats.release(); await stats.finished; await page.unroute(statsUrl);
      // School failures must not turn into an empty timetable or disable course edits.
      const schoolUrl = `**/api/children/${child.id}/timetables`;
      await page.route(schoolUrl, route => route.fulfill({ status: 503, json: { error: '学校课表读取暂时失败' } }));
      await go(); await schoolSection.getByRole('heading', { name: '学校课程表未能读取', exact: true }).waitFor();
      assert.equal(await schoolSection.locator('[data-page-state=empty]').count(), 0);
      assert.equal(await card.getByRole('button', { name: '编辑', exact: true }).isDisabled(), false);
      await toast(); await page.unroute(schoolUrl);
      await schoolSection.getByRole('button', { name: '重新读取', exact: true }).click();
      const schoolCard = page.locator(`[data-timetable-id="${school.id}"]`);
      await schoolCard.getByRole('button', { name: '✏️ 编辑', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '🏫 编辑课程表', exact: true });
      await dialog.getByLabel('课程表名称', { exact: true }).waitFor();
      assert.ok(await dialog.getByLabel('课程表名称', { exact: true }).evaluate(el => el === document.activeElement));
      const cellButton = dialog.locator('td button').first(); await cellButton.click();
      const cell = page.getByRole('dialog', { name: /周.*第一节/ });
      await cell.getByLabel('科目', { exact: true }).fill('数学');
      await page.keyboard.press('Escape'); await cell.waitFor({ state: 'detached' });
      assert.ok(await cellButton.evaluate(el => el === document.activeElement));
      assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
      await cellButton.click(); await cell.getByLabel('科目', { exact: true }).fill('数学');
      await cell.getByRole('button', { name: '确定', exact: true }).click();
      await dialog.getByLabel('课程表名称', { exact: true }).fill('保留输入的课程表');
      const updateUrl = `**/api/timetables/${school.id}`;
      await page.route(updateUrl, route => route.fulfill({ status: 400, json: { error: '课程表暂时不能保存' } }));
      await dialog.getByRole('button', { name: '保存课程表', exact: true }).click();
      await dialog.getByRole('alert').getByText('课程表暂时不能保存', { exact: true }).waitFor(); await toast();
      assert.equal(await dialog.getByLabel('课程表名称', { exact: true }).inputValue(), '保留输入的课程表');
      await dialog.locator('td button').first().getByText('数学', { exact: true }).waitFor();
      await page.unroute(updateUrl);
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `school-editor-${width}-${theme}.png`), fullPage: true });
      }
      const schoolWrite = await hold(updateUrl, 'PUT');
      await dialog.getByRole('button', { name: '保存课程表', exact: true }).click(); await schoolWrite.started;
      await protectedSave(dialog); assert.equal(schoolWrite.writes(), 1); schoolWrite.release();
      await dialog.waitFor({ state: 'detached' }); await page.unroute(updateUrl);
      assert.equal((await api('GET', `/children/${child.id}/timetables`)).find(t => t.id === school.id).lessons[0].subject, '数学');
      // Failed course lists do not erase a valid school section or claim no courses exist.
      await page.route('**/api/outside-classes', route => route.fulfill({ status: 503, json: { error: '课外班读取暂时失败' } }));
      await go(); await courseSection.getByText('课程数据刷新失败，请刷新后再操作', { exact: true }).waitFor();
      assert.equal(await courseSection.locator('[data-page-state=empty]').count(), 0);
      assert.equal(await schoolSection.getByRole('button', { name: '➕ 新建课程表', exact: true }).isDisabled(), false);
      await toast(); await page.unroute('**/api/outside-classes');
      await courseSection.getByRole('button', { name: '刷新课程数据', exact: true }).click();
      await card.getByRole('button', { name: '编辑', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '编辑课外班', exact: true });
      const className = `${width}${theme}钢琴兴趣课程长标题`;
      await dialog.getByLabel('课程名称', { exact: true }).fill(className);
      const classUrl = `**/api/outside-classes/${cls.id}`;
      await page.route(classUrl, route => route.fulfill({ status: 400, json: { error: '课外班暂时不能保存' } }));
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.getByRole('alert').getByText('课外班暂时不能保存', { exact: true }).waitFor(); await toast();
      assert.equal(await dialog.getByLabel('课程名称', { exact: true }).inputValue(), className);
      await page.unroute(classUrl); const classWrite = await hold(classUrl, 'PUT');
      await dialog.getByRole('button', { name: '保存', exact: true }).click(); await classWrite.started;
      await protectedSave(dialog); assert.equal(classWrite.writes(), 1); classWrite.release();
      await dialog.waitFor({ state: 'detached' }); await page.unroute(classUrl);
      const lessonButton = card.locator(`button[data-source-date="${today}"]`); await lessonButton.click();
      dialog = page.getByRole('dialog', { name: new RegExp(className) });
      await dialog.getByRole('button', { name: '🔁 调课', exact: true }).click();
      await dialog.locator('input[type=date]').fill(shiftDate(today, 1));
      await dialog.locator('input[type=time]').first().fill('18:00'); await dialog.locator('input[type=time]').last().fill('19:00');
      await dialog.getByLabel('请假或调课备注', { exact: true }).fill('保留调课日期与备注');
      const exceptionUrl = `**/api/outside-classes/${cls.id}/exceptions`;
      await page.route(exceptionUrl, route => route.fulfill({ status: 400, json: { error: '调课暂时不能保存' } }));
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.getByRole('alert').getByText('调课暂时不能保存', { exact: true }).waitFor(); await toast();
      assert.equal(await dialog.locator('input[type=date]').inputValue(), shiftDate(today, 1));
      await page.unroute(exceptionUrl); const exceptionWrite = await hold(exceptionUrl, 'PUT');
      await dialog.getByRole('button', { name: '保存', exact: true }).click(); await exceptionWrite.started;
      await protectedSave(dialog); assert.equal(exceptionWrite.writes(), 1); exceptionWrite.release();
      await dialog.waitFor({ state: 'detached' }); await page.unroute(exceptionUrl);
      await lessonButton.click();
      const exception = (await api('GET', '/outside-classes')).find(c => c.id === cls.id).exceptions[0];
      const restoreUrl = `**/api/outside-class-exceptions/${exception.id}`, restoreWrite = await hold(restoreUrl, 'DELETE');
      await dialog.getByRole('button', { name: '恢复正常上课', exact: true }).click(); await restoreWrite.started;
      await protectedSave(dialog); assert.equal(restoreWrite.writes(), 1); restoreWrite.release();
      await dialog.waitFor({ state: 'detached' }); await page.unroute(restoreUrl);
      assert.equal((await api('GET', '/outside-classes')).find(c => c.id === cls.id).exceptions.length, 0);
      assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390 && theme === 'light') {
        // A summary refresh failure must not unmount a fee form that just saved.
        await card.getByRole('button', { name: '出勤与学费', exact: true }).click();
        const feeDialog = page.getByRole('dialog', { name: `${child.name} · ${className}`, exact: true });
        await feeDialog.getByLabel('本期总学费（元，选填）', { exact: true }).fill('125');
        const feeUrl = `**/api/outside-classes/${cls.id}/fee`, feeWrite = await hold(feeUrl, 'PUT');
        await feeDialog.getByRole('button', { name: '保存学费', exact: true }).click(); await feeWrite.started;
        assert.ok(await feeDialog.getByRole('button', { name: '关闭', exact: true }).isDisabled());
        assert.ok(await page.getByRole('region', { name: '选择孩子', exact: true }).getByRole('button', { name: new RegExp(other.name) }).isDisabled());
        const before = page.url();
        await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '学习安排', exact: true }).evaluate(el => el.click());
        await page.waitForTimeout(50); assert.equal(page.url(), before);
        await page.route(statsUrl, route => route.fulfill({ status: 503, json: { error: '统计读取暂时失败' } }));
        feeWrite.release(); await feeWrite.finished; await page.unroute(feeUrl);
        await feeDialog.getByText('总学费 ¥125.00', { exact: false }).waitFor();
        assert.equal(await feeDialog.getByLabel('本期总学费（元，选填）', { exact: true }).inputValue(), '125');
        await feeDialog.getByRole('button', { name: '关闭', exact: true }).click();
        await courseSection.getByText('出勤与学费统计刷新失败，请重试', { exact: true }).waitFor();
        await toast(); await page.unroute(statsUrl); await courseSection.getByRole('button', { name: '刷新统计', exact: true }).click();
        await card.getByRole('button', { name: '出勤与学费', exact: true }).click();
        await feeDialog.getByRole('button', { name: '关闭', exact: true }).click();
        // A failed child read is recoverable and must not claim there are no children.
        await page.route('**/api/children', route => route.fulfill({ status: 503, json: { error: '孩子档案读取暂时失败' } }));
        await go(); await page.getByRole('heading', { name: '孩子档案未能读取', exact: true }).waitFor();
        assert.equal(await page.locator('[data-page-state=empty]').count(), 0);
        assert.equal(await page.getByText('还没有孩子档案。', { exact: false }).count(), 0);
        await toast(); await page.unroute('**/api/children');
        await page.getByRole('button', { name: '重新读取', exact: true }).click();
        await schoolSection.getByRole('button', { name: '➕ 新建课程表', exact: true }).click();
        await page.getByRole('dialog', { name: '🏫 新建课程表', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
        // An old child's late response cannot replace the newly selected child's table.
        const oldSchool = await hold(schoolUrl, 'GET');
        await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'domcontentloaded' }); await oldSchool.started;
        await page.getByRole('region', { name: '选择孩子', exact: true }).getByRole('button', { name: new RegExp(other.name) }).click();
        await schoolSection.getByText('乙学校课程表', { exact: true }).waitFor();
        const oldResponse = page.waitForResponse(r => r.url().endsWith(`/children/${child.id}/timetables`));
        oldSchool.release(); await oldSchool.finished; await oldResponse; await page.unroute(schoolUrl);
        assert.equal(await schoolSection.getByText('保留输入的课程表', { exact: true }).count(), 0);
        await go(); await card.getByRole('button', { name: '编辑', exact: true }).click();
        dialog = page.getByRole('dialog', { name: '编辑课外班', exact: true });
        await page.route(classUrl, route => route.fulfill({ status: 401, json: { error: '请重新登录' } }));
        await dialog.getByRole('button', { name: '保存', exact: true }).click(); await page.waitForURL('**/parent/login');
        await dialog.waitFor({ state: 'detached' }); assert.equal(await page.evaluate(() => document.body.style.overflow), '');
      }
      console.log(`PASS ${width}/${theme}: independent reads/retries, nested dialog focus, retained drafts, guarded timetable/class/move/restore writes, child isolation and layout`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
