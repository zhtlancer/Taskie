// Build first. Real HTTP writes and temporary SQLite; no live family data.
const assert = require('node:assert/strict');
const { launchBrowser, smokePort } = require('./browser-env.cjs');
const { useLocalLearningFont } = require('./word-book-fonts.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const { validateTaskFailures } = require('../backend/src/db/task-failure-constraints');
const c = createTestApp({ dictDir: null });
let browser, releaseHeld;
async function main() {
  let hold;
  c.app.addHook('onSend', async (request, reply, payload) => {
    if (hold && request.url.endsWith('/confirm-failure')) { const current = hold; hold = null; current.started(); await current.gate; }
    return payload;
  });
  await c.app.ready();
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await launchBrowser();
  const s = c.app.services, errors = [];
  const scenarios = process.env.FAILURE_SINGLE_CASE ? [[1180, 'dark']] : [[390, 'light'], [820, 'dark'], [1180, 'light']];
  for (const [width, theme] of scenarios) {
    const child = s.childrenService.createChild({ name: `检查未完成-${width}` });
    const create = data => s.tasksService.createAdhocTask(child.id, { subject: '语文', points: 5, ...data });
    const pending = create({ title: '学校记事' }), done = create({ title: '学校作业' }), timed = create({ title: '阅读练习', track_time: true });
    s.tasksService.completeDailyTask(done.id);
    s.taskStudyService.manual(timed.id, { request_id: `failure-manual-${width}`, duration_seconds: 60, date: getTodayDate() }, 'parent');
    s.taskStudyService.start(timed.id);
    const past = create({ title: '昨天记事', date: shiftDate(getTodayDate(), -1) });
    const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1024 }, colorScheme: theme, hasTouch: true, reducedMotion: 'reduce' });
    try {
      await useLocalLearningFont(context);
      await context.addInitScript(({ token, theme }) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      const card = title => page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
      const open = async (title, label) => { await card(title).getByRole('button', { name: '更多任务操作', exact: true }).click(); await card(title).getByRole('button', { name: label, exact: true }).click(); return page.getByRole('dialog', { name: label, exact: true }); };
      let dialog = await open('学校记事', '确认未完成');
      assert.equal(await dialog.getByLabel('额外扣分（可选）', { exact: true }).isChecked(), false);
      await dialog.getByLabel('未完成原因（必填）', { exact: true }).fill('没有在学校记录作业');
      await dialog.getByRole('button', { name: '确认未完成', exact: true }).click();
      await dialog.waitFor({ state: 'detached' });
      await card('学校记事').getByText('确认未完成', { exact: true }).waitFor();
      assert.equal(await card('学校记事').getByRole('button', { name: '完成任务', exact: true }).count(), 0);
      assert.equal(s.rewardsService.getTotalPoints(child.id), 5);
      dialog = await open('学校记事', '恢复为待完成');
      await dialog.getByRole('button', { name: '恢复为待完成', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await card('学校记事').getByRole('button', { name: '完成任务', exact: true }).waitFor();
      dialog = await open('学校作业', '确认未完成');
      await dialog.getByLabel('未完成原因（必填）', { exact: true }).fill('检查发现没有写');
      await dialog.getByLabel('额外扣分（可选）', { exact: true }).check();
      await dialog.getByLabel('额外扣除积分', { exact: true }).fill('2');
      await dialog.getByRole('status').filter({ hasText: '收回完成奖励 5 分，额外扣除 2 分' }).waitFor();
      let started;
      const ready = new Promise(resolve => { started = resolve; }), gate = new Promise(resolve => { releaseHeld = resolve; });
      hold = { started, gate };
      await dialog.getByRole('button', { name: '确认未完成', exact: true }).click(); await ready;
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
      assert.equal(await dialog.getByLabel('未完成原因（必填）', { exact: true }).isDisabled(), true);
      releaseHeld(); await dialog.waitFor({ state: 'detached' });
      await card('学校作业').getByText('已扣 2 分', { exact: false }).waitFor();
      assert.equal(s.rewardsService.getTotalPoints(child.id), -2);
      dialog = await open('阅读练习', '确认未完成');
      await dialog.getByLabel('未完成原因（必填）', { exact: true }).fill('今天没有读完');
      await dialog.getByRole('button', { name: '确认未完成', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await card('阅读练习').getByRole('button', { name: '查看记录', exact: true }).click();
      const study = page.getByRole('dialog');
      await study.getByText(/确认未完成 · 今天没有读完/).waitFor();
      assert.equal(await study.getByRole('button', { name: '开始本次', exact: true }).count(), 0);
      assert.ok(s.taskStudyService.details(timed.id).total_seconds >= 60);
      await study.getByRole('button', { name: '关闭', exact: true }).click();
      await page.goto(`${base}/parent/children/${child.id}/backfill`, { waitUntil: 'networkidle' });
      const pastCard = page.locator(`[data-backfill-task="${past.id}"]`);
      await pastCard.getByRole('button', { name: '确认未完成', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '确认未完成', exact: true });
      await dialog.getByLabel('未完成原因（必填）', { exact: true }).fill('昨天没有记作业');
      await dialog.getByRole('button', { name: '确认未完成', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await pastCard.getByRole('button', { name: '恢复为待完成', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '恢复为待完成', exact: true });
      await dialog.getByRole('button', { name: '恢复为待完成', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
      await pastCard.getByRole('button', { name: '补记完成', exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log(`PASS ${width}/${theme}: pending and completed failures, optional penalty, request lock, retained timing and historical restore`);
    } finally { releaseHeld?.(); await context.close(); }
    const own = await browser.newContext();
    try {
      await useLocalLearningFont(own);
      const token = c.app.jwt.sign({ role: 'child', child_id: child.id, epoch: c.app.sessionEpoch() });
      await own.addInitScript(token => sessionStorage.setItem('taskie_child_token', token), token);
      const page = await own.newPage(); await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
      assert.equal(await page.getByRole('button', { name: '确认未完成', exact: true }).count(), 0);
      const closed = page.locator('[data-task-card]').filter({ has: page.getByRole('heading', { name: '学校作业', exact: true }) });
      assert.equal(await closed.getByRole('button').count(), 0);
      const result = await page.evaluate(async ({ id, token }) => (await fetch(`/api/daily-tasks/${id}/restore-failure`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' })).status, { id: done.id, token });
      assert.equal(result, 403);
      await page.goto(`${base}/child/${child.id}/rewards`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: /积分变动记录/ }).waitFor();
      await page.getByText('-2', { exact: true }).waitFor();
      await page.getByText('学校作业 · 确认未完成（额外扣分）', { exact: true }).waitFor();
      assert.equal(await page.getByText('+-2', { exact: true }).count(), 0);
    } finally { await own.close(); }
    validateTaskFailures(c.db);
  }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  releaseHeld?.(); await browser?.close(); await c.app.close(); cleanupTestApp(c); c.db.close();
});
