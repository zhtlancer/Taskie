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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-child-schedule-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;
async function main() {
  await app.ready(); const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), errors = [], today = getTodayDate();
  const api = async (method, url, payload, owner = token) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${owner}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`); return response.json();
  };
  const child = await api('POST', '/children', { name: '课程表甲' }), other = await api('POST', '/children', { name: '课程表乙' }), empty = await api('POST', '/children', { name: '空课表' });
  for (const [id, subject] of [[child.id, '科学与信息科技综合'], [other.id, '乙的数学']]) await api('POST', `/children/${id}/timetables`, {
    name: '本学期', start_date: shiftDate(today, -60), end_date: shiftDate(today, 60),
    slots: [{ id: 's1', kind: 'class', label: '上午第一节综合课程', start_time: '08:00', end_time: '08:40' },
      { id: 's2', kind: 'break', label: '课间操与休息', start_time: '08:40', end_time: '09:00' }],
    lessons: [0,1,2,3,4,5,6].map(weekday => ({ slot_id: 's1', weekday, subject, week: 'all', teacher: '科学老师与助教', room: '综合实验教室' })) });
  const title = '课外班的长课程名称与综合训练活动';
  const cls = await api('POST', '/outside-classes', { title, child_ids: [child.id], start_date: shiftDate(today, -30), end_date: shiftDate(today, 30),
    days_of_week: [0,1,2,3,4,5,6], start_time: '16:00', end_time: '17:00', institution: '青少年科学与艺术活动中心', location: 'LongUnbrokenRoomNameForTabletLayoutChecks123456789', teacher: '课外班老师' });
  await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: shiftDate(today, -1), kind: 'leave', note: '参加学校活动所以请假，下次正常上课' });
  await api('PUT', `/outside-classes/${cls.id}/exceptions`, { child_id: child.id, date: shiftDate(today, -2), kind: 'moved', new_date: shiftDate(today, 1), new_start_time: '18:00', new_end_time: '19:00' });
  browser = await chromium.launch(launchOptions());
  const open = async (width, theme, owner = token, role = 'parent') => {
    now = before;
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, hasTouch: true,
      timezoneId: 'Pacific/Honolulu', serviceWorkers: 'block', reducedMotion: 'reduce' });
    await context.addInitScript(({ owner, theme, role }) => { sessionStorage.setItem(`taskie_${role}_token`, owner); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { owner, theme, role });
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new RealDate(before) }); await page.clock.pauseAt(new RealDate(before));
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    return { context, page };
  };
  for (const width of [320,390,820,1024,1180]) for (const theme of ['light','dark']) {
    const { context, page } = await open(width, theme);
    try {
      const scheduleUrl = `**/api/children/${child.id}/schedule?*`, state = page.locator('[data-page-state=error]');
      const range = page.locator('[data-schedule-range]'), content = page.locator('section[aria-label$="的课程"]:visible');
      const fail = route => route.fulfill({ status: 503, json: { error: '课程表暂时无法读取' } });
      const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
      const resume = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      const choose = async date => {
        if (width < 1024) await page.locator(`[data-schedule-day="${date}"]`).click();
        return page.locator(`section[aria-label="${date}的课程"]:visible`);
      };
      const hold = async (pattern, failure = false) => {
        let release, arrive, finish, count = 0;
        const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrive = resolve; }), done = new Promise(resolve => { finish = resolve; });
        const handler = async route => {
          count++; const response = await route.fetch(); arrive(); await gate;
          try { await route.fulfill(failure ? { status: 503, json: { error: '旧周迟到的读取错误' } } : { response }); }
          catch (error) { if (!/closed|canceled|cancelled|Invalid Interception/i.test(error.message)) throw error; }
          finally { finish(); }
        };
        await page.route(pattern, handler);
        return { release, done, handler, count: () => count, started: async () => {
          let timer; try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`request did not start: ${pattern}`)), 10000); })]); }
          finally { clearTimeout(timer); }
        } };
      };
      await page.route(scheduleUrl, fail); await page.goto(`${base}/child/${child.id}/schedule`, { waitUntil: 'networkidle' });
      await state.getByRole('heading', { name: '课程表未能读取', exact: true }).waitFor();
      assert.equal(await page.getByText('这一周没有课程安排', { exact: true }).count(), 0);
      assert.equal(await page.getByText('正在加载课程表…', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0, 'read failures stay local');
      await page.unroute(scheduleUrl, fail); await state.getByRole('button', { name: '重新读取', exact: true }).click();
      await (await choose(today)).getByText(`🎨 ${title}`, { exact: true }).waitFor();
      assert.equal(await range.textContent(), '2026/11/16 – 11/22');
      if (width < 1024) {
        const selected = page.locator(`[data-schedule-day="${today}"]`);
        assert.equal(await selected.getAttribute('aria-pressed'), 'true'); assert.equal(await selected.getAttribute('aria-current'), 'date');
        assert.ok(await selected.evaluate(el => { const r = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect(); return r.left >= parent.left - 1 && r.right <= parent.right + 1; }), 'selected Sunday is scrolled into view');
      }
      const saturday = await choose(shiftDate(today, -1)); await saturday.getByText(/请假：参加学校活动/).waitFor();
      const friday = await choose(shiftDate(today, -2)); await friday.getByText('调到 11/23 18:00–19:00', { exact: true }).waitFor();
      // A resumed page re-reads the same week while retaining the selected date.
      await resume(); await friday.getByText('调到 11/23 18:00–19:00', { exact: true }).waitFor();
      if (width < 1024) assert.equal(await page.locator(`[data-schedule-day="${shiftDate(today, -2)}"]`).getAttribute('aria-pressed'), 'true');
      await choose(today);

      // Two quick switches: the old week's success and failure cannot overwrite the new week.
      for (const failure of [false,true]) {
        const oldWeek = await hold(scheduleUrl, failure);
        try {
          await page.getByRole('button', { name: '下一周', exact: true }).click(); await oldWeek.started();
          await page.unroute(scheduleUrl, oldWeek.handler);
          await page.getByRole('button', { name: '下一周', exact: true }).click();
          await page.locator('section[aria-label="2026-11-30的课程"]:visible').waitFor();
          oldWeek.release(); await oldWeek.done;
          assert.equal(await range.textContent(), '2026/11/30 – 12/6'); assert.equal(await state.count(), 0);
          await page.getByRole('button', { name: '回到本周', exact: true }).click();
          await (await choose(today)).getByText(`🎨 ${title}`, { exact: true }).waitFor();
        } finally { oldWeek.release(); await page.unroute(scheduleUrl, oldWeek.handler); }
      }
      // Return from a background page and restored data both invalidate outstanding reads.
      const priorRead = await hold(scheduleUrl);
      try {
        await resume(); await priorRead.started(); await page.unroute(scheduleUrl, priorRead.handler);
        const updatedLocation = `LongUnbrokenUpdatedClassroomName${width}${theme}`;
        await api('PUT', `/outside-classes/${cls.id}`, { location: updatedLocation });
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await content.getByText(new RegExp(updatedLocation)).first().waitFor(); priorRead.release(); await priorRead.done;
        await content.getByText(new RegExp(updatedLocation)).first().waitFor();
        await (await choose(today)).getByText(`🎨 ${title}`, { exact: true }).waitFor();
      } finally { priorRead.release(); await page.unroute(scheduleUrl, priorRead.handler); }
      const boxes = await page.locator('[data-schedule-page] button, [data-schedule-page] a').evaluateAll(items => items.filter(el => el.getClientRects().length).map(el => {
        const r = el.getBoundingClientRect(); return { label: el.textContent, width: r.width, height: r.height };
      }));
      for (const box of boxes) assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page must fit the viewport');
      const clipped = await content.locator('*').evaluateAll(items => items.filter(el => el.clientWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent));
      assert.deepEqual(clipped, [], 'long school and outside class details wrap without clipping');
      if (process.env.SCREENSHOT_DIR) { fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `schedule-${width}-${theme}.png`), fullPage: true }); }

      // Crossing the family's Sunday midnight follows the current week but preserves an explicitly browsed week.
      if ((width === 390 && theme === 'light') || (width === 1180 && theme === 'dark')) {
        const oldDay = await hold(scheduleUrl);
        try {
          await resume(); await oldDay.started(); await page.unroute(scheduleUrl, oldDay.handler);
          now = after; await page.clock.fastForward(120000);
          await page.locator('section[aria-label="2026-11-23的课程"]:visible').waitFor();
          oldDay.release(); await oldDay.done;
          assert.equal(await range.textContent(), '2026/11/23 – 11/29');
        } finally { oldDay.release(); await page.unroute(scheduleUrl, oldDay.handler); }
        await page.locator('section[aria-label="2026-11-23的课程"]:visible').getByText('从 11/20 调来', { exact: true }).waitFor();
        // The device still says Sunday; the active family date is Monday.
        assert.equal(await page.evaluate(() => new Date().getDay()), 0);
        if (width < 1024) assert.equal(await page.locator('[data-schedule-day="2026-11-23"]').getAttribute('aria-current'), 'date');
        await page.getByRole('button', { name: '上一周', exact: true }).click(); await page.locator('section[aria-label="2026-11-16的课程"]:visible').waitFor();
        now += 86400000; await page.clock.fastForward(86400000); await page.waitForLoadState('networkidle');
        assert.equal(await range.textContent(), '2026/11/16 – 11/22');
        await page.getByRole('button', { name: '回到本周', exact: true }).click();
        await page.locator('section[aria-label="2026-11-24的课程"]:visible').waitFor();
      }
      const oldChild = await hold(scheduleUrl, true);
      try {
        await page.getByRole('button', { name: '下一周', exact: true }).click(); await oldChild.started();
        await push(`/child/${other.id}/schedule`); await content.getByText('乙的数学', { exact: true }).first().waitFor();
        oldChild.release(); await oldChild.done; assert.equal(await state.count(), 0);
        assert.equal(await content.getByText('科学与信息科技综合', { exact: true }).count(), 0);
      } finally { oldChild.release(); await page.unroute(scheduleUrl, oldChild.handler); }
      await push(`/child/${empty.id}/schedule`); await page.getByRole('heading', { name: '这一周没有课程安排', exact: true }).waitFor();
      await push(`/child/${child.id}/schedule`); await content.getByText(`🎨 ${title}`, { exact: true }).first().waitFor();
      const pendingUnmount = await hold(scheduleUrl);
      try {
        await resume(); await pendingUnmount.started(); await push('/parent/dashboard');
        await page.getByRole('heading', { name: '今日作业完成概览', exact: true }).waitFor(); pendingUnmount.release(); await pendingUnmount.done;
        assert.equal(await page.locator('[data-schedule-page]').count(), 0);
      } finally { pendingUnmount.release(); await page.unroute(scheduleUrl, pendingUnmount.handler); }
      console.log(`PASS ${width}px ${theme}: retries, stale success/error, restored data, child switch/unmount, selected day, wrapping and 44px controls${width === 390 && theme === 'light' || width === 1180 && theme === 'dark' ? ', family midnight and browsed week' : ''}`);
    } finally { await context.close(); }
  }
  // An unconfirmed family zone must not silently use device/UTC dates to read a week.
  const { context, page } = await open(390, 'light');
  try {
    const fail = route => route.fulfill({ status: 503, json: { error: '暂时无法读取家庭日期' } });
    let reads = 0; page.on('request', request => { const pathname = new URL(request.url()).pathname; if (pathname.startsWith('/api/children/') && pathname.endsWith('/schedule')) reads++; });
    await page.route('**/api/calendar', fail); await page.goto(`${base}/child/${child.id}/schedule`, { waitUntil: 'networkidle' });
    await page.getByText('等待确认家庭日期…', { exact: true }).waitFor(); assert.equal(reads, 0);
    assert.equal(await page.getByText('这一周没有课程安排', { exact: true }).count(), 0);
    await page.unroute('**/api/calendar', fail); await page.getByRole('button', { name: '重新读取家庭时区', exact: true }).click();
    await page.locator('section[aria-label="2026-11-22的课程"]:visible').waitFor(); assert.ok(reads > 0);
    console.log('PASS family time-zone failure waits for confirmation, then reads the family week');
  } finally { await context.close(); }
  const childToken = (await app.inject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: child.id } })).json().token;
  const self = await api('GET', `/children/${child.id}/schedule?from=${today}`, undefined, childToken); assert.equal(self[0].date, today);
  const forbidden = await app.inject({ method: 'GET', url: `/api/children/${other.id}/schedule?from=${today}`, headers: { authorization: `Bearer ${childToken}` } });
  assert.equal(forbidden.statusCode, 403);
  const own = await open(390, 'dark', childToken, 'child');
  try {
    await own.page.goto(`${base}/child/${child.id}/schedule`);
    await own.page.locator('section[aria-label="2026-11-22的课程"]:visible').getByText(`🎨 ${title}`, { exact: true }).waitFor();
  } finally { await own.context.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS child can read own schedule; server forbids another child');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await app.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true });
});
