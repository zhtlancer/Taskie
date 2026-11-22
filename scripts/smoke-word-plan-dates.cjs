// Build first. TASKIE_BROWSER=webkit checks Safari-engine layouts with an isolated database.
const assert = require('node:assert/strict');
const { launchBrowser, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const c = createTestApp({ dictDir: null });
let browser;

async function checkLayout(page, card) {
  for (const fontSize of ['', '24px']) {
    await page.evaluate(size => { document.documentElement.style.fontSize = size; }, fontSize);
    const boxes = await card.evaluate(async el => {
      for (const animation of document.getAnimations()) {
        if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = node => { const { left, right, top, bottom, height } = node.getBoundingClientRect(); return { left, right, top, bottom, height }; };
      const style = getComputedStyle(el), outer = rect(el);
      return [...el.querySelectorAll('input[type=date], input[type=number]')].map(field => ({
        field: rect(field), column: rect(field.parentElement),
        left: outer.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right: outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
      }));
    });
    assert.equal(boxes.length, 6);
    for (const { field, column, left, right } of boxes) {
      assert.ok(field.left >= column.left - 1 && field.right <= column.right + 1, `input fits its column: ${JSON.stringify({ field, column })}`);
      assert.ok(field.left >= left - 1 && field.right <= right + 1, 'input fits within card padding');
      assert.ok(field.height >= 43.9, 'input keeps its 44px touch target');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page has no horizontal overflow');
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
}

async function main() {
  await c.app.ready();
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const startDate = shiftDate(getTodayDate(), 30), errors = [];
  browser = await launchBrowser();
  for (const [width, height] of [[390, 844], [820, 1180], [1024, 768], [1180, 820]]) for (const theme of ['light', 'dark']) {
    const child = c.app.services.childrenService.createChild({ name: `日期检查-${width}-${theme}` });
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', colorScheme: theme,
      hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme);
      }, { token, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/parent/word-plans?child=${child.id}`, { waitUntil: 'networkidle' });
      for (const language of ['zh', 'en']) {
        if (language === 'en') await page.getByRole('tab', { name: /英语单词计划/ }).click();
        const titles = language === 'zh' ? ['语文字词认读', '语文字词书写'] : ['英语单词认读', '英语单词默写'];
        for (const title of titles) {
          const card = page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
          const date = card.getByLabel('开始日期', { exact: true });
          await date.waitFor();
          assert.equal(await date.isDisabled(), false);
          await date.fill(startDate);
          await checkLayout(page, card);
          await card.getByRole('button', { name: `保存${title}计划`, exact: true }).click();
          await card.getByRole('status').filter({ hasText: '计划已保存，并按约定生效。' }).waitFor();
          assert.equal(await date.isDisabled(), true, 'saved plans lock the start date');
          assert.equal(await date.inputValue(), startDate, 'chosen date survives saving');
          await checkLayout(page, card);
        }
      }
      console.log(`PASS ${width}x${height}/${theme}: four word-plan cards fit before/after saving, including enlarged text`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser rendering errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await c.app.close(); cleanupTestApp(c); c.db.close();
});
