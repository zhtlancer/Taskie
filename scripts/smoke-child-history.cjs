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

const chartSeries = {
  time: { colors: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'], minPixels: 100 },
  goals: { colors: ['#6366f1'], minPixels: 8 },
  history: { colors: ['#10b981', '#6c63ff', '#ffd93d'], minPixels: 100 }
};

async function assertChartsPainted(page, expectedCount) {
  await page.clock.runFor(1500);
  const stats = await page.locator('[data-history-page] canvas').evaluateAll((canvases, series) => canvases.map(canvas => {
    const section = canvas.closest('[data-history-section]')?.dataset.historySection;
    const palette = (series[section]?.colors || []).map(hex => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)));
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let totalPainted = 0, interiorPainted = 0, seriesPixels = 0;
    const colors = new Set();
    // Sample inside the plot, away from the top legend and the bottom/left tick labels.
    // Goal progress must use its own purple line; the orange planned line is insufficient.
    const minX = Math.floor(w * 0.15), maxX = Math.ceil(w * 0.95);
    const minY = Math.floor(h * 0.25), maxY = Math.ceil(h * 0.85);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] <= 20) continue;
        totalPainted++;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
          interiorPainted++;
          if (data[idx + 3] >= 200 && palette.some(rgb => rgb.every((value, channel) => Math.abs(data[idx + channel] - value) <= 8))) seriesPixels++;
        }
        if (colors.size < 16) colors.add(`${data[idx] >> 4},${data[idx + 1] >> 4},${data[idx + 2] >> 4}`);
      }
    }
    return {
      section, aria: canvas.getAttribute('aria-label') || '',
      cssW: rect.width, cssH: rect.height, w, h,
      totalPainted, interiorPainted, seriesPixels, colors: colors.size
    };
  }), chartSeries);
  assert.equal(stats.length, expectedCount, `expected ${expectedCount} charts: ${JSON.stringify(stats)}`);
  for (const chart of stats) {
    assert.ok(chart.cssW >= 120 && chart.cssH >= 120 && chart.w > 0 && chart.h > 0, JSON.stringify(chart));
    assert.ok(chart.totalPainted > 200 && chart.interiorPainted > 50 && chart.colors >= 3, `blank/unpainted chart canvas: ${JSON.stringify(chart)}`);
    assert.ok(chartSeries[chart.section] && chart.seriesPixels >= chartSeries[chart.section].minPixels,
      `missing plotted data: ${chart.section}: ${JSON.stringify(chart)}`);
  }
  return stats;
}

async function assertEmptySeriesRejected() {
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext();
  try {
    for (const theme of ['light', 'dark']) {
      const page = await context.newPage();
      try {
        await page.clock.install({ time: new RealDate(before) });
        await page.clock.pauseAt(new RealDate(before));
        await page.setContent(`<div data-history-page>${Object.keys(chartSeries).map(section =>
          `<section data-history-section="${section}" style="width:350px;height:260px"><canvas></canvas></section>`).join('')}</div>`);
        await page.addScriptTag({ path: path.resolve(__dirname, '../frontend/node_modules/chart.js/dist/chart.umd.js') });
        await page.evaluate(theme => {
          const ink = theme === 'dark'
            ? { grid: '#293548', axis: '#475569', muted: '#a8b5c9' }
            : { grid: '#e1e0d9', axis: '#c3c2b7', muted: '#64748b' };
          document.body.style.background = theme === 'dark' ? '#111827' : '#ffffff';
          const configs = {
            time: { type: 'bar', datasets: [{ label: '数学', data: [20, 50, 80], backgroundColor: '#eb6834' }] },
            goals: { type: 'line', datasets: [
              { label: '实际进度', data: [10, 25, 40], borderColor: '#6366f1', backgroundColor: '#6366f1' },
              { label: '计划进度', data: [20, 40, 60], borderColor: '#f59e0b', backgroundColor: '#f59e0b' }
            ] },
            history: { type: 'bar', datasets: [{ label: '完成率', data: [20, 50, 100], backgroundColor: '#10b981' }] }
          };
          window.chartFixtures = {};
          for (const [section, config] of Object.entries(configs)) {
            window.chartFixtures[section] = new Chart(document.querySelector(`[data-history-section="${section}"] canvas`), {
              type: config.type, data: { labels: ['11/20', '11/21', '11/22'], datasets: config.datasets },
              options: {
                responsive: true, maintainAspectRatio: false,
                // Keep colored legends present so they cannot satisfy the plot assertion.
                plugins: { legend: { display: true, labels: { color: ink.muted } } },
                scales: {
                  x: { ticks: { color: ink.muted }, grid: { display: false }, border: { color: ink.axis } },
                  y: { min: 0, max: 100, ticks: { color: ink.muted }, grid: { color: ink.grid }, border: { color: ink.axis } }
                }
              }
            });
          }
        }, theme);
        await assertChartsPainted(page, 3);
        for (const section of Object.keys(chartSeries)) {
          const values = await page.evaluate(section => {
            const chart = window.chartFixtures[section], dataset = chart.data.datasets[0];
            const previous = [...dataset.data];
            dataset.data = dataset.data.map(() => null);
            chart.update('none');
            return previous;
          }, section);
          await assert.rejects(() => assertChartsPainted(page, 3),
            error => error.code === 'ERR_ASSERTION' && error.message.startsWith(`missing plotted data: ${section}:`),
            `${theme} ${section}: axes, colored legends and the planned line must not pass for missing actual data`);
          await page.evaluate(({ section, values }) => {
            const chart = window.chartFixtures[section];
            chart.data.datasets[0].data = values;
            chart.update('none');
          }, { section, values });
          await assertChartsPainted(page, 3);
        }
        console.log(`PASS ${theme}: each missing data series fails despite axes, colored legends and planned progress`);
      } finally { await page.close(); }
    }
  } finally {
    await context.close();
    await browser.close();
    browser = undefined;
  }
}

