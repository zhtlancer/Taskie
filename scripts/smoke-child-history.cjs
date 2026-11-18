// Build first. Real API and isolated SQLite; device and family clocks deliberately differ.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
process.env.TIME_ZONE = 'Asia/Shanghai';
const RealDate = Date, before = RealDate.parse('2026-11-22T15:59:00Z'), after = before + 120000;
let now = before;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-child-history-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;

async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), today = getTodayDate(), errors = [];
  const api = async (method, url, payload, owner = token) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${owner}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };

  for (const width of [320, 390, 820, 1024, 1180]) for (const theme of ['light', 'dark']) {
    now = before;
    browser = await chromium.launch(launchOptions());
    const child = await api('POST', '/children', { name: `历史甲${width}${theme}` });
    const other = await api('POST', '/children', { name: `历史乙${width}${theme}` });
    const empty = await api('POST', '/children', { name: `空历史${width}${theme}` });
    db.prepare('UPDATE children SET created_at=? WHERE id IN (?,?,?)').run(`${shiftDate(today, -20)}T00:00:00Z`, child.id, other.id, empty.id);

    const longTitle = `口算练习${'长任务名称'.repeat(6)}`;
    // Regular weekday task active on today (Sun, day 0), -1 (Sat, day 6), -3 (Thu, day 4), -8 (prev Sat, day 6), -14 (prev Sun) — off on -2 (Fri, day 5) for rest day.
    const timedTpl = await api('POST', '/task-templates', {
      title: longTitle, subject: '数学', points: 10, track_time: true, days_of_week: [0, 4, 6], child_ids: [child.id]
    });
    const weeklyTpl = await api('POST', '/task-templates', {
      title: `每周阅读${'加长名字'.repeat(4)}`, subject: '语文', points: 10, schedule_type: 'weekly_times',
      weekly_target_times: 1, extra_points: 4, extra_reward_limit: 5, allow_extra: true, child_ids: [child.id]
    });
    db.prepare('UPDATE task_templates SET created_at=? WHERE id IN (?,?)').run(`${shiftDate(today, -20)}T00:00:00Z`, timedTpl.id, weeklyTpl.id);

    // Seed previous period (-8d: 20 min) so improvements report "+10 min faster", plus yesterday backfill (10 min) and missing-duration task.
    const oldStart = shiftDate(today, -8);
    await api('POST', `/daily-tasks/backfill/day`, { child_id: child.id, date: oldStart });
    const oldTimed = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, oldStart, timedTpl.id);
    await api('POST', `/daily-tasks/${oldTimed.id}/backfill`, { duration_seconds: 1200 });

    const yesterday = shiftDate(today, -1);
    await api('POST', '/daily-tasks/backfill/day', { child_id: child.id, date: yesterday });
    const backfilled = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, yesterday, timedTpl.id);
    await api('POST', `/daily-tasks/${backfilled.id}/backfill`, { duration_seconds: 600 });

    // Today's board: complete weekly task twice across yesterday & today to exercise extra completion, plus one untimed missing-time completion.
    const yesterdayWeekly = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, yesterday, weeklyTpl.id);
    await api('POST', `/daily-tasks/${yesterdayWeekly.id}/backfill`, { duration_seconds: null });
    const todayTasks = await api('GET', `/daily-tasks?child_id=${child.id}&date=${today}`);
    const todayWeekly = todayTasks.find(t => t.template_id === weeklyTpl.id);
    const todayTimed = todayTasks.find(t => t.template_id === timedTpl.id);
    await api('POST', `/daily-tasks/${todayWeekly.id}/complete`, {});
    await api('POST', `/daily-tasks/${todayTimed.id}/complete`, { duration_seconds: 600 });

    // Other child has distinct history so cross-child isolation is clear.
    const otherTask = await api('POST', `/children/${other.id}/adhoc-tasks`, { title: '历史乙独立任务', subject: '英语', date: today, points: 5 });
    await api('POST', `/daily-tasks/${otherTask.id}/complete`, {});

    // Goal with cumulative logs.
    const goal = await api('POST', `/children/${child.id}/goals`, {
      title: `整本书阅读${'长目标名称'.repeat(3)}`, subject: '语文', mode: 'progress',
      total_amount: 100, unit: '页', start_date: shiftDate(today, -6), end_date: shiftDate(today, 7)
    });
    await api('POST', `/period-tasks/${goal.id}/logs`, { request_id: `goal-y-${width}-${theme}`, date: yesterday, amount: 20 });

    const open = async (owner = token, role = 'parent') => {
      now = before;
      const context = await browser.newContext({
        viewport: { width, height: width < 500 ? 844 : 1024 },
        colorScheme: theme, hasTouch: true, timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block', reducedMotion: 'reduce'
      });
      await context.addInitScript(({ owner, other, theme, role }) => {
        sessionStorage.setItem(`taskie_${role}_token`, owner);
        // Deliberately store a different child in shared store to prove route owns the loaded child.
        sessionStorage.setItem('current_child', JSON.stringify(other));
        localStorage.setItem('taskie_theme', theme);
        localStorage.setItem('app_sound_muted', 'true');
      }, { owner, other, theme, role });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', err => errors.push(err.message));
      await page.clock.install({ time: new RealDate(before) });
      await page.clock.pauseAt(new RealDate(before));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      return { context, page };
    };

    const { context, page } = await open();
    try {
      const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
      const resume = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      const state = name => page.locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name, exact: true }) });
      const fail = route => route.fulfill({ status: 503, json: { error: '本轮模拟读取失败' } });
      const hold = async (pattern, failure = false) => {
        let release, arrive, finish, count = 0;
        const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrive = resolve; }), done = new Promise(resolve => { finish = resolve; });
        const handler = async route => {
          count++; const response = await route.fetch(); arrive(); await gate;
          try { await route.fulfill(failure ? { status: 503, json: { error: '旧请求延迟失败' } } : { response }); }
          catch (err) { if (!/closed|canceled|cancelled|Invalid Interception/i.test(err.message)) throw err; }
          finally { finish(); }
        };
        await page.route(pattern, handler);
        return { release, done, handler, count: () => count, started: async () => {
          let timer;
          try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`request did not start: ${pattern}`)), 12000); })]); }
          finally { clearTimeout(timer); }
        } };
      };

      const historyUrl = `**/api/children/${child.id}/history?*`;
      const weeklyUrl = `**/api/children/${child.id}/weekly-summary`;
      const goalsUrl = `**/api/children/${child.id}/goals`;
      const timeUrl = `**/api/children/${child.id}/time-stats`;

      // All four endpoints fail independently: no zero fallbacks, no hidden time section, no global toast flood.
      for (const pattern of [historyUrl, weeklyUrl, goalsUrl, timeUrl]) await page.route(pattern, fail);
      await page.goto(`${base}/child/${child.id}/history`, { waitUntil: 'networkidle' });
      for (const title of ['学习历史未能读取', '本周完成度未能读取', '长期任务未能读取', '作业用时未能读取']) await state(title).waitFor();
      assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0);
      assert.equal(await page.locator('[data-history-card="tasks"]').getByText('0 项').count(), 0);
      assert.equal(await page.locator('[data-history-card="points"]').getByText('0 分').count(), 0);

      // Recovering only history and weekly keeps goals and time independently errored while displaying cards, chart, weekly extra details, backfill & rest/unopened days.
      await page.unroute(historyUrl, fail); await state('学习历史未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.unroute(weeklyUrl, fail); await state('本周完成度未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.getByText('11月22日 (周日)').waitFor();
      assert.equal(await page.locator('[data-history-card="tasks"]').getByText('3 项').count(), 1);
      assert.equal(await page.locator('[data-history-card="points"]').getByText('34 分').count(), 1);
      await page.locator('[data-history-section="history"]').getByText('含家长补记', { exact: false }).first().waitFor();
      await page.locator('[data-history-section="history"]').getByText('休息日', { exact: false }).first().waitFor();
      await page.locator('[data-history-section="history"]').getByText('当天没有打开 App', { exact: false }).first().waitFor();
      await page.locator('[data-history-section="weekly"]').getByText(/额外 1 次/).waitFor();
      await page.locator('[data-history-section="weekly"]').getByText(/目标内 \+10 分 · 额外 \+4 分/).waitFor();
      assert.equal(await state('长期任务未能读取').count(), 1);
      assert.equal(await state('作业用时未能读取').count(), 1);

      await page.unroute(goalsUrl, fail); await state('长期任务未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.locator('[data-history-section="goals"]').getByText(goal.title, { exact: true }).waitFor();
      await page.unroute(timeUrl, fail); await state('作业用时未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      const timeSection = page.locator('[data-history-section="time"]');
      await timeSection.getByText(`👍 ${longTitle} 平均比之前快了 10 分钟`, { exact: true }).waitFor();
      assert.equal(await timeSection.getByText(/估算|超时/).count(), 0);
      await timeSection.getByRole('button', { name: '📋 看表格', exact: true }).click();
      assert.equal(await timeSection.getByRole('columnheader', { name: '含估算', exact: true }).count(), 0);
      await timeSection.getByRole('button', { name: '📊 看图', exact: true }).click();

      // Same-scope refresh retains known content while loading and surfaces refresh errors without wiping data.
      const heldHistory = await hold(historyUrl, true);
      try {
        await resume(); await heldHistory.started();
        await page.locator('[data-history-section="history"]').getByText('正在更新学习历史，当前显示上次读取的数据。', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-history-card="tasks"]').getByText('3 项').count(), 1);
        heldHistory.release(); await heldHistory.done;
        await state('学习历史未能读取').waitFor();
        assert.equal(await page.locator('[data-history-card="tasks"]').getByText('3 项').count(), 1);
      } finally { heldHistory.release(); if (!page.isClosed()) await page.unroute(historyUrl, heldHistory.handler); }
      await resume(); await state('学习历史未能读取').waitFor({ state: 'detached' });

      // Layout check across phone and tablet breakpoints.
      const controls = await page.locator('[data-history-page] button, [data-history-page] a').evaluateAll(items =>
        items.filter(el => el.getClientRects().length).map(el => {
          const r = el.getBoundingClientRect();
          return { label: el.textContent.trim(), width: r.width, height: r.height, left: r.left, right: r.right };
        })
      );
      for (const control of controls) assert.ok(control.height >= 44 && control.width >= 44 && control.left >= 0 && control.right <= width + 1, JSON.stringify(control));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits viewport width');
      if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `history-${width}-${theme}.png`), fullPage: true });
      }

      // Old child errors/responses must never leak into the newly selected child.
      const oldTime = await hold(timeUrl, true);
      try {
        await resume(); await oldTime.started();
        await push(`/child/${other.id}/history`);
        await page.locator('[data-history-card="tasks"]').getByText('1 项').waitFor();
        await page.locator('[data-history-card="points"]').getByText('5 分').waitFor();
        await page.locator('[data-history-section="weekly"]').getByText('历史乙独立任务').waitFor();
        await page.locator('[data-history-section="goals"]').getByText('最近没有带进度的长期任务').waitFor();
        await page.locator('[data-history-section="time"]').getByText('近 7 天还没有记录到作业用时').waitFor();
        oldTime.release(); await oldTime.done;
        assert.equal(await state('作业用时未能读取').count(), 0);
        assert.equal(await page.getByText(goal.title).count(), 0);
      } finally { oldTime.release(); if (!page.isClosed()) await page.unroute(timeUrl, oldTime.handler); }

      // Real empty child stays cleanly distinct from failed reads.
      await push(`/child/${empty.id}/history`);
      await page.locator('[data-history-card="tasks"]').getByText('0 项').waitFor();
      await page.locator('[data-history-section="weekly"]').getByText('本周还没有任务安排').waitFor();
      await page.locator('[data-history-section="goals"]').getByText('最近没有带进度的长期任务').waitFor();
      await page.locator('[data-history-section="time"]').getByText('近 7 天还没有记录到作业用时').waitFor();
      assert.equal(await page.locator('[data-page-state=error]').count(), 0);

      // Family midnight and week rollover keep family dates even when device timezone says Sunday.
      if (width === 390 && theme === 'light') {
        await push(`/child/${child.id}/history`);
        await page.locator('[data-history-card="tasks"]').getByText('3 项').waitFor();
        const oldDayHistory = await hold(historyUrl, true);
        try {
          await resume(); await oldDayHistory.started();
          await page.unroute(historyUrl, oldDayHistory.handler);
          now = after;
          await page.clock.fastForward(120000);
          await page.getByText('11月23日 (周一)').waitFor();
          assert.equal(await page.evaluate(() => new Date().getDay()), 0, 'device remains Sunday while family rolled into Monday');
          oldDayHistory.release(); await oldDayHistory.done;
          assert.equal(await state('学习历史未能读取').count(), 0);
        } finally { oldDayHistory.release(); if (!page.isClosed()) await page.unroute(historyUrl, oldDayHistory.handler); }

        // Restore event clears and re-fetches current data cleanly.
        const extraTask = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '恢复后新积分', subject: '数学', date: '2026-11-23', points: 6 });
        await api('POST', `/daily-tasks/${extraTask.id}/complete`, {});
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await page.locator('[data-history-card="points"]').getByText('40 分').waitFor();
      }
      console.log(`PASS ${width}px ${theme}: independent reads/retries, metrics isolation, real/rest/extra/backfill semantics, stale scope & layout`);
    } finally {
      await context.close();
      await browser.close();
      browser = undefined;
    }
    await api('DELETE', `/children/${child.id}`); await api('DELETE', `/children/${other.id}`); await api('DELETE', `/children/${empty.id}`);
    await api('DELETE', `/task-templates/${timedTpl.id}`); await api('DELETE', `/task-templates/${weeklyTpl.id}`);
  }

  // Unknown family timezone gate and child-role permission boundary.
  const childA = await api('POST', '/children', { name: '历史权限甲' });
  const childB = await api('POST', '/children', { name: '历史权限乙' });
  const childToken = (await app.inject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: childA.id } })).json().token;
  browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block' });
  try {
    await ctx.addInitScript(({ childToken, childA }) => {
      sessionStorage.setItem('taskie_child_token', childToken);
      sessionStorage.setItem('current_child', JSON.stringify(childA));
      localStorage.setItem('taskie_theme', 'dark'); localStorage.setItem('app_sound_muted', 'true');
    }, { childToken, childA });
    const page = await ctx.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', err => errors.push(err.message));
    let reads = 0;
    page.on('request', req => {
      const pathname = new URL(req.url()).pathname;
      if (pathname.startsWith('/api/children/') && /\/(history|weekly-summary|goals|time-stats)$/.test(pathname)) reads++;
    });
    const failCal = route => route.fulfill({ status: 503, json: { error: '暂时无法读取家庭日期' } });
    await page.route('**/api/calendar', failCal);
    await page.goto(`${base}/child/${childA.id}/history`, { waitUntil: 'networkidle' });
    await page.getByText('等待确认家庭日期…', { exact: true }).waitFor();
    assert.equal(reads, 0, 'unknown family zone waits before reading history endpoints');
    await page.unroute('**/api/calendar', failCal);
    await page.getByRole('button', { name: '重新读取家庭时区', exact: true }).click();
    await page.locator('[data-history-card="tasks"]').getByText('0 项').waitFor();
    assert.ok(reads >= 4);
    for (const ep of ['history', 'weekly-summary', 'goals', 'time-stats']) {
      const forbidden = await app.inject({ method: 'GET', url: `/api/children/${childB.id}/${ep}`, headers: { authorization: `Bearer ${childToken}` } });
      assert.equal(forbidden.statusCode, 403);
    }
    console.log('PASS family timezone gate, child read permission and sibling isolation');
  } finally { await ctx.close(); }

  assert.deepEqual(errors, []);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
