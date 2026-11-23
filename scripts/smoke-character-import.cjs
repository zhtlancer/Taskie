const { useLocalLearningFont } = require('./word-book-fonts.cjs');
const assert = require('node:assert/strict');
const { launchBrowser, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const c = createTestApp({ dictDir: null });
let browser, hold;
const attempts = [], errors = [];
const requestsFor = childId => attempts.filter(body => body.child_id === childId);
const bounded = async promise => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Import request did not reach server')), 20000); })]); }
  finally { clearTimeout(timer); }
};
async function main() {
  c.app.addHook('onSend', async (request, reply, payload) => {
    if (request.method === 'POST' && request.url === '/api/characters/batch') {
      attempts.push(request.body);
      if (hold) { const current = hold; hold = null; current.reached(); await current.gate; }
    }
    return payload;
  });
  await c.app.ready();
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await launchBrowser();
  for (const [width, theme] of [[320, 'light'], [390, 'dark'], [820, 'light'], [1024, 'dark'], [1180, 'light']]) {
    const child = c.app.services.childrenService.createChild({ name: `语文导入-${width}` });
    const existing = c.app.services.charactersService.createCharacter({ child_id: child.id, char: '长', pinyin: 'cháng', categories: ['write'] });
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, locale: 'zh-CN', hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    try {
      const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
      await useLocalLearningFont(context);
      await context.addInitScript(token => sessionStorage.setItem('taskie_parent_token', token), token);
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/child/${child.id}/characters`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: '批量导入字词', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '批量导入语文字词', exact: true });
      await dialog.getByLabel('导入到词本', { exact: true }).selectOption('new');
      await dialog.getByLabel('来源（选填）', { exact: true }).fill('语文三上');
      await dialog.getByLabel('单元/章节（选填）', { exact: true }).fill('第一单元');
      assert.equal(await dialog.getByLabel('词本名称', { exact: true }).inputValue(), '语文三上 · 第一单元');
      await dialog.getByLabel('字词列表', { exact: true }).fill('长\tchang2\n银行\n绿\tlv4\n水\twrong3');
      await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
      const long = dialog.locator('[data-character-import-row="长"]');
      await long.getByLabel('长的导入拼音', { exact: true }).fill('zhang3');
      await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="长的导入拼音"]')?.value === 'zhang3');
      assert.equal(await dialog.getByLabel('长的拼音预览', { exact: true }).innerText(), 'zhǎng');
      assert.equal(await dialog.locator('[data-character-import-row="水"]').getByRole('checkbox').isChecked(), false);
      await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'import dialog fits enlarged text');
      await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      let release, reached;
      const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { reached = resolve; });
      hold = { gate, reached };
      try {
        await dialog.getByRole('button', { name: '导入所选字词', exact: true }).click(); await bounded(ready);
        await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
        assert.equal(await dialog.getByLabel('字词列表', { exact: true }).isDisabled(), true);
        // Keep the saved response withheld until Axios times out. This models a lost
        // response without browser-specific automatic retry after a TCP reset.
        await dialog.getByRole('button', { name: '重试确认导入', exact: true }).waitFor({ timeout: 30000 });
        release();
        assert.equal(await dialog.getByLabel('字词列表', { exact: true }).isDisabled(), true);
        await dialog.getByRole('button', { name: '重试确认导入', exact: true }).click();
        await dialog.getByRole('status').filter({ hasText: '导入完成：新增 2 项，已有字词加入词本 1 项，跳过 0 项。' }).waitFor();
      } catch (error) { console.error('IMPORT DIAGNOSTIC', await page.evaluate(() => document.body.innerText), requestsFor(child.id)); throw error; }
      finally { release(); hold = null; }
      const requests = attempts.filter(body => body.child_id === child.id);
      assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]);
      const books = c.app.services.wordBooksService.list({ child_id: child.id, language: 'zh' }, { role: 'parent' }).items;
      assert.equal(books.length, 1); assert.equal(books[0].item_count, 3);
      assert.equal(c.app.services.charactersService.getCharacter(existing.id).pinyin, 'cháng');
      assert.equal(c.db.prepare('SELECT COUNT(*) n FROM word_import_receipts WHERE child_id = ?').get(child.id).n, 1);
      await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
      console.log(`PASS ${width}/${theme}: new book, automatic/numeric pinyin, retained corrections, invalid exclusion, lost response replay and save lock`);
    } finally { await context.close(); }
    const ownContext = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
    try {
      const token = c.app.jwt.sign({ role: 'child', child_id: child.id, epoch: c.app.sessionEpoch() });
      await useLocalLearningFont(ownContext);
      await ownContext.addInitScript(token => sessionStorage.setItem('taskie_child_token', token), token);
      const page = await ownContext.newPage(); page.setDefaultTimeout(15000);
      await page.goto(`${base}/child/${child.id}/characters`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: '批量导入字词', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '批量导入语文字词', exact: true });
      assert.equal(await dialog.getByLabel('导入到词本', { exact: true }).count(), 0);
      await dialog.getByLabel('字词列表', { exact: true }).fill('海');
      await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
      await dialog.getByRole('button', { name: '导入所选字词', exact: true }).click();
      await dialog.getByRole('status').filter({ hasText: '导入完成：新增 1 项' }).waitFor();
      assert.equal(Object.hasOwn(attempts.at(-1), 'book_id'), false); assert.equal(Object.hasOwn(attempts.at(-1), 'book_meta'), false);
    } finally { await ownContext.close(); }
  }
  assert.deepEqual(errors, []);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await c.app.close(); cleanupTestApp(c); c.db.close();
});