function attachHelpers(page, base) {
  const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
  const resume = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  const state = name => page.locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const fail = route => route.fulfill({ status: 503, json: { error: '本轮模拟读取失败' } });
  const hold = async (pattern, failure = false) => {
    let release, arrive, finish, count = 0;
    const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrive = resolve; }), done = new Promise(resolve => { finish = resolve; });
    const handler = async route => {
      count++;
      let fetched = null;
      try { fetched = await route.fetch(); }
      catch { fetched = null; }
      arrive(); await gate;
      try {
        if (failure) await route.fulfill({ status: 503, json: { error: '旧请求延迟失败' } });
        else if (fetched) await route.fulfill({ response: fetched });
        else await route.abort();
      } catch (err) {
        if (!/closed|canceled|cancelled|Invalid Interception/i.test(err.message)) throw err;
      } finally { finish(); }
    };
    await page.route(pattern, handler);
    return { release, done, handler, count: () => count, started: async () => {
      let timer;
      try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`request did not start: ${pattern}`)), 12000); })]); }
      finally { clearTimeout(timer); }
    } };
  };
  let apiReads = 0, pageExclusiveReads = 0;
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === base && u.pathname.startsWith('/api/children/')) {
      if (/\/(history|weekly-summary|goals|time-stats)$/.test(u.pathname)) apiReads++;
      if (/\/(history|weekly-summary|time-stats)$/.test(u.pathname)) pageExclusiveReads++;
    }
  });
  return {
    push, resume, state, fail, hold,
    reads: () => apiReads,
    exclusiveReads: () => pageExclusiveReads,
    resetReads: () => { apiReads = 0; pageExclusiveReads = 0; }
  };
}

async function openContext(base, width, theme, owner, seedChild, role = 'parent', errors = []) {
  now = before;
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 1024 },
    colorScheme: theme, hasTouch: true, timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block', reducedMotion: 'reduce'
  });
  await context.addInitScript(({ owner, seedChild, theme, role }) => {
    if (owner) sessionStorage.setItem(`taskie_${role}_token`, owner);
    if (seedChild) sessionStorage.setItem('current_child', JSON.stringify(seedChild));
    localStorage.setItem('taskie_theme', theme);
    localStorage.setItem('app_sound_muted', 'true');
  }, { owner, seedChild, theme, role });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', err => errors.push(err.message));
  await page.clock.install({ time: new RealDate(before) });
  await page.clock.pauseAt(new RealDate(before));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return { context, page };
}

