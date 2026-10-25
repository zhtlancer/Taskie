// Build first. Exercise actual sliders and completion writes with isolated data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-completion-duration-'));
const db = getDb(':memory:');
db.prepare("UPDATE settings SET value = '0' WHERE key = 'parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 1180]) for (const theme of ['light', 'dark']) {
    const child = app.services.childrenService.createChild({ name: `补时 ${width}/${theme}` });
    const token = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() });
    const add = (title, expected_minutes) => app.services.tasksService.createAdhocTask(child.id, { title, subject: '数学', track_time: true, expected_minutes, points: 5 });
    const timed = add('有默认时长', 25), empty = add('没有默认时长', null), long = add('较长默认时长', 600), saved = add('已记录过用时', 20);
    const refused = add('补填被拒后重试', 20), offline = add('补填网络中断', 20);
    const paused = add('暂停但零秒', 20), unchanged = add('保持精确累计', 20), stale = add('累计用时发生变化', 20);
    const lost = add('追加响应丢失', 20);
    const fractional = add('整分钟累计后补半分钟', 20), fractionalEmpty = add('未计时补半分钟', 20);
    app.services.taskStudyService.manual(fractional.id, { request_id: `fractional-${child.id}`, duration_seconds: 120 }, 'parent');
    for (const task of [saved, unchanged, stale, lost]) app.services.taskStudyService.manual(task.id, { request_id: `saved-${task.id}`, duration_seconds: 125 }, 'parent');
    app.services.taskStudyService.start(paused.id);
    db.prepare('UPDATE homework_sessions SET timer_started_at = NULL WHERE task_id = ?').run(paused.id);
    const homework = app.services.homeworkService.create(child.id, { subject: '数学', content: '课程作业补填', assigned_date: getTodayDate(), due_date: getTodayDate(), create_task: true, track_time: true, expected_minutes: 20 }, 'parent');
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 820 }, colorScheme: theme });
    try {
      await context.addInitScript(({ token, child, theme }) => {
        sessionStorage.setItem('taskie_child_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const openTask = async title => {
        await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'networkidle' });
        const card = page.locator('div.select-none.border-2').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
        await card.getByRole('button', { name: '学习 / 记录', exact: true }).click();
        return page.getByRole('dialog', { name: '分次学习', exact: true });
      };
      const prompt = page.getByRole('dialog', { name: '⏱ 用了多久？', exact: true });
      let study = await openTask('有默认时长');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      await prompt.getByText(/这项任务当前没有计时记录/).waitFor();
      const slider = prompt.getByRole('slider');
      assert.equal(await slider.inputValue(), '1500');
      assert.equal(app.services.taskStudyService.details(timed.id).record.task.is_completed, false);
      await prompt.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(app.services.taskStudyService.details(timed.id).sessions.length, 0);
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      const box = await slider.boundingBox();
      await page.mouse.move(box.x + 10 + (box.width - 20) * 24 / 119, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      const selected = Number(await slider.inputValue());
      assert.ok(selected > 25 * 60 && selected < 120 * 60, 'dragging adjusts the duration');
      assert.equal(Math.round(Number(await prompt.locator('input[type=number]').inputValue()) * 60), selected);
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(timed.id).total_seconds, selected);
      assert.equal(app.services.taskStudyService.details(timed.id).sessions.length, 1);
      console.log(`PASS ${width}/${theme}: missing timer prompts, default preselects, cancel is safe and drag saves actual minutes`);

      study = await openTask('没有默认时长');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      assert.equal(await prompt.getByRole('slider').inputValue(), '900');
      await prompt.getByRole('button', { name: '不填，直接完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(empty.id).sessions.length, 0);
      study = await openTask('较长默认时长');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      assert.equal(await prompt.getByRole('slider').inputValue(), '36000');
      await prompt.locator('input[type=number]').fill('719');
      assert.equal(await prompt.getByRole('slider').inputValue(), '43140');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(long.id).total_seconds, 719 * 60);
      study = await openTask('已记录过用时');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      assert.equal(await prompt.getByRole('slider').inputValue(), '125');
      assert.equal(await prompt.getByRole('slider').getAttribute('min'), '125');
      await prompt.locator('input[type=number]').fill('1');
      assert.equal(await prompt.getByRole('button', { name: '完成', exact: true }).isDisabled(), true);
      await prompt.locator('input[type=number]').fill('5');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(await prompt.count(), 0);
      assert.equal(app.services.taskStudyService.details(saved.id).total_seconds, 300);
      assert.deepEqual(app.services.taskStudyService.details(saved.id).sessions.map(s => s.duration_seconds), [175, 125]);
      console.log(`PASS ${width}/${theme}: optional time, large defaults and increasing totals without changing original records`);

      await study.getByRole('button', { name: '关闭', exact: true }).click();
      const card = page.locator(`[data-timer-id="${homework.task.id}"]`);
      await card.getByRole('button', { name: '学习 / 记录', exact: true }).click();
      const homeworkDialog = page.getByRole('dialog', { name: '分次做作业', exact: true });
      await homeworkDialog.getByRole('button', { name: '作业全部完成', exact: true }).click();
      assert.equal(await prompt.getByRole('slider').inputValue(), '1200');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await homeworkDialog.getByText('✓ 作业已全部完成', { exact: true }).waitFor();
      assert.equal(app.services.homeworkStudyService.details(homework.id).total_seconds, 1200);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      console.log(`PASS ${width}/${theme}: timed course homework shares the completion prompt`);

      // A refusal saved nothing, so a different amount is a new attempt. A lost response stays
      // bound to its original amount and request id until that same attempt is confirmed.
      const completeUrl = id => `**/api/daily-tasks/${id}/study/complete`;
      study = await openTask('补填被拒后重试');
      await page.route(completeUrl(refused.id), route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '任务状态或学习用时已变化，请核对最新记录后重试' }) }), { times: 1 });
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await prompt.getByRole('alert').getByText('任务状态或学习用时已变化，请核对最新记录后重试', { exact: true }).waitFor();
      await prompt.locator('input[type=number]').fill('30');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(refused.id).total_seconds, 30 * 60);

      study = await openTask('补填网络中断');
      await page.route(completeUrl(offline.id), route => route.abort(), { times: 1 });
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await prompt.getByRole('alert').getByText(/无法连接服务器/).waitFor();
      await prompt.locator('input[type=number]').fill('30');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await prompt.getByRole('alert').getByText(/上次完成操作尚未确认/).waitFor();
      assert.equal(app.services.taskStudyService.details(offline.id).sessions.length, 0);
      await prompt.locator('input[type=number]').fill('20');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.deepEqual(app.services.taskStudyService.details(offline.id).sessions.map(s => s.duration_seconds), [20 * 60]);
      console.log(`PASS ${width}/${theme}: a refused completion accepts a new amount; a lost one retries only its original amount`);

      study = await openTask('暂停但零秒');
      await study.getByRole('button', { name: '结束计时并完成任务', exact: true }).click();
      await prompt.getByText(/当前没有计时记录/).waitFor();
      await prompt.getByRole('button', { name: '取消', exact: true }).click();
      assert.ok(app.services.taskStudyService.details(paused.id).active);
      await study.getByRole('button', { name: '结束计时并完成任务', exact: true }).click();
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(paused.id).active, null);
      assert.equal(app.services.taskStudyService.details(paused.id).total_seconds, 1200);

      study = await openTask('保持精确累计');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      assert.equal(await prompt.getByRole('slider').inputValue(), '125');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(unchanged.id).total_seconds, 125);
      assert.equal(app.services.taskStudyService.details(unchanged.id).sessions.length, 1);
      console.log(`PASS ${width}/${theme}: empty paused sessions prompt and unchanged totals preserve exact seconds`);

      study = await openTask('累计用时发生变化');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      await page.route(completeUrl(stale.id), async route => {
        app.services.taskStudyService.manual(stale.id, { request_id: `other-device-${stale.id}`, duration_seconds: 60 }, 'parent');
        await route.continue();
      }, { times: 1 });
      await prompt.locator('input[type=number]').fill('10');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await prompt.getByRole('alert').getByText(/累计用时已变化/).waitFor();
      assert.equal(await prompt.getByRole('slider').inputValue(), '185');
      assert.equal(app.services.taskStudyService.details(stale.id).record.task.is_completed, false);
      await prompt.locator('input[type=number]').fill('10');
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(stale.id).total_seconds, 600);
      console.log(`PASS ${width}/${theme}: another device changes the baseline, prompting review before retry`);

      study = await openTask('追加响应丢失');
      await study.getByRole('button', { name: '完成任务', exact: true }).click();
      await prompt.locator('input[type=number]').fill('10');
      await page.route(`**/api/daily-tasks/${lost.id}/study`, route => route.abort(), { times: 1 });
      await page.route(completeUrl(lost.id), async route => { await route.fetch(); await route.abort(); }, { times: 1 });
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await prompt.getByRole('alert').getByText(/无法连接服务器/).waitFor();
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
      await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
      assert.equal(app.services.taskStudyService.details(lost.id).total_seconds, 600);
      assert.equal(app.services.taskStudyService.details(lost.id).sessions.length, 2);
      console.log(`PASS ${width}/${theme}: retrying a committed addition after a lost response never duplicates time`);

      for (const task of [fractional, fractionalEmpty]) {
        study = await openTask(task.title);
        await study.getByRole('button', { name: '完成任务', exact: true }).click();
        await prompt.locator('input[type=number]').fill('5.5');
        assert.equal(await prompt.getByRole('slider').inputValue(), '330', 'the actual thumb value matches fractional minutes');
        await prompt.locator('output').getByText('5 分 30 秒', { exact: true }).waitFor();
        await prompt.getByRole('button', { name: '完成', exact: true }).click();
        await study.getByText('✓ 任务已完成', { exact: true }).waitFor();
        const details = app.services.taskStudyService.details(task.id);
        assert.equal(details.total_seconds, 330);
        assert.equal(details.sessions[0].duration_seconds, task.id === fractional.id ? 210 : 330);
      }
      console.log(`PASS ${width}/${theme}: fractional minutes match the slider, label and saved seconds with or without previous time`);
    } finally { await context.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
