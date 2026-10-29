// Build first. BROWSER=webkit checks the Safari engine with touch and tablet viewports.
const assert = require('node:assert/strict');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, getDayOfWeek, shiftDate } = require('../backend/src/utils/date');
const c = createTestApp();
let browser;

async function checkFields(dialog, tablet) {
  const geometry = await dialog.evaluate(el => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
    const fields = [...el.querySelectorAll('input[type=date], input[type=time]')];
    return { fields: fields.map(rect), columns: fields.map(field => rect(field.parentElement)), overflow: el.scrollWidth > el.clientWidth };
  });
  assert.equal(geometry.fields.length, 3);
  assert.equal(geometry.overflow, false, 'the move dialog must not overflow horizontally');
  for (let i = 0; i < geometry.fields.length; i++) {
    const field = geometry.fields[i], column = geometry.columns[i];
    assert.ok(field.left >= column.left - 1 && field.right <= column.right + 1, `field ${i} border must fit its grid column: ${JSON.stringify({ field, column })}`);
    assert.ok(field.height >= 44, 'date/time controls keep a 44px touch target');
    for (const other of geometry.fields.slice(i + 1)) {
      assert.ok(field.right <= other.left || other.right <= field.left || field.bottom <= other.top || other.bottom <= field.top, 'date/time borders must not overlap');
    }
  }
  if (tablet) assert.ok(geometry.fields.every(field => Math.abs(field.top - geometry.fields[0].top) < 1), 'tablets retain the three-column layout');
  else assert.ok(geometry.fields[0].bottom <= geometry.fields[1].top, 'phones retain the date above the time fields');
}

async function main() {
  await c.app.ready();
  const child = c.app.services.childrenService.createChild({ name: '调课日期布局' });
  const today = getTodayDate(), moved = shiftDate(today, 1);
  const cls = c.app.services.scheduleService.createClass({ title: '调课边框检查', child_ids: [child.id], start_date: today,
    days_of_week: [getDayOfWeek(today)], start_time: '16:00', end_time: '17:00', total_lessons: 5 });
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === webkit ? { headless: true } : launchOptions());
  const errors = [];
  for (const [width, height] of [[390, 844], [507, 820], [768, 1024], [820, 1180], [1024, 768], [1180, 820]]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: theme });
    try {
      await context.addInitScript(({ token, theme }) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); }, { token, theme });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/parent/schedule?child=${child.id}`, { waitUntil: 'networkidle' });
      await page.locator(`[data-class-id="${cls.id}"] button[data-source-date="${today}"]`).click();
      const dialog = page.getByRole('dialog', { name: new RegExp(cls.title) });
      await dialog.getByRole('button', { name: '🔁 调课', exact: true }).click();
      const date = dialog.locator('input[type=date]'), times = dialog.locator('input[type=time]');
      await date.fill(moved); await times.first().fill('18:00'); await times.last().fill('19:00');
      await checkFields(dialog, width >= 640);
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      await checkFields(dialog, width >= 640);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      assert.equal(await date.inputValue(), moved);
      assert.deepEqual(await times.evaluateAll(fields => fields.map(field => field.value)), ['18:00', '19:00']);
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      console.log(`PASS ${engine.name()} ${width}x${height}/${theme}: move fields fit their columns, remain editable and survive enlarged text`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await c.app.close(); cleanupTestApp(c); c.db.close();
});
