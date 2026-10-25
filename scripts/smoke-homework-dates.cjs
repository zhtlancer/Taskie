// Build first. BROWSER=webkit exercises WebKit with touch/tablet contexts; default is Chromium.
const assert = require('node:assert/strict');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const c = createTestApp();
let browser;

async function checkDates(dialog, keepColumns) {
  const geometry = await dialog.evaluate(el => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
    const fields = ['homework-assigned', 'homework-due'].map(id => el.querySelector(`#${id}`));
    return { fields: fields.map(rect), columns: fields.map(field => rect(field.parentElement)), overflow: el.scrollWidth > el.clientWidth };
  });
  const [a, b] = geometry.fields;
  if (keepColumns) assert.ok(a.right <= b.left && Math.abs(a.top - b.top) < 1, 'phone dates keep their original side-by-side layout');
  assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'date controls must not overlap');
  assert.equal(geometry.overflow, false, 'the dialog must not overflow horizontally');
  geometry.fields.forEach((field, index) => {
    const column = geometry.columns[index];
    assert.ok(field.left >= column.left - 1 && field.right <= column.right + 1, 'each date control must fit its column');
    assert.ok(field.height >= 44, 'date controls need a 44px touch target');
  });
}

async function main() {
  await c.app.ready();
  const child = c.app.services.childrenService.createChild({ name: '作业日期布局' });
  const today = getTodayDate(), due = shiftDate(today, 1);
  c.app.services.homeworkService.create(child.id, { subject: '数学', content: '日期布局检查', assigned_date: today, due_date: due, create_task: false }, 'parent');
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === webkit ? { headless: true } : launchOptions());
  const errors = [];
  const sizes = [[320, 844], [390, 844], [507, 820], [768, 1024], [820, 1180], [1024, 768], [1180, 820]];
  for (const [width, height] of sizes) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', hasTouch: true, isMobile: true, deviceScaleFactor: 2, colorScheme: theme });
    try {
      await context.addInitScript(({ token, theme }) => { sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme); }, { token, theme });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/child/${child.id}/homework`, { waitUntil: 'networkidle' });
      for (const mode of ['create', 'edit']) {
        await page.getByRole('button', { name: mode === 'create' ? '➕ 记作业' : '修改', exact: true }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('布置日期', { exact: true }).fill(today);
        await dialog.getByLabel('截止日期', { exact: true }).fill(due);
        await checkDates(dialog, width < 640);
        assert.equal(await dialog.getByLabel('布置日期', { exact: true }).inputValue(), today);
        assert.equal(await dialog.getByLabel('截止日期', { exact: true }).inputValue(), due);
        // Safari accessibility text sizes and split view change available space independently
        // of a breakpoint based on the full device viewport.
        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        await checkDates(dialog, width < 640);
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
        await dialog.getByRole('button', { name: '取消', exact: true }).click();
        console.log(`PASS ${engine.name()} ${width}x${height}/${theme}/${mode}: dates fit and remain editable, including enlarged text`);
      }
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await c.app.close(); cleanupTestApp(c); c.db.close();
});
