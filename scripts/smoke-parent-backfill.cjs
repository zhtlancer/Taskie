// Build first. Real backfill writes in isolated SQLite, including projected-to-persisted task IDs.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-parent-backfill-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), today = getTodayDate(), yesterday = shiftDate(today, -1), errors = [];
  const api = async (method, url, payload) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`); return response.json();
  };
  browser = await chromium.launch(launchOptions());
  for (const width of [390, 820, 1180]) for (const theme of ['light', 'dark']) {
    const child = await api('POST', '/children', { name: `补卡${width}${theme}` }), other = await api('POST', '/children', { name: `另一个孩子${width}${theme}` });
    db.prepare('UPDATE children SET created_at=? WHERE id IN (?,?)').run(`${shiftDate(today, -10)}T00:00:00Z`, child.id, other.id);
    const title = `口算${'长任务名称'.repeat(8)}`;
    const task = await api('POST', `/children/${child.id}/adhoc-tasks`, { title, subject: '数学', date: yesterday, points: 10, track_time: true });
    const otherTask = await api('POST', `/children/${other.id}/adhoc-tasks`, { title: '另一个孩子的任务', subject: '其他', date: yesterday, points: 3, track_time: true });
    const template = await api('POST', '/task-templates', { title: '推算计时任务', subject: '语文', points: 10, track_time: true, days_of_week: [0,1,2,3,4,5,6], child_ids: [child.id] });
    db.prepare('UPDATE task_templates SET created_at=? WHERE id=?').run(`${shiftDate(today, -10)}T00:00:00Z`, template.id);
    const context = await browser.newContext({ viewport: { width, height: width === 1180 ? 820 : 1100 }, colorScheme: theme, hasTouch: true, timezoneId: 'Pacific/Honolulu', locale: 'zh-CN', reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({token, theme}) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      const url = id => `/parent/children/${id}/backfill`;
      const go = () => page.goto(`${base}${url(child.id)}`, { waitUntil: 'networkidle' });
      const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
      const card = name => page.locator('[data-backfill-task]').filter({ has: page.getByRole('heading', { name, exact: false }) });
      const actual = card(title), projected = card('推算计时任务'), picker = page.getByLabel('任务日期', { exact: true });
      const readUrl = '**/api/daily-tasks/backfill?*', completeUrl = `**/api/daily-tasks/${task.id}/backfill`;
      const readError = page.locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name: '补卡任务未能读取', exact: true }) });
      const confirm = () => page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
      let writes = 0;
      page.on('request', request => { if (request.method() === 'POST' && /\/daily-tasks\/.+\/(backfill|undo-backfill|skip|unskip)$/.test(new URL(request.url()).pathname)) writes++; });
      await page.route(readUrl, route => route.fulfill({ status: 503, json: { error: '读取暂时失败' } }));
      await go(); await readError.waitFor();
      assert.equal(await page.getByRole('heading', { name: '当天没有需要完成的任务', exact: true }).count(), 0);
      await page.unroute(readUrl); await readError.getByRole('button', { name: '重新读取', exact: true }).click();
      await actual.locator('input[type=number]').waitFor();
      assert.equal(await picker.getAttribute('max'), yesterday); assert.equal(await picker.inputValue(), yesterday);
      await picker.fill(shiftDate(today, -40));
      await page.getByRole('heading', { name: '当天没有需要完成的任务', exact: true }).waitFor();
      assert.ok((await page.getByRole('link', { name: '查看长期任务', exact: true }).getAttribute('href')).includes(child.id));
      await picker.fill(today); await readError.getByText('请选择早于今天的有效日期', { exact: true }).waitFor();
      await picker.fill(yesterday); await actual.locator('input[type=number]').fill('23');
      await actual.getByRole('button', { name: '补记完成', exact: true }).click();
      assert.equal(await picker.isDisabled(), true);
      await actual.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(await page.getByRole('dialog').count(), 1);
      await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await actual.locator('input[type=number]').inputValue(), '23'); assert.equal(writes, 0);
      await page.route(completeUrl, route => route.fulfill({ status: 400, json: { error: '补记暂时未保存' } }));
      await actual.getByRole('button', { name: '补记完成', exact: true }).click(); await confirm();
      await page.getByRole('alert').getByText('补记暂时未保存', { exact: true }).waitFor();
      await actual.locator('input[type=number]').waitFor(); assert.equal(await actual.locator('input[type=number]').inputValue(), '23');
      await page.unroute(completeUrl);
      let release, arrive; const gate = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { arrive = resolve; });
      await page.route(completeUrl, async route => { const response = await route.fetch(); assert.equal(response.status(), 200); arrive(); await gate; await route.fulfill({ response }); });
      try {
        await actual.getByRole('button', { name: '补记完成', exact: true }).click(); await confirm(); await arrived;
        assert.equal(await picker.isDisabled(), true); assert.equal(await actual.locator('input[type=number]').isDisabled(), true);
        const before = page.url(), beforeWrites = writes;
        await page.getByRole('navigation', { name: '家长导航' }).getByRole('link', { name: '学习安排', exact: true }).evaluate(link => link.click());
        await push(url(other.id)); assert.equal(page.url(), before);
        await actual.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(writes, beforeWrites);
        await page.route(readUrl, route => route.fulfill({ status: 503, json: { error: '操作已保存，列表暂时不可用' } }));
        release(); await page.getByRole('status').filter({ hasText: '已保存' }).waitFor(); await readError.waitFor();
        assert.equal(await page.getByRole('heading', { name: '当天没有需要完成的任务', exact: true }).count(), 0);
      } finally { release(); await page.unroute(completeUrl); }
      assert.equal(db.prepare('SELECT duration_seconds FROM daily_tasks WHERE id=?').get(task.id).duration_seconds, 1380);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM task_backfill_events WHERE daily_task_id=?').get(task.id).n, 1);
      assert.equal(db.prepare('SELECT activity_date FROM point_logs WHERE daily_task_id=?').get(task.id).activity_date, yesterday);
      await page.unroute(readUrl); await readError.getByRole('button', { name: '重新读取', exact: true }).click();
      await actual.getByRole('button', { name: '撤销补卡', exact: true }).click(); await confirm();
      await actual.locator('input[type=number]').waitFor(); assert.equal(await actual.locator('input[type=number]').inputValue(), '');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM task_backfill_events WHERE daily_task_id=?').get(task.id).n, 2);
      await actual.locator('input[type=number]').fill('17');
      await actual.getByRole('button', { name: '标记跳过', exact: true }).click();
      await page.getByRole('dialog', { name: '填写原因', exact: true }).getByLabel('原因', { exact: true }).fill('本轮验收请假');
      await page.keyboard.press('Enter'); await actual.getByRole('button', { name: '撤销跳过', exact: true }).click(); await confirm();
      await actual.locator('input[type=number]').waitFor(); assert.equal(await actual.locator('input[type=number]').inputValue(), '17');
      const controls = await page.locator('main button, main input, main a').evaluateAll(items => items.filter(item => item.getClientRects().length).map(item => {
        const r = item.getBoundingClientRect(); return { label: item.textContent || item.getAttribute('type'), h: r.height, left: r.left, right: r.right };
      }));
      for (const control of controls) assert.ok(control.h >= 44 && control.left >= 0 && control.right <= width + 1, JSON.stringify(control));
      await page.evaluate(() => document.documentElement.style.fontSize = '24px');
      assert.ok(await picker.evaluate(input => { const r = input.getBoundingClientRect(), p = input.parentElement.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1; }));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; scrollTo(0, 0); });
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `backfill-${width}-${theme}.png`), fullPage: true }); }

      const past = shiftDate(today, -2); await picker.fill(past); await projected.locator('input[type=number]').fill('13');
      const failProjection = route => route.fulfill({ status: 400, json: { error: '生成任务后补记失败' } });
      await page.route('**/api/daily-tasks/*/backfill', failProjection);
      await projected.getByRole('button', { name: '补记完成', exact: true }).click(); await confirm();
      await page.getByRole('alert').getByText('生成任务后补记失败', { exact: true }).waitFor();
      await projected.locator('input[type=number]').waitFor(); assert.equal(await projected.locator('input[type=number]').inputValue(), '13');
      assert.ok(!(await projected.getAttribute('data-backfill-task')).startsWith('unopened:'));
      await page.unroute('**/api/daily-tasks/*/backfill', failProjection);
      await projected.getByRole('button', { name: '补记完成', exact: true }).click(); await confirm();
      await projected.getByRole('button', { name: '撤销补卡', exact: true }).waitFor();
      const saved = db.prepare('SELECT id,duration_seconds FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').all(child.id, past, template.id);
      assert.equal(saved.length, 1); assert.equal(saved[0].duration_seconds, 780);

      await picker.fill(shiftDate(today, -3)); await projected.locator('input[type=number]').fill('5');
      await projected.getByRole('button', { name: '补记完成', exact: true }).click();
      db.prepare('UPDATE task_templates SET points=25 WHERE id=?').run(template.id);
      const beforeChanged = writes; await confirm();
      await page.getByRole('alert').filter({ hasText: '当天的任务已变化' }).waitFor();
      await projected.locator('input[type=number]').waitFor(); assert.equal(await projected.locator('input[type=number]').inputValue(), '5');
      assert.equal(writes, beforeChanged, 'changed projected rewards require a new confirmation before completion');
      await projected.getByRole('button', { name: '补记完成', exact: true }).click(); await confirm();
      await projected.getByRole('button', { name: '撤销补卡', exact: true }).waitFor();
      const changed = db.prepare('SELECT earned_points FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, shiftDate(today, -3), template.id);
      assert.equal(changed.earned_points, 25);

      await picker.fill(yesterday); await actual.locator('input[type=number]').fill('9');
      await actual.getByRole('button', { name: '补记完成', exact: true }).click();
      const beforeSwitch = writes; await push(url(other.id));
      await page.getByRole('heading', { name: `${other.name} · 家长补卡`, exact: true }).waitFor();
      await card(otherTask.title).locator('input[type=number]').waitFor();
      assert.equal(await page.getByRole('dialog').count(), 0); assert.equal(writes, beforeSwitch);
      assert.equal(await card(otherTask.title).locator('input[type=number]').inputValue(), '');
      assert.equal(await actual.count(), 0);

      // A duration typed before another device starts keeping sessions must not be sent as a hidden old value.
      await card(otherTask.title).locator('input[type=number]').fill('37');
      const managed = otherTask;
      await api('POST', `/daily-tasks/${managed.id}/sessions`, { request_id: `backfill-${width}-${theme}`, date: yesterday, duration_seconds: 120 });
      await card(otherTask.title).getByRole('button', { name: '学习记录 / 补记用时', exact: true }).click();
      await page.getByRole('dialog', { name: '分次学习', exact: true }).getByText(/1 次学习/).first().waitFor();
      await page.getByRole('dialog', { name: '分次学习', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
      const managedCard = card(otherTask.title); await managedCard.getByText(/已保存 1 次学习/).waitFor();
      assert.equal(await managedCard.locator('input[type=number]').count(), 0);
      await managedCard.getByRole('button', { name: '学习记录 / 补记用时', exact: true }).click();
      await page.getByRole('dialog', { name: '分次学习', exact: true }).getByText(/1 次学习/).first().waitFor();
      await page.getByRole('dialog', { name: '分次学习', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
      await managedCard.getByRole('button', { name: '补记完成', exact: true }).click(); await confirm();
      await managedCard.getByRole('button', { name: '撤销补卡', exact: true }).waitFor();
      const detail = await api('GET', `/daily-tasks/${managed.id}/study`); assert.equal(detail.total_seconds, 120); assert.equal(detail.sessions.length, 1);
      if (width === 390 && theme === 'light') {
        await push(url(child.id)); await actual.locator('input[type=number]').fill('9');
        await actual.getByRole('button', { name: '补记完成', exact: true }).click();
        const beforeRestore = writes;
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await actual.locator('input[type=number]').waitFor(); await confirm();
        await page.getByRole('alert').filter({ hasText: '当前孩子、日期或任务已变化' }).waitFor();
        assert.equal(writes, beforeRestore, 'a restore invalidates a pending confirmation even for the same child/day');
        let oldArrived, resumeOld;
        const arrivedOld = new Promise(resolve => { oldArrived = resolve; }), oldGate = new Promise(resolve => { resumeOld = resolve; });
        const older = shiftDate(today, -4);
        const stale = async route => {
          if (new URL(route.request().url()).searchParams.get('date') !== older) return route.continue();
          await route.fetch(); oldArrived(); await oldGate;
          await route.fulfill({ status: 503, json: { error: '旧日期读取失败' } });
        };
        await page.route(readUrl, stale);
        try {
          await picker.fill(older); await arrivedOld; await picker.fill(yesterday);
          await actual.locator('input[type=number]').fill('19'); resumeOld();
          await page.waitForTimeout(50);
          assert.equal(await picker.inputValue(), yesterday); assert.equal(await actual.locator('input[type=number]').inputValue(), '19');
          assert.equal(await readError.count(), 0);
        } finally { resumeOld(); await page.unroute(readUrl, stale); }
        await page.clock.install({ time: new Date(`${today}T15:59:58Z`) });
        await go(); await actual.locator('input[type=number]').fill('11');
        await page.clock.runFor(3000);
        assert.equal(await picker.getAttribute('max'), today);
        assert.equal(await picker.inputValue(), yesterday, 'business midnight preserves a date with a duration draft');
        assert.equal(await actual.locator('input[type=number]').inputValue(), '11');
        console.log('PASS restore invalidation, late date errors and family-midnight draft retention');
      }
      console.log(`PASS ${width}/${theme}: read/empty/retry states, retained minutes across materialization, accepted writes vs refresh failures, guarded confirmation/navigation, changed rewards, managed sessions and touch layout`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
