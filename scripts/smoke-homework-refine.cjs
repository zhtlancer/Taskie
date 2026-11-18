// Build first. Real homework, points and study records in an isolated database; no production data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-homework-refine-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready(); const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), today = getTodayDate(), errors = [];
  const api = async (method, url, payload, owner = token) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${owner}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`); return response.json();
  };
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = await api('POST', '/children', { name: '作业排版验收' }), other = await api('POST', '/children', { name: '另一个孩子' });
    await api('POST', `/children/${child.id}/timetables`, { name: '本学期', start_date: shiftDate(today, -60), end_date: shiftDate(today, 60),
      slots: [{ id: 's1', kind: 'class', label: '第一节', start_time: '08:00', end_time: '08:40' }, { id: 's2', kind: 'class', label: '第二节', start_time: '09:00', end_time: '09:40' }],
      lessons: [{ slot_id: 's1', weekday: 1, subject: '科学' }, { slot_id: 's2', weekday: 2, subject: '数学' }] });
    for (const subject of ['科学', '数学']) await api('PUT', '/homework-course-points', { course_key: `school:${subject}`, points: 10 });
    const study = await api('POST', `/children/${child.id}/homework`, { subject: '科学', content: '分次学习记录' + '长作业内容'.repeat(30), due_date: shiftDate(today, 2), create_task: true });
    for (const [index, seconds] of [120, 180].entries()) await api('POST', `/homework/${study.id}/sessions`, { request_id: `refine_${study.id}_${index}`, date: today, duration_seconds: seconds, note: `第${index + 1}次` });
    const done = await api('POST', `/children/${child.id}/homework`, { subject: '数学', content: '已完成的作业', due_date: today, create_task: true, points: 11 });
    await api('POST', `/homework/${done.id}/complete`, {});
    const oldDate = shiftDate(`${today.slice(0, 8)}01`, -1);
    const outside = await api('POST', '/outside-classes', { title: '课外班' + '长课程名称'.repeat(3), child_ids: [child.id], start_date: oldDate,
      days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00' });
    await api('POST', `/children/${child.id}/homework`, { course_kind: 'class', class_id: outside.id, content: '上个月的记录', assigned_date: oldDate, due_date: oldDate });
    const pending = app.services.homeworkService.create(child.id, { subject: '科学', content: '等家长生成任务', due_date: today, create_task: true }, 'child');
    const otherRecord = await api('POST', `/children/${other.id}/homework`, { subject: '语文', content: '另一个孩子专属记录', due_date: today });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 }, colorScheme: theme, hasTouch: true, timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', err => errors.push(err.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const go = () => page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
      const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
      const card = id => page.locator(`[data-homework-record="${id}"]`);
      const state = title => page.locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const reload = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      const shot = async suffix => {
        if (!process.env.SCREENSHOT_DIR) return;
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `homework-${width}-${theme}-${suffix}.png`), fullPage: true });
      };
      const fail = route => route.fulfill({ status: 503, json: { error: '本轮读取暂时失败' } });
      const listUrl = `**/api/children/${child.id}/homework`, coursesUrl = `**/api/children/${child.id}/homework/courses`, summaryUrl = `**/api/children/${child.id}/homework/summary?*`;
      const hold = async (pattern, method = 'GET') => {
        let release, arrive, finished, count = 0;
        const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrive = resolve; }), done = new Promise(resolve => { finished = resolve; });
        await page.route(pattern, async route => {
          if (route.request().method() !== method) return route.continue();
          count++; const response = await route.fetch(); arrive(); await gate;
          try { await route.fulfill({ response }); } catch (error) { if (!/closed|canceled|cancelled|Invalid Interception/i.test(error.message)) throw error; }
          finally { finished(); }
        });
        return { release, done, count: () => count, started: async () => { let timer; try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`request not started: ${pattern}`)), 12000); })]); } finally { clearTimeout(timer); } } };
      };
      await page.route(listUrl, fail); await go(); await state('作业本未能读取').waitFor();
      assert.equal(await page.getByRole('heading', { name: '还没有作业记录', exact: true }).count(), 0);
      await page.unroute(listUrl, fail); await state('作业本未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await card(study.id).waitFor(); await card(study.id).getByText('已学 2 次 · 累计 5 分钟', { exact: true }).waitFor();
      await shot('records');
      await page.getByRole('searchbox', { name: '搜索作业内容', exact: true }).fill('不存在的内容');
      await page.getByRole('heading', { name: '没有符合条件的作业', exact: true }).waitFor();
      await page.getByRole('button', { name: '清除筛选', exact: true }).click(); await card(study.id).waitFor();
      await page.route(coursesUrl, fail); await reload(); await state('课程信息未能读取').waitFor();
      assert.equal(await card(study.id).getByRole('button', { name: '学习 / 记录', exact: true }).isEnabled(), true);
      assert.equal(await page.getByRole('button', { name: '➕ 记作业', exact: true }).isDisabled(), true);
      await page.unroute(coursesUrl, fail); await state('课程信息未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.getByRole('button', { name: '➕ 记作业', exact: true }).click();
      const draft = page.getByPlaceholder(/抄写第 5 课/); await draft.fill('恢复读取后保留的作业草稿');
      await reload(); await page.waitForLoadState('networkidle'); assert.equal(await draft.inputValue(), '恢复读取后保留的作业草稿');
      await page.keyboard.press('Escape');

      // First summary failure is retryable; a slow previous range cannot replace the newest range.
      await page.route(summaryUrl, fail); await page.getByRole('button', { name: '📊 按课程统计', exact: true }).click();
      await state('课程统计未能读取').waitFor(); assert.equal(await page.getByText('正在统计作业…', { exact: true }).count(), 0);
      assert.equal(await page.locator('[data-homework-summary]').count(), 0);
      await page.unroute(summaryUrl, fail); await state('课程统计未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.locator('[data-homework-summary]').getByText('3', { exact: true }).waitFor();
      await page.getByRole('button', { name: '本学期', exact: true }).waitFor();
      const heldRange = await hold(summaryUrl);
      try {
        await page.getByRole('button', { name: '本周', exact: true }).click(); await heldRange.started();
        await page.unroute(summaryUrl); // The held response remains pending, while newer requests use the real server.
        await page.getByRole('group', { name: '统计区间', exact: true }).getByRole('button', { name: '全部', exact: true }).click();
        await page.locator('[data-homework-summary]').getByText('4', { exact: true }).waitFor();
        await shot('summary');
        heldRange.release(); await heldRange.done;
        assert.equal(await page.getByRole('group', { name: '统计区间', exact: true }).getByRole('button', { name: '全部', exact: true }).getAttribute('aria-pressed'), 'true');
        await page.locator('[data-homework-summary]').getByText('4', { exact: true }).waitFor();
      } finally { heldRange.release(); await page.unroute(summaryUrl); }
      const latestStudy = await api('GET', `/homework/${study.id}`);
      await api('PUT', `/homework/${study.id}`, { content: '从课程统计打开后读取的最新内容', expected_version: latestStudy.edit_version });
      await page.locator('li button').filter({ hasText: '科学' }).click();
      await card(study.id).getByText('从课程统计打开后读取的最新内容', { exact: true }).waitFor();
      assert.equal(await card(done.id).count(), 0); await page.getByRole('searchbox').fill('不存在');
      await page.getByRole('button', { name: '清除筛选', exact: true }).click(); await card(done.id).waitFor();

      // Explicit default-point saves keep drafts, validate blank values, serialize requests and protect navigation.
      await page.getByRole('button', { name: '⚙️ 课程默认积分', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '⚙️ 课程默认积分', exact: true });
      const pointsInput = dialog.getByLabel('科学 默认积分', { exact: true }), pointsForm = pointsInput.locator('xpath=ancestor::form');
      await pointsInput.fill('17');
      const heldPoints = await hold('**/api/homework-course-points', 'PUT');
      try {
        await pointsForm.getByRole('button', { name: '保存', exact: true }).click(); await heldPoints.started();
        assert.equal(await pointsInput.isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
        await pointsForm.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        const before = page.url(); await push(`/child/${other.id}/homework`); assert.equal(page.url(), before);
        await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 1);
        assert.equal(heldPoints.count(), 1); heldPoints.release(); await heldPoints.done;
        await dialog.getByRole('status').filter({ hasText: '默认积分已保存' }).waitFor();
      } finally { heldPoints.release(); await page.unroute('**/api/homework-course-points'); }
      await page.route('**/api/homework-course-points', route => route.fulfill({ status: 400, json: { error: '积分尚未保存' } }));
      await pointsInput.fill('23'); assert.equal(await dialog.getByRole('status').count(), 0, 'editing clears the previous save notice');
      await pointsForm.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.getByRole('alert').getByText('积分尚未保存', { exact: true }).waitFor(); assert.equal(await pointsInput.inputValue(), '23');
      assert.equal((await api('GET', `/children/${child.id}/homework/courses`)).find(row => row.course_key === 'school:科学').points, 17);
      await page.unroute('**/api/homework-course-points'); await pointsInput.fill('');
      await pointsForm.evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await dialog.getByRole('alert').getByText('积分须为 0 到 10000 的整数', { exact: true }).waitFor();
      await pointsInput.fill('23'); await pointsForm.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.getByRole('status').filter({ hasText: '默认积分已保存' }).waitFor(); await dialog.getByRole('button', { name: '完成', exact: true }).click();
      assert.equal((await api('GET', `/homework/${study.id}`)).task.points, 10, 'default changes do not alter existing task rewards');
      await card(study.id).getByRole('button', { name: '学习 / 记录', exact: true }).click();
      await page.getByRole('dialog', { name: '分次做作业', exact: true }).getByText(/2 次学习/).waitFor(); await page.keyboard.press('Escape');
      assert.equal((await api('GET', `/homework/${study.id}/study`)).total_seconds, 300);
      if (width === 390 && theme === 'light') {
        await card(study.id).getByRole('button', { name: '删除', exact: true }).click();
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await page.getByRole('dialog', { name: '删除这条作业记录？', exact: true }).waitFor({ state: 'detached' });
        await card(study.id).getByRole('button', { name: '删除', exact: true }).waitFor({ state: 'visible' });
        assert.ok(db.prepare('SELECT id FROM homework_records WHERE id=?').get(study.id));
      }

      // Delete failure stays in its dialog; deleting only the record keeps sessions on the original task.
      await card(study.id).getByRole('button', { name: '删除', exact: true }).click();
      const deleteDialog = page.getByRole('dialog', { name: '删除这条作业记录？', exact: true });
      const deleteUrl = `**/api/homework/${study.id}`;
      await page.route(deleteUrl, route => route.fulfill({ status: 400, json: { error: '这条记录尚未删除' } }));
      await deleteDialog.getByRole('button', { name: '只删除记录，保留任务', exact: true }).click();
      await deleteDialog.getByRole('alert').getByText('这条记录尚未删除', { exact: true }).waitFor();
      assert.equal(await deleteDialog.count(), 1); await page.unroute(deleteUrl);
      const heldDelete = await hold(deleteUrl, 'DELETE');
      try {
        await deleteDialog.getByRole('button', { name: '只删除记录，保留任务', exact: true }).click(); await heldDelete.started();
        assert.equal(await deleteDialog.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
        await deleteDialog.getByRole('button', { name: '只删除记录，保留任务', exact: true }).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        const before = page.url(); await push(`/child/${child.id}/today`); assert.equal(page.url(), before);
        await page.route(listUrl, fail); heldDelete.release(); await heldDelete.done;
        await page.getByRole('status').filter({ hasText: '作业记录已删除。' }).waitFor(); await state('作业本未能读取').waitFor();
        assert.equal(await deleteDialog.count(), 0); assert.equal(await card(study.id).count(), 0); assert.equal(heldDelete.count(), 1);
      } finally { heldDelete.release(); await page.unroute(deleteUrl); await page.unroute(listUrl, fail); }
      assert.equal(db.prepare('SELECT COUNT(*) n FROM homework_sessions WHERE task_id=?').get(study.task.id).n, 2);
      assert.ok(db.prepare('SELECT id FROM daily_tasks WHERE id=?').get(study.task.id));
      await state('作业本未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await card(done.id).getByRole('button', { name: '删除', exact: true }).click();
      await deleteDialog.getByText(/一起删除会扣回积分/).waitFor();
      await deleteDialog.getByRole('button', { name: '删除记录和打卡任务', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '作业记录和打卡任务已删除。' }).waitFor();
      assert.equal(db.prepare('SELECT id FROM daily_tasks WHERE id=?').get(done.task.id), undefined);
      assert.equal(app.services.rewardsService.getTotalPoints(child.id), 0);
      await card(pending.id).getByRole('button', { name: '生成任务', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '作业任务已生成。' }).waitFor();
      assert.equal((await api('GET', `/homework/${pending.id}`)).task_requested, false);
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '➕ 记作业' && !button.disabled));

      const controls = await page.locator('[data-homework-page] button, [data-homework-page] input, [data-homework-page] a').evaluateAll(items => items.filter(item => item.getClientRects().length).map(item => {
        const r = item.getBoundingClientRect(); return { label: item.textContent || item.getAttribute('type'), height: r.height, left: r.left, right: r.right };
      }));
      // Course filters intentionally scroll inside their own row; all other controls fit the viewport.
      for (const control of controls) assert.ok(control.height >= 44, JSON.stringify(control));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `homework-${width}-${theme}.png`), fullPage: true }); }
      if (width === 390 && theme === 'light') {
        const oldChildSummary = await hold(summaryUrl);
        try {
          await page.getByRole('button', { name: '📊 按课程统计', exact: true }).click(); await oldChildSummary.started();
          await push(`/child/${other.id}/homework`);
          await page.locator('[data-homework-summary]').getByText('1', { exact: true }).waitFor();
          oldChildSummary.release(); await oldChildSummary.done;
          assert.equal(await page.locator('li button').filter({ hasText: '科学' }).count(), 0, 'previous child summary cannot replace current child');
          await page.getByRole('button', { name: '📋 作业列表', exact: true }).click();
        } finally { oldChildSummary.release(); await page.unroute(summaryUrl); }
      } else await push(`/child/${other.id}/homework`);
      await card(otherRecord.id).waitFor();
      assert.equal(await card(pending.id).count(), 0); assert.equal(await page.getByRole('searchbox').inputValue(), '');
      console.log(`PASS ${width}px ${theme}: list/course failures, filter reset, summary retry/races, point drafts and guards, real deletion/session retention, child switching and 44px layout`);
    } finally { await context.close(); }

    // The child's own role can record and study, while parent-only writes remain forbidden on the server.
    if (width === 390 && theme === 'light') {
      const childToken = (await app.inject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json().token;
      const childContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      try {
        await childContext.addInitScript(token => sessionStorage.setItem('taskie_child_token', token), childToken);
        const page = await childContext.newPage(); page.on('pageerror', err => errors.push(err.message)); await page.goto(`${base}/child/${child.id}/homework`);
        await page.locator(`[data-homework-record="${pending.id}"]`).waitFor();
        assert.equal(await page.getByRole('button', { name: '⚙️ 课程默认积分', exact: true }).count(), 0);
        assert.equal(await page.locator(`[data-homework-record="${pending.id}"]`).getByRole('button', { name: '修改', exact: true }).count(), 0);
        for (const [method, url, payload] of [['PUT', '/homework-course-points', { course_key: 'school:科学', points: 99 }],
          ['GET', `/children/${other.id}/homework`], ['POST', `/homework/${pending.id}/task`], ['DELETE', `/homework/${pending.id}?delete_task=1`]]) {
          const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${childToken}` } }); assert.equal(response.statusCode, 403);
        }
        console.log('PASS child role cannot edit linked records, set default points or read another child');
      } finally { await childContext.close(); }
    }
    await api('DELETE', `/children/${child.id}`); await api('DELETE', `/children/${other.id}`);
    await api('DELETE', `/outside-classes/${outside.id}`);
  }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
