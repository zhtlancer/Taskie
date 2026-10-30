// Build first. BROWSER=webkit exercises the Safari engine; successful saves use the real API.
const assert = require('node:assert/strict');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const c = createTestApp();
let browser;

async function checkDates(form) {
  // The overlay scales in from 80%; measure the settled controls, not an animation frame. Jump finite
  // animations/transitions to their end: Chromium can leave a reduced-motion transition pending indefinitely.
  await form.evaluate(async el => {
    for (const animation of el.parentElement.getAnimations({ subtree: true })) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const geometry = await form.evaluate(el => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, height: r.height }; };
    const fields = [...el.querySelectorAll('input[type=date]')];
    return { fields: fields.map(rect), columns: fields.map(field => rect(field.parentElement)), overflow: el.scrollWidth > el.clientWidth };
  });
  assert.equal(geometry.fields.length, 2);
  const [start, end] = geometry.fields;
  assert.ok(start.right + 1 <= end.left && Math.abs(start.top - end.top) < 1, 'dates stay side by side with separate borders');
  assert.equal(geometry.overflow, false, 'the holiday form must not overflow horizontally');
  geometry.fields.forEach((field, i) => {
    const column = geometry.columns[i];
    assert.ok(field.left >= column.left - 1 && field.right <= column.right + 1, 'each date border fits its own column');
    assert.ok(field.height >= 43.9, `date fields keep a 44px touch target: ${JSON.stringify(field)}`);
  });
}

async function main() {
  await c.app.ready();
  const child = c.app.services.childrenService.createChild({ name: '假期日期布局' });
  const today = getTodayDate();
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === webkit ? { headless: true } : launchOptions());
  const errors = [];
  let offset = 7;
  for (const [width, height] of [[390, 844], [507, 820], [768, 1024], [820, 1180], [1024, 768], [1180, 820]]) for (const theme of ['light', 'dark']) {
    // Holidays for one child cannot overlap, so every viewport uses a separate future interval.
    const start = shiftDate(today, offset), end = shiftDate(today, offset + 7), editedEnd = shiftDate(today, offset + 8);
    offset += 21;
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/parent/periods`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '➕ 新增假期', exact: true }).click();
      const name = `日期布局-${width}-${theme}`;
      let form = page.locator('form').filter({ has: page.getByRole('heading', { name: `➕ 为${child.name}新增假期`, exact: true }) });
      await form.getByPlaceholder('例如：寒假', { exact: true }).fill(name);
      await form.getByLabel('开始日期', { exact: true }).fill(start);
      await form.getByLabel('结束日期', { exact: true }).fill(end);
      await checkDates(form);
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      await checkDates(form);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      const created = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/children/${child.id}/periods`));
      await form.getByRole('button', { name: '确认保存', exact: true }).click();
      const response = await created; assert.equal(response.status(), 201, await response.text());
      const period = await response.json();
      assert.deepEqual([period.start_date, period.end_date], [start, end]);
      await form.waitFor({ state: 'detached' });
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: new RegExp(name) }) });
      await card.getByRole('button', { name: '✏️ 编辑', exact: true }).click();
      form = page.locator('form').filter({ has: page.getByRole('heading', { name: '✏️ 编辑假期', exact: true }) });
      assert.equal(await form.getByLabel('开始日期', { exact: true }).inputValue(), start);
      assert.equal(await form.getByLabel('结束日期', { exact: true }).inputValue(), end);
      await form.getByLabel('结束日期', { exact: true }).fill(editedEnd);
      await checkDates(form);
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      await checkDates(form);
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      const updated = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/periods/${period.id}`));
      await form.getByRole('button', { name: '确认保存', exact: true }).click();
      const changed = await updated; assert.equal(changed.status(), 200, await changed.text());
      assert.equal((await changed.json()).end_date, editedEnd);
      await form.waitFor({ state: 'detached' });
      console.log(`PASS ${engine.name()} ${width}x${height}/${theme}: holiday creation/edit date borders fit, enlarged text fits and both saves preserve dates`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await c.app.close(); cleanupTestApp(c); c.db.close();
});