async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), today = getTodayDate(), errors = [];
  const api = async (method, url, payload, owner = token) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${owner}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };

  await assertEmptySeriesRejected();

  for (const width of [320, 390, 820, 1024, 1180]) for (const theme of ['light', 'dark']) {
    now = before;
    browser = await chromium.launch(launchOptions());
    const child = await api('POST', '/children', { name: `历史甲${width}${theme}` });
    const other = await api('POST', '/children', { name: `历史乙${width}${theme}` });
    const empty = await api('POST', '/children', { name: `空历史${width}${theme}` });
    db.prepare('UPDATE children SET created_at=? WHERE id IN (?,?,?)').run(`${shiftDate(today, -20)}T00:00:00Z`, child.id, other.id, empty.id);

    const longTitle = `口算练习${'长任务名称'.repeat(6)}`;
    // Regular weekday task active on today (Sun, day 0), -1 (Sat, day 6), -3 (Thu, day 4), -8 (prev Sat, day 6) — off on -2 (Fri, day 5) for rest day.
    const timedTpl = await api('POST', '/task-templates', {
      title: longTitle, subject: '数学', points: 10, track_time: true, days_of_week: [0, 4, 6], child_ids: [child.id]
    });
    const weeklyTpl = await api('POST', '/task-templates', {
      title: `每周阅读${'加长名字'.repeat(4)}`, subject: '语文', points: 10, schedule_type: 'weekly_times',
      weekly_target_times: 1, extra_points: 4, extra_reward_limit: 5, allow_extra: true, child_ids: [child.id]
    });
    db.prepare('UPDATE task_templates SET created_at=? WHERE id IN (?,?)').run(`${shiftDate(today, -20)}T00:00:00Z`, timedTpl.id, weeklyTpl.id);

    const oldStart = shiftDate(today, -8);
    await api('POST', '/daily-tasks/backfill/day', { child_id: child.id, date: oldStart });
    const oldTimed = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, oldStart, timedTpl.id);
    await api('POST', `/daily-tasks/${oldTimed.id}/backfill`, { duration_seconds: 1200 });

    const yesterday = shiftDate(today, -1);
    await api('POST', '/daily-tasks/backfill/day', { child_id: child.id, date: yesterday });
    const backfilled = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, yesterday, timedTpl.id);
    await api('POST', `/daily-tasks/${backfilled.id}/backfill`, { duration_seconds: 600 });

    const yesterdayWeekly = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(child.id, yesterday, weeklyTpl.id);
    await api('POST', `/daily-tasks/${yesterdayWeekly.id}/backfill`, { duration_seconds: null });
    const todayTasks = await api('GET', `/daily-tasks?child_id=${child.id}&date=${today}`);
    const todayWeekly = todayTasks.find(t => t.template_id === weeklyTpl.id);
    const todayTimed = todayTasks.find(t => t.template_id === timedTpl.id);
    await api('POST', `/daily-tasks/${todayWeekly.id}/complete`, {});
    await api('POST', `/daily-tasks/${todayTimed.id}/complete`, { duration_seconds: 600 });

    const otherTask = await api('POST', `/children/${other.id}/adhoc-tasks`, { title: '历史乙独立任务', subject: '英语', date: today, points: 5 });
    await api('POST', `/daily-tasks/${otherTask.id}/complete`, {});

    const goal = await api('POST', `/children/${child.id}/goals`, {
      title: `整本书阅读${'长目标名称'.repeat(3)}`, subject: '语文', mode: 'progress',
      total_amount: 100, unit: '页', start_date: shiftDate(today, -6), end_date: shiftDate(today, 7)
    });
    await api('POST', `/period-tasks/${goal.id}/logs`, { request_id: `goal-y-${width}-${theme}`, date: yesterday, amount: 20 });

    const { context, page } = await openContext(base, width, theme, token, other, 'parent', errors);
    try {
      const { push, resume, state, hold, reads, exclusiveReads, resetReads } = attachHelpers(page, base);
      const historyUrl = `**/api/children/${child.id}/history?*`;
      const weeklyUrl = `**/api/children/${child.id}/weekly-summary`;
      const goalsUrl = `**/api/children/${child.id}/goals`;
      const timeUrl = `**/api/children/${child.id}/time-stats`;

      // Slow initial requests show placeholders and never show fake zeros; then 4 independent failures appear cleanly.
      const heldInitial = [];
      for (const pattern of [historyUrl, weeklyUrl, goalsUrl, timeUrl]) heldInitial.push({ pattern, h: await hold(pattern, true) });
      try {
        await page.goto(`${base}/child/${child.id}/history`, { waitUntil: 'domcontentloaded' });
        await Promise.all(heldInitial.map(item => item.h.started()));
        for (const title of ['正在读取学习历史…', '正在读取本周完成度…', '正在读取长期任务…', '正在读取作业用时…']) {
          await page.locator('[data-page-state="loading"]').getByText(title, { exact: true }).waitFor();
        }
        assert.match(await page.locator('[data-history-card="tasks"]').textContent(), /—\s*项/);
        assert.match(await page.locator('[data-history-card="points"]').textContent(), /—\s*分/);
        assert.equal(await page.locator('[data-history-card="tasks"]').getByText('0 项').count(), 0);
        assert.equal(await page.locator('[data-history-card="points"]').getByText('0 分').count(), 0);
      } finally {
        for (const item of heldInitial) item.h.release();
        await Promise.all(heldInitial.map(item => item.h.done));
      }

      for (const title of ['学习历史未能读取', '本周完成度未能读取', '长期任务未能读取', '作业用时未能读取']) await state(title).waitFor();
      assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0);
      assert.equal(await page.locator('[data-history-card="tasks"]').getByText('0 项').count(), 0);
      assert.equal(await page.locator('[data-history-card="points"]').getByText('0 分').count(), 0);

      // Recovering only history and weekly keeps goals and time independently errored.
      for (const { pattern, h } of heldInitial.slice(0, 2)) await page.unroute(pattern, h.handler);
      await state('学习历史未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await state('本周完成度未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
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

      for (const { pattern, h } of heldInitial.slice(2)) await page.unroute(pattern, h.handler);
      await state('长期任务未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.locator('[data-history-section="goals"]').getByText(goal.title, { exact: true }).waitFor();
      await state('作业用时未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      const timeSection = page.locator('[data-history-section="time"]');
      await timeSection.getByText(`👍 ${longTitle} 平均比之前快了 10 分钟`, { exact: true }).waitFor();
      assert.equal(await timeSection.getByText(/估算|超时/).count(), 0);
      await timeSection.getByRole('button', { name: '📋 看表格', exact: true }).click();
      assert.equal(await timeSection.getByRole('columnheader', { name: '含估算', exact: true }).count(), 0);
      await timeSection.getByRole('button', { name: '📊 看图', exact: true }).click();

      // Advance paused clock so Chart.js actually draws all 3 charts; verify painted pixels before screenshots.
      const charts = await assertChartsPainted(page, 3);
      assert.match(charts[2].aria, /11\/22 \(周日\)/);

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

      // Old child delayed 200 success & delayed failure must never overwrite or pollute the newly selected child.
      const oldChildTimeFail = await hold(timeUrl, true);
      const oldChildHistoryOk = await hold(historyUrl, false);
      try {
        await resume(); await Promise.all([oldChildTimeFail.started(), oldChildHistoryOk.started()]);
        await push(`/child/${other.id}/history`);
        await page.locator('[data-history-card="tasks"]').getByText('1 项').waitFor();
        await page.locator('[data-history-card="points"]').getByText('5 分').waitFor();
        await page.locator('[data-history-section="weekly"]').getByText('历史乙独立任务').waitFor();
        await page.locator('[data-history-section="goals"]').getByText('最近没有带进度的长期任务').waitFor();
        await page.locator('[data-history-section="time"]').getByText('近 7 天还没有记录到作业用时').waitFor();
        oldChildTimeFail.release(); oldChildHistoryOk.release();
        await Promise.all([oldChildTimeFail.done, oldChildHistoryOk.done]);
        assert.equal(await state('作业用时未能读取').count(), 0);
        assert.equal(await page.locator('[data-history-card="tasks"]').getByText('1 项').count(), 1);
        assert.equal(await page.locator('[data-history-card="points"]').getByText('5 分').count(), 1);
        assert.equal(await page.getByText(goal.title).count(), 0);
      } finally {
        oldChildTimeFail.release(); oldChildHistoryOk.release();
        if (!page.isClosed()) { await page.unroute(timeUrl, oldChildTimeFail.handler); await page.unroute(historyUrl, oldChildHistoryOk.handler); }
      }

      // Real empty child stays cleanly distinct from failed reads.
      await push(`/child/${empty.id}/history`);
      await page.locator('[data-history-card="tasks"]').getByText('0 项').waitFor();
      await page.locator('[data-history-section="weekly"]').getByText('本周还没有任务安排').waitFor();
      await page.locator('[data-history-section="goals"]').getByText('最近没有带进度的长期任务').waitFor();
      await page.locator('[data-history-section="time"]').getByText('近 7 天还没有记录到作业用时').waitFor();
      assert.equal(await page.locator('[data-page-state=error]').count(), 0);

      // Out-of-order refresh, midnight rollover, data-restored race, and leave/return lifecycle.
      if (width === 390 && theme === 'light') {
        await push(`/child/${child.id}/history`);
        await page.locator('[data-history-card="tasks"]').getByText('3 项').waitFor();

        // 1) Pre-midnight delayed 200 history response cannot revert post-midnight family rollover.
        const preMidnightOk = await hold(historyUrl, false);
        try {
          await resume(); await preMidnightOk.started();
          await page.unroute(historyUrl, preMidnightOk.handler);
          now = after;
          await page.clock.fastForward(120000);
          await page.getByText('11月23日 (周一)').waitFor();
          assert.equal(await page.evaluate(() => new Date().getDay()), 0, 'device remains Sunday while family rolled into Monday');
          preMidnightOk.release(); await preMidnightOk.done;
          assert.equal(await state('学习历史未能读取').count(), 0);
          assert.equal(await page.getByText('11月23日 (周一)').count(), 1);
        } finally { preMidnightOk.release(); if (!page.isClosed()) await page.unroute(historyUrl, preMidnightOk.handler); }

        // 2) Restore backup while an old 200 request (still 34 points) is in flight; stale 200 must never overwrite 40 points.
        const preRestoreOk = await hold(historyUrl, false);
        try {
          await resume(); await preRestoreOk.started();
          await page.unroute(historyUrl, preRestoreOk.handler);
          const extraTask = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '恢复后新积分', subject: '数学', date: '2026-11-23', points: 6 });
          await api('POST', `/daily-tasks/${extraTask.id}/complete`, {});
          await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
          await page.locator('[data-history-card="points"]').getByText('40 分').waitFor();
          preRestoreOk.release(); await preRestoreOk.done;
          assert.equal(await page.locator('[data-history-card="points"]').getByText('40 分').count(), 1);
          assert.equal(await page.locator('[data-history-card="points"]').getByText('34 分').count(), 0);
        } finally { preRestoreOk.release(); if (!page.isClosed()) await page.unroute(historyUrl, preRestoreOk.handler); }

        // 3) Overlapping same-scope refresh: older 200 (40 分) finishes after newer refresh (45 分) without overwriting.
        const staleRefreshOk = await hold(historyUrl, false);
        try {
          await resume(); await staleRefreshOk.started();
          await page.unroute(historyUrl, staleRefreshOk.handler);
          const secondExtra = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '乱序新积分', subject: '数学', date: '2026-11-23', points: 5 });
          await api('POST', `/daily-tasks/${secondExtra.id}/complete`, {});
          await resume();
          await page.locator('[data-history-card="points"]').getByText('45 分').waitFor();
          staleRefreshOk.release(); await staleRefreshOk.done;
          assert.equal(await page.locator('[data-history-card="points"]').getByText('45 分').count(), 1);
          assert.equal(await page.locator('[data-history-card="points"]').getByText('40 分').count(), 0);
        } finally { staleRefreshOk.release(); if (!page.isClosed()) await page.unroute(historyUrl, staleRefreshOk.handler); }

        // 4) Navigate away while a request is in flight: unmount aborts request & removes listeners; returning refreshes cleanly.
        const leaveHold = await hold(historyUrl, false);
        try {
          await resume(); await leaveHold.started();
          await page.locator(`nav[aria-label="学生导航"] a[href="/child/${child.id}/today"]`).click();
          await page.waitForURL(`**/child/${child.id}/today`);
          leaveHold.release(); await leaveHold.done;
          await page.unroute(historyUrl, leaveHold.handler);
          resetReads();
          await page.evaluate(() => { window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('taskie:data-restored')); });
          await page.clock.runFor(50);
          assert.equal(exclusiveReads(), 0, 'unmounted HistoryView listeners no longer trigger history reads');
          await page.getByRole('button', { name: '更多学习功能', exact: true }).click();
          await page.locator(`nav[aria-label="更多学习功能"] a[href="/child/${child.id}/history"]`).click();
          await page.waitForURL(`**/child/${child.id}/history`);
          await page.locator('[data-history-card="points"]').getByText('45 分').waitFor();
          assert.ok(exclusiveReads() >= 3 && reads() >= 4, 'returning to HistoryView fetches fresh data');
          await assertChartsPainted(page, 3);
        } finally { leaveHold.release(); if (!page.isClosed()) await page.unroute(historyUrl, leaveHold.handler); }
      }
      console.log(`PASS ${width}px ${theme}: loading, independent reads/retries, charts, stale 200/error isolation, lifecycle & layout`);
    } finally {
      await context.close();
      await browser.close();
      browser = undefined;
    }
    await api('DELETE', `/children/${child.id}`); await api('DELETE', `/children/${other.id}`); await api('DELETE', `/children/${empty.id}`);
    await api('DELETE', `/task-templates/${timedTpl.id}`); await api('DELETE', `/task-templates/${weeklyTpl.id}`);
  }

  // Scenario 2: Mixed time records (legacy aggregate + cleared legacy + multi-day split session + recorded + estimated) and goal filter boundaries.
  now = before;
  const mixed = await api('POST', '/children', { name: '混合统计验收' });
  db.prepare('UPDATE children SET created_at=? WHERE id=?').run(`${shiftDate(today, -20)}T00:00:00Z`, mixed.id);
  const mixedTpl = await api('POST', '/task-templates', {
    title: '混合数学听算', subject: '数学', points: 5, track_time: true, days_of_week: [0, 1, 2, 3, 4, 5, 6], child_ids: [mixed.id]
  });
  db.prepare('UPDATE task_templates SET created_at=? WHERE id=?').run(`${shiftDate(today, -20)}T00:00:00Z`, mixedTpl.id);

  // 3 prior recorded occurrences (-10d, -9d, -8d) reach MIN_RECORDS_FOR_ESTIMATE = 3, then -3d is left unrecorded so backend computes an estimate.
  for (const offset of [-10, -9, -8]) {
    const d = shiftDate(today, offset);
    await api('POST', '/daily-tasks/backfill/day', { child_id: mixed.id, date: d });
    const t = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(mixed.id, d, mixedTpl.id);
    await api('POST', `/daily-tasks/${t.id}/backfill`, { duration_seconds: 600 });
  }
  const missingDay = shiftDate(today, -3);
  await api('POST', '/daily-tasks/backfill/day', { child_id: mixed.id, date: missingDay });
  const missingTask = db.prepare('SELECT id FROM daily_tasks WHERE child_id=? AND date=? AND template_id=?').get(mixed.id, missingDay, mixedTpl.id);
  await api('POST', `/daily-tasks/${missingTask.id}/backfill`, { duration_seconds: null });

  // Inside 7-day range:
  // A) Old legacy aggregate (10 min = 600s) + real multi-day split session (5 min on -2d + 3 min on -1d = 480s).
  const legacyTask = await api('POST', `/children/${mixed.id}/adhoc-tasks`, { title: '旧累计语文作业', subject: '语文', date: shiftDate(today, -2), points: 5, track_time: true });
  await api('POST', `/daily-tasks/${legacyTask.id}/backfill`, { duration_seconds: 600 });
  await api('POST', `/daily-tasks/${legacyTask.id}/sessions`, { request_id: 'mixed_split_manual_1', date: shiftDate(today, -1), duration_seconds: 180, note: '昨晚记录' });
  db.prepare('INSERT INTO homework_sessions(id, task_id, child_id, started_at, ended_at, note, duration_seconds, duration_source) VALUES (?,?,?,?,?,?,?,?)')
    .run('mixed_split_cross_1', legacyTask.id, mixed.id, `${shiftDate(today, -2)}T23:55:00Z`, `${shiftDate(today, -1)}T00:02:00Z`, '跨午夜分次', 300, 'timer');
  db.prepare('INSERT INTO homework_session_days(session_id, date, seconds) VALUES (?,?,?), (?,?,?)')
    .run('mixed_split_cross_1', shiftDate(today, -2), 180, 'mixed_split_cross_1', shiftDate(today, -1), 120);

  // B) Zeroed old legacy task (900s cleared to 0 via API -> excluded from recorded total, never counted as 900s).
  const clearedTask = await api('POST', `/children/${mixed.id}/adhoc-tasks`, { title: '已清零旧记录', subject: '英语', date: shiftDate(today, -1), points: 5, track_time: true });
  await api('POST', `/daily-tasks/${clearedTask.id}/backfill`, { duration_seconds: 900 });
  db.prepare('UPDATE daily_tasks SET homework_legacy_seconds = 900, duration_seconds = NULL WHERE id = ?').run(clearedTask.id);
  await api('PUT', `/daily-tasks/${clearedTask.id}/study/legacy`, { duration_seconds: 0, expected_old_seconds: 900, reason: '清理旧错误累计' });

  // C) Recorded today (7 min = 420s). Total recorded in 7d = 600 + 180 + 300 + 420 = 1500s (25 分), while backend estimated_seconds > 1500.
  const todayMixed = (await api('GET', `/daily-tasks?child_id=${mixed.id}&date=${today}`)).find(t => t.template_id === mixedTpl.id);
  await api('POST', `/daily-tasks/${todayMixed.id}/complete`, { duration_seconds: 420 });
  const statsJson = await api('GET', `/children/${mixed.id}/time-stats`);
  assert.equal(statsJson.summary.recorded_seconds, 1500);
  assert.ok(statsJson.summary.estimated_seconds > statsJson.summary.recorded_seconds, 'API carries an unrecorded estimate that child view must keep hidden');

  // Goal boundaries: position goal completed within 30 days (visible), completed > 30 days ago (hidden), and no-log active goal (hidden).
  const recentGoal = await api('POST', `/children/${mixed.id}/goals`, {
    title: '近期位置阅读目标', subject: '语文', mode: 'progress', input_mode: 'position',
    total_amount: 50, unit: '页', start_date: shiftDate(today, -5), end_date: shiftDate(today, 5)
  });
  await api('POST', `/period-tasks/${recentGoal.id}/logs`, { request_id: 'mixed_goal_recent_1', date: shiftDate(today, -2), position: 20 });
  await api('POST', `/period-tasks/${recentGoal.id}/logs`, { request_id: 'mixed_goal_recent_2', date: shiftDate(today, -1), position: 50 });
  const staleGoal = await api('POST', `/children/${mixed.id}/goals`, {
    title: '过期已完成目标', subject: '数学', mode: 'progress',
    total_amount: 10, unit: '套', start_date: shiftDate(today, -50), end_date: shiftDate(today, -35)
  });
  await api('POST', `/period-tasks/${staleGoal.id}/logs`, { request_id: 'mixed_goal_stale_1', date: shiftDate(today, -35), amount: 10 });
  await api('POST', `/children/${mixed.id}/goals`, {
    title: '暂无记录目标', subject: '英语', mode: 'progress',
    total_amount: 20, unit: '课', start_date: shiftDate(today, -2), end_date: shiftDate(today, 10)
  });

  browser = await chromium.launch(launchOptions());
  const { context: mixedCtx, page: mixedPage } = await openContext(base, 390, 'dark', token, mixed, 'parent', errors);
  try {
    await mixedPage.goto(`${base}/child/${mixed.id}/history`, { waitUntil: 'networkidle' });
    const timeSection = mixedPage.locator('[data-history-section="time"]');
    await timeSection.getByText('一共记录了 25 分', { exact: true }).waitFor();
    assert.equal(await timeSection.getByText(/估算|超时/).count(), 0);
    await timeSection.getByRole('button', { name: '📋 看表格', exact: true }).click();
    assert.equal(await timeSection.getByRole('columnheader', { name: '含估算', exact: true }).count(), 0);
    await timeSection.locator('td', { hasText: '13 分' }).first().waitFor();
    await timeSection.locator('td', { hasText: '5 分' }).first().waitFor();
    await timeSection.getByRole('button', { name: '📊 看图', exact: true }).click();
    await mixedPage.locator('[data-history-section="goals"]').getByText('近期位置阅读目标', { exact: true }).waitFor();
    await mixedPage.locator('[data-history-section="goals"]').getByText('已完成 🎉', { exact: true }).waitFor();
    assert.equal(await mixedPage.getByText('过期已完成目标').count(), 0);
    assert.equal(await mixedPage.getByText('暂无记录目标').count(), 0);
    await assertChartsPainted(mixedPage, 3);
    console.log('PASS mixed legacy/session/recorded/estimated isolation and goal boundary filtering');
  } finally {
    await mixedCtx.close();
    await browser.close();
    browser = undefined;
  }

  // Scenario 3: Unknown family timezone gate, child-role route/API permission boundary, and session-changed race isolation.
  const childA = await api('POST', '/children', { name: '历史权限甲' });
  const childB = await api('POST', '/children', { name: '历史权限乙' });
  const taskA = await api('POST', `/children/${childA.id}/adhoc-tasks`, { title: '会话甲专属任务', subject: '数学', date: today, points: 12 });
  await api('POST', `/daily-tasks/${taskA.id}/complete`, {});
  const childToken = (await app.inject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: childA.id } })).json().token;

  browser = await chromium.launch(launchOptions());
  const { context: authCtx, page: authPage } = await openContext(base, 390, 'dark', childToken, childA, 'child', errors);
  try {
    const { fail, hold, resume, state } = attachHelpers(authPage, base);
    let reads = 0;
    authPage.on('request', req => {
      const pathname = new URL(req.url()).pathname;
      if (pathname.startsWith('/api/children/') && /\/(history|weekly-summary|goals|time-stats)$/.test(pathname)) reads++;
    });
    const failCal = route => route.fulfill({ status: 503, json: { error: '暂时无法读取家庭日期' } });
    await authPage.route('**/api/calendar', failCal);
    await authPage.goto(`${base}/child/${childA.id}/history`, { waitUntil: 'networkidle' });
    await authPage.getByText('等待确认家庭日期…', { exact: true }).waitFor();
    assert.equal(reads, 0, 'unknown family zone waits before reading history endpoints');

    await authPage.unroute('**/api/calendar', failCal);
    await authPage.getByRole('button', { name: '重新读取家庭时区', exact: true }).click();
    await authPage.locator('[data-history-card="points"]').getByText('12 分').waitFor();
    assert.ok(reads >= 4);

    // Child role cannot navigate directly in browser to sibling's history or query sibling APIs.
    const readsBeforeSibling = reads;
    await authPage.goto(`${base}/child/${childB.id}/history`, { waitUntil: 'networkidle' });
    await authPage.waitForURL(`${base}/`);
    assert.equal(reads, readsBeforeSibling, 'child route guard stops sibling navigation before history requests');
    for (const ep of ['history', 'weekly-summary', 'goals', 'time-stats']) {
      const forbidden = await app.inject({ method: 'GET', url: `/api/children/${childB.id}/${ep}`, headers: { authorization: `Bearer ${childToken}` } });
      assert.equal(forbidden.statusCode, 403);
    }

    // Session change clears stale data and discards in-flight old-session 200 responses.
    await authPage.goto(`${base}/child/${childA.id}/history`, { waitUntil: 'networkidle' });
    await authPage.locator('[data-history-card="points"]').getByText('12 分').waitFor();
    const childAHistoryUrl = `**/api/children/${childA.id}/history?*`;
    const sessionHold = await hold(childAHistoryUrl, false);
    try {
      await resume(); await sessionHold.started();
      await authPage.evaluate(() => {
        sessionStorage.removeItem('taskie_child_token');
        window.dispatchEvent(new Event('taskie:session-changed'));
      });
      await authPage.locator('[data-history-card="points"]').getByText('— 分').waitFor();
      sessionHold.release(); await sessionHold.done;
      assert.equal(await authPage.locator('[data-history-card="points"]').getByText('12 分').count(), 0);
      assert.equal(await state('学习历史未能读取').count(), 0);
      await authPage.unroute(childAHistoryUrl, sessionHold.handler);
      await authPage.evaluate(tok => {
        sessionStorage.setItem('taskie_child_token', tok);
        window.dispatchEvent(new Event('taskie:session-changed'));
      }, childToken);
      await authPage.locator('[data-history-card="points"]').getByText('12 分').waitFor();
    } finally { sessionHold.release(); if (!authPage.isClosed()) await authPage.unroute(childAHistoryUrl, sessionHold.handler); }

    console.log('PASS family timezone gate, child route & API isolation, and session-changed isolation');
  } finally {
    await authCtx.close();
    await browser.close();
    browser = undefined;
  }

  assert.deepEqual(errors, []);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
