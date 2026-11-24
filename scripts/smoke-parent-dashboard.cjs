// Build first. Real approvals and deletion in isolated SQLite; injected failures exercise UI recovery.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-parent-dashboard-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), today = getTodayDate(), errors = [];
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`); return response.json();
  };
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = await api('POST', '/children', { name: '需要查看完整名字的小朋友' });
    const cls = await api('POST', '/outside-classes', { title: '家长首页确认消课'.repeat(2), child_ids: [child.id],
      start_date: today, days_of_week: [0,1,2,3,4,5,6], start_time: '23:00', end_time: '23:59', total_lessons: 2, auto_homework: true });
    const task = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '删除练习' + '长名称'.repeat(12), subject: '数学', points: 7 });
    const skipTask = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '申请跳过的练习', subject: '数学', points: 3 });
    const skip = app.services.skipsService.requestSkip(skipTask.id, '请假' + '长原因'.repeat(12), { role: 'child' }).request;
    const homework = app.services.homeworkService.create(child.id, { subject: '数学', course_kind: 'school', content: '待生成的作业' + 'LongContent'.repeat(15), assigned_date: today, due_date: today, create_task: true }, 'child');
    const late = await api('POST', `/children/${child.id}/homework`, { subject: '语文', content: '超期作业' + '完整内容'.repeat(16), due_date: today, create_task: true, points: 11 });
    db.prepare('UPDATE daily_tasks SET date=?, due_date=NULL WHERE id=?').run(shiftDate(today, -1), late.task.id);
    db.prepare('UPDATE homework_records SET assigned_date=?, due_date=?, completion_requested_at=? WHERE id=?').run(shiftDate(today, -1), shiftDate(today, -1), new Date().toISOString(), late.id);
    const rewardPoints = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '赚取兑换积分', subject: '其他', points: 30 });
    await api('POST', `/daily-tasks/${rewardPoints.id}/complete`);
    const reward = await api('POST', '/reward-items', { title: '家长待办兑换奖励', cost: 5 });
    const redemptions = [];
    for (let i = 0; i < 4; i++) redemptions.push(await api('POST', `/children/${child.id}/redemptions`, { reward_id: reward.id }));
    const context = await browser.newContext({ viewport: { width, height: 1100 }, hasTouch: true, colorScheme: theme, timezoneId: 'Pacific/Honolulu', locale: 'zh-CN', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
      await page.clock.install();
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      const go = () => page.goto(`${base}/parent/dashboard`, { waitUntil: 'networkidle' });
      const card = page.locator(`[data-child-summary="${child.id}"]`), state = page.locator('[data-page-state=error]');
      const reload = () => page.getByRole('button', { name: '刷新总览', exact: true }).click();
      const confirm = () => page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      const skipRow = page.locator('li').filter({ hasText: skipTask.title });
      const homeworkRow = page.locator('li').filter({ hasText: homework.content });
      const lateRow = page.locator('section').filter({ has: page.getByRole('heading', { name: '📒 超期作业全部完成申请', exact: true }) });
      const lesson = page.locator(`[data-pending-lesson="${cls.id}:${child.id}:${today}"]`);
      const fail = route => route.fulfill({ status: 503, json: { error: '本轮模拟读取失败' } });
      const childrenUrl = '**/api/children';
      await page.route(childrenUrl, fail); await go(); await state.waitFor();
      assert.equal(await page.getByRole('heading', { name: '还没有添加小朋友账号哦', exact: true }).count(), 0);
      assert.equal(await card.count(), 0); assert.equal(await page.locator('[aria-label="今日摘要"]').count(), 0);
      await page.unroute(childrenUrl, fail); await state.getByRole('button', { name: '重新读取', exact: true }).click();
      await card.waitFor(); await homeworkRow.getByRole('button', { name: '生成任务', exact: true }).waitFor();
      const controls = await page.locator('main button, main a').evaluateAll(items => items.filter(item => item.getClientRects().length).map(item => {
        const r = item.getBoundingClientRect(); return { label: item.textContent, height: r.height, left: r.left, right: r.right };
      }));
      for (const control of controls) assert.ok(control.height >= 44 && control.left >= 0 && control.right <= width + 1, JSON.stringify(control));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `dashboard-${width}-${theme}.png`), fullPage: true }); }

      const inbox = page.getByRole('region', { name: '家长待办', exact: true });
      const rewards = inbox.locator('[data-todo-group="rewards"]');
      assert.equal(await inbox.locator('[data-todo-group]').count(), 5);
      assert.match(await inbox.locator('[data-todo-count]').innerText(), /当前 8 项/);
      assert.equal(await rewards.locator('[data-todo-redemption]').count(), 3);
      await rewards.getByRole('button', { name: '展开奖励兑换申请', exact: true }).click();
      assert.equal(await rewards.locator('[data-todo-redemption]').count(), 4);
      const inboxPoll = page.waitForResponse(response => response.url().endsWith('/api/children'));
      await page.clock.fastForward(60000); await inboxPoll; await page.waitForLoadState('networkidle');
      assert.equal(await rewards.locator('[data-todo-redemption]').count(), 4, 'polling preserves expansion');
      await rewards.getByRole('button', { name: '收起奖励兑换申请', exact: true }).click();
      assert.equal(await rewards.locator('[data-todo-redemption]').count(), 3);
      await rewards.getByRole('button', { name: '展开奖励兑换申请', exact: true }).click();
      if (width === 390 && theme === 'light') {
        const rewardUrl = '**/api/redemptions?*';
        await page.route(rewardUrl, fail); await reload(); await rewards.getByRole('alert').waitFor();
        assert.equal(await rewards.getByRole('button', { name: '确认兑换', exact: true }).first().isDisabled(), true);
        assert.equal(await skipRow.getByRole('button', { name: '同意跳过', exact: true }).isEnabled(), true);
        assert.equal(await state.count(), 0);
        await page.unroute(rewardUrl, fail);
        await rewards.getByRole('button', { name: '重新读取奖励兑换申请', exact: true }).click();
        await rewards.getByRole('alert').waitFor({ state: 'detached' });
        const approvalUrl = `**/api/redemptions/${redemptions[0].id}/approve`;
        await page.route(approvalUrl, route => route.fulfill({ status: 503, json: { error: '兑换审批暂时失败' } }));
        await rewards.locator(`[data-todo-redemption="${redemptions[0].id}"]`).getByRole('button', { name: '确认兑换', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: '兑换审批暂时失败' }).waitFor();
        assert.equal(db.prepare('SELECT status FROM reward_redemptions WHERE id=?').get(redemptions[0].id).status, 'pending');
        await page.unroute(approvalUrl);
      }
      const availableBefore = (await api('GET', `/children/${child.id}/stats`)).available_points;
      const approvedReward = rewards.locator(`[data-todo-redemption="${redemptions[0].id}"]`);
      await approvedReward.getByRole('button', { name: '确认兑换', exact: true }).click(); await approvedReward.waitFor({ state: 'detached' });
      assert.equal(db.prepare('SELECT status FROM reward_redemptions WHERE id=?').get(redemptions[0].id).status, 'approved');
      assert.equal((await api('GET', `/children/${child.id}/stats`)).available_points, availableBefore);
      const rejectedReward = rewards.locator(`[data-todo-redemption="${redemptions[1].id}"]`);
      await rejectedReward.getByRole('button', { name: '拒绝并释放积分', exact: true }).click(); await rejectedReward.waitFor({ state: 'detached' });
      assert.equal((await api('GET', `/children/${child.id}/stats`)).available_points, availableBefore + 5);
      for (const request of redemptions.slice(2)) await api('POST', `/redemptions/${request.id}/reject`);
      await reload(); await rewards.waitFor({ state: 'detached' });
      assert.match(await inbox.locator('[data-todo-count]').innerText(), /当前 4 项/);
      if (width === 390 && theme === 'light') {
        for (const [kind, url, action, retry] of [
          ['skip', '**/api/skip-requests?*', '同意跳过', '重新读取跳过任务申请'],
          ['homework', '**/api/homework-requests', '生成任务', '重新读取作业生成申请'],
          ['completion', '**/api/homework-completion-requests', '确认完成', '重新读取超期作业全部完成申请']
        ]) {
          const group = inbox.locator(`[data-todo-group="${kind}"]`);
          await page.route(url, fail); await reload(); await group.getByRole('alert').waitFor();
          assert.equal(await group.getByRole('button', { name: action, exact: true }).isDisabled(), true);
          assert.equal(await lesson.getByRole('button', { name: '确认消课', exact: true }).isEnabled(), true);
          assert.equal(await state.count(), 0);
          await page.unroute(url, fail); await group.getByRole('button', { name: retry, exact: true }).click();
          await group.getByRole('alert').waitFor({ state: 'detached' });
        }
      }

      // Pending attendance is independently recoverable; accepting it uses the existing class flow.
      await lesson.waitFor();
      if (width === 390 && theme === 'light') {
        const pendingUrl = '**/api/outside-classes/pending-attendance';
        await page.route(pendingUrl, fail); await reload();
        await page.getByRole('alert').filter({ hasText: '待消课记录未能读取' }).waitFor();
        assert.equal(await lesson.getByRole('button', { name: '确认消课', exact: true }).isDisabled(), true);
        assert.equal(await skipRow.getByRole('button', { name: '同意跳过', exact: true }).isEnabled(), true);
        await page.unroute(pendingUrl, fail);
        await page.getByRole('button', { name: '重新读取待消课', exact: true }).click();
        await lesson.getByRole('button', { name: '确认消课', exact: true }).click();
        await lesson.waitFor({ state: 'detached' });
        await page.getByRole('status').filter({ hasText: '已确认上课并消课 1 次。' }).waitFor();
        await page.locator('[data-class-homework]').getByRole('link', { name: '查看作业', exact: true }).waitFor();
      } else {
        await lesson.getByRole('button', { name: '其它处理', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '处理待消课', exact: true });
        if (width === 820 && theme === 'light') {
          const rejectSave = route => route.fulfill({ status: 409, json: { error: '模拟出勤冲突' } });
          await page.route('**/api/outside-classes/*/attendance', rejectSave);
          await dialog.getByRole('button', { name: '保存出勤', exact: true }).click();
          await dialog.getByRole('alert').filter({ hasText: '模拟出勤冲突' }).waitFor();
          await page.unroute('**/api/outside-classes/*/attendance', rejectSave);
          await dialog.getByRole('button', { name: '暂不处理', exact: true }).click();
          await dialog.waitFor({ state: 'detached' });
          assert.equal(await page.getByRole('alert').filter({ hasText: '模拟出勤冲突' }).count(), 0);
          await lesson.getByRole('button', { name: '其它处理', exact: true }).click();
          await dialog.waitFor();
        }
        const status = theme === 'dark' ? 'leave' : 'absent';
        await dialog.getByLabel('出勤状态', { exact: true }).selectOption(status);
        assert.equal(await dialog.getByLabel('本次消课（扣 1 次）', { exact: true }).isChecked(), false);
        await dialog.getByLabel('备注（选填）', { exact: true }).fill('家长首页核实');
        await dialog.getByRole('button', { name: '保存出勤', exact: true }).click();
        await dialog.waitFor({ state: 'detached' }); await lesson.waitFor({ state: 'detached' });
      }
      const attendance = db.prepare('SELECT status, charged FROM outside_class_attendance WHERE class_id=? AND child_id=? AND lesson_date=?').get(cls.id, child.id, today);
      assert.equal(attendance.status, width === 390 && theme === 'light' ? 'attended' : theme === 'dark' ? 'leave' : 'absent');
      assert.equal(attendance.charged, width === 390 && theme === 'light' ? 1 : 0);

      // The four optional endpoints fail independently of the core cards and approvals.
      const optionalUrls = [`**/api/children/${child.id}/current-timer`, `**/api/children/${child.id}/time-stats?*`, '**/api/outside-classes/stats?*', '**/api/daily-tasks?*'];
      for (const url of optionalUrls) await page.route(url, fail);
      await reload(); await card.locator('[data-partial-error]').waitFor();
      for (const text of ['作业用时', '当前计时', '课外班概览', '待办摘要']) assert.ok((await card.locator('[data-partial-error]').innerText()).includes(text));
      assert.equal(await state.count(), 0); assert.equal(await homeworkRow.getByRole('button', { name: '生成任务', exact: true }).isEnabled(), true);
      for (const url of optionalUrls) await page.unroute(url, fail);
      await card.getByRole('button', { name: '重新读取摘要', exact: true }).click(); await card.locator('[data-partial-error]').waitFor({ state: 'detached' });

      // Polling updates cards without replacing the open form or swallowing its draft.
      await card.getByRole('button', { name: '➕ 添加', exact: true }).click();
      const draft = page.getByPlaceholder('例如：订正数学练习、准备手抄报'); await draft.fill('刷新后仍然保留的输入');
      const polled = page.waitForResponse(response => response.url().endsWith('/api/children') && response.request().method() === 'GET');
      await page.clock.fastForward(60000); await polled; await page.waitForLoadState('networkidle');
      assert.equal(await draft.inputValue(), '刷新后仍然保留的输入');
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' });

      // Failed delete is visible and repeat confirmation cannot queue a second operation.
      const deleteButton = card.getByRole('button', { name: `删除 ${task.title}`, exact: true });
      const deleteUrl = `**/api/adhoc-tasks/${task.id}`;
      if (width === 390 && theme === 'light') {
        let staleDeletes = 0;
        page.on('request', request => { if (request.method() === 'DELETE' && request.url().endsWith(`/adhoc-tasks/${task.id}`)) staleDeletes++; });
        await deleteButton.click();
        const reread = page.waitForResponse(response => response.url().endsWith('/api/children'));
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored'))); await reread;
        await confirm(); await page.waitForLoadState('networkidle');
        assert.equal(staleDeletes, 0, 'restore invalidates an open deletion confirmation');
        assert.ok(db.prepare('SELECT id FROM daily_tasks WHERE id=?').get(task.id));
      }
      await page.route(deleteUrl, route => route.fulfill({ status: 400, json: { error: '任务尚未删除，请重试' } }));
      await deleteButton.click();
      await deleteButton.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      assert.equal(await page.getByRole('dialog').count(), 1);
      await confirm(); await page.getByRole('alert').filter({ hasText: '任务尚未删除，请重试' }).waitFor();
      await page.getByRole('button', { name: '刷新总览', exact: true }).waitFor();
      assert.ok(db.prepare('SELECT id FROM daily_tasks WHERE id=?').get(task.id));
      await page.unroute(deleteUrl);
      await deleteButton.click(); await page.keyboard.press('Escape'); assert.ok(db.prepare('SELECT id FROM daily_tasks WHERE id=?').get(task.id));
      await deleteButton.click(); await confirm(); await deleteButton.waitFor({ state: 'detached' });
      await page.getByRole('status').filter({ hasText: '临时任务已删除。' }).waitFor();
      assert.equal(db.prepare('SELECT id FROM daily_tasks WHERE id=?').get(task.id), undefined);

      // Force a duplicate click while an actual accepted approval response is held.
      const approve = skipRow.getByRole('button', { name: '同意跳过', exact: true });
      const approveUrl = `**/api/skip-requests/${skip.id}/approve`;
      let release, arrived; const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; });
      let writes = 0;
      await page.route(approveUrl, async route => { writes++; const response = await route.fetch(); assert.equal(response.status(), 200); arrived(); await gate; await route.fulfill({ response }); });
      try {
        await approve.click(); await ready;
        assert.equal(await approve.isDisabled(), true); assert.equal(await homeworkRow.getByRole('button', { name: '生成任务', exact: true }).isDisabled(), true);
        await approve.evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await page.getByRole('navigation', { name: '家长导航', exact: true }).getByRole('link', { name: '学习安排', exact: true }).evaluate(link => link.click());
        assert.equal(new URL(page.url()).pathname, '/parent/dashboard');
        await page.route(childrenUrl, fail); release();
        await page.getByRole('status').filter({ hasText: '已同意跳过任务。' }).waitFor(); await state.waitFor();
        assert.equal(writes, 1); assert.equal(await approve.count(), 0, 'accepted request removed despite failed read');
        assert.equal(db.prepare('SELECT status FROM task_skip_requests WHERE id=?').get(skip.id).status, 'approved');
        assert.equal(await homeworkRow.getByRole('button', { name: '生成任务', exact: true }).isDisabled(), true, 'stale data cannot be acted on');
      } finally { release(); await page.unroute(approveUrl); await page.unroute(childrenUrl, fail); }
      await state.getByRole('button', { name: '重新读取', exact: true }).click();
      await page.getByRole('button', { name: '刷新总览', exact: true }).waitFor();
      const createUrl = `**/api/homework/${homework.id}/task`;
      await page.route(createUrl, route => route.fulfill({ status: 400, json: { error: '作业未生成，请重试' } }));
      await homeworkRow.getByRole('button', { name: '生成任务', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '作业未生成，请重试' }).waitFor();
      await page.unroute(createUrl); await homeworkRow.getByRole('button', { name: '生成任务', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '作业任务已生成。' }).waitFor();
      assert.equal((await api('GET', `/homework/${homework.id}`)).task_requested, false);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM daily_tasks d JOIN homework_records h ON h.daily_task_id=d.id WHERE h.id=?').get(homework.id).n, 1);
      await lateRow.getByRole('button', { name: '确认完成', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已确认作业全部完成。' }).waitFor();
      assert.equal((await api('GET', `/homework/${late.id}/study`)).record.task.is_completed, true);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM point_logs WHERE daily_task_id=?').get(late.task.id).n, 1);
      // Rejection paths settle their respective queues without changing task completion or points.
      const rejectedTask = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '家长不同意跳过', subject: '其他' });
      const rejectedSkip = app.services.skipsService.requestSkip(rejectedTask.id, '想休息一下', { role: 'child' }).request;
      const rejectedHomework = app.services.homeworkService.create(child.id, { subject: '英语', content: '不需要生成的作业', due_date: today, create_task: true }, 'child');
      const later = await api('POST', `/children/${child.id}/homework`, { subject: '语文', content: '暂不确认完成的作业', due_date: today, create_task: true });
      db.prepare('UPDATE homework_records SET completion_requested_at=? WHERE id=?').run(new Date().toISOString(), later.id);
      await reload();
      await page.locator('li').filter({ hasText: rejectedTask.title }).getByRole('button', { name: '不同意', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已拒绝跳过申请。' }).waitFor();
      assert.equal(db.prepare('SELECT status FROM task_skip_requests WHERE id=?').get(rejectedSkip.id).status, 'rejected');
      await page.locator('li').filter({ hasText: rejectedHomework.content }).getByRole('button', { name: '不需要', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已处理这条作业申请。' }).waitFor();
      assert.equal((await api('GET', `/homework/${rejectedHomework.id}`)).task_requested, false);
      await lateRow.getByRole('button', { name: '暂不确认', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '已暂不确认这次完成申请。' }).waitFor();
      assert.equal((await api('GET', `/homework/${later.id}`)).completion_requested_at, null);
      assert.equal(db.prepare('SELECT is_completed FROM daily_tasks WHERE id=?').get(later.task.id).is_completed, 0);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM point_logs WHERE daily_task_id=?').get(later.task.id).n, 0);
      console.log(`PASS ${width}px ${theme}: failure/empty separation, optional data, draft polling, deletion, real approvals, duplicate and navigation guards, 44px layout`);
    } finally { await context.close(); await api('DELETE', `/children/${child.id}`); }
  }
  // A successful empty family has an actionable empty state, unlike a failed read.
  const context = await browser.newContext();
  try {
    await context.addInitScript(token => sessionStorage.setItem('taskie_parent_token', token), token);
    const page = await context.newPage(); await page.goto(`${base}/parent/dashboard`);
    await page.getByRole('link', { name: '立即添加小朋友', exact: true }).waitFor();
    assert.equal(await page.locator('[data-page-state=error]').count(), 0);
    console.log('PASS genuine empty family offers child creation');
  } finally { await context.close(); }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
