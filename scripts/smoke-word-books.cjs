const { useLocalLearningFont } = require('./word-book-fonts.cjs');
// Build first. Temporary SQLite, real HTTP writes; TASKIE_BROWSER also supports WebKit.
const assert = require('node:assert/strict');
const { launchBrowser, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const c = createTestApp({ dictDir: null });
let browser;
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 20000); })]); }
  finally { clearTimeout(timer); }
}
async function main() {
  let heldCreate, heldImport;
  const importAttempts = [];
  c.app.addHook('onSend', async (request, reply, payload) => {
    if (heldCreate && request.method === 'POST' && request.url.replace(/\/$/, '') === '/api/word-books') {
      heldCreate.reached(); await heldCreate.gate;
    }
    if (request.method === 'POST' && request.url === '/api/english-words/batch') {
      importAttempts.push(request.body);
      if (heldImport) { const current = heldImport; heldImport = null; current.reached(); await current.gate; }
    }
    return payload;
  });
  await c.app.ready();
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const parentToken = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() }), errors = [];
  const api = async (method, url, payload) => {
    const response = await c.app.inject({ method, url: `/api${url}`, payload });
    assert.ok(response.statusCode < 300, response.body); return response.json();
  };
  browser = await launchBrowser();
  for (const [width, theme] of [[320, 'light'], [390, 'dark'], [820, 'light'], [1024, 'dark'], [1180, 'light']]) {
    const child = await api('POST', '/children', { name: `词本界面-${width}` });
    for (const char of ['长', '学']) await api('POST', '/characters', { child_id: child.id, char });
    for (const word of ['apple', 'book']) await api('POST', '/english-words', { child_id: child.id, word, definition_zh: word });
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, locale: 'zh-CN', hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
    try {
      await useLocalLearningFont(context);
      await context.addInitScript(({ token, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); localStorage.setItem('taskie_theme', theme);
        // NAS deployments also work over plain HTTP, where randomUUID is unavailable.
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
      }, { token: parentToken, theme });
      const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => errors.push(e.message));
      for (const lang of ['zh', 'en']) {
        console.log(`CHECK ${width}/${theme}/${lang}: opening word books`);
        await page.goto(`${base}/child/${child.id}/characters${lang === 'en' ? '?lang=en' : ''}`, { waitUntil: 'domcontentloaded' });
        const panel = page.getByRole('region', { name: '词本与来源', exact: true });
        await panel.getByRole('button', { name: '新建词本', exact: true }).click();
        const editor = page.getByRole('dialog', { name: '新建词本', exact: true });
        const source = lang === 'zh' ? '语文资料' : '英语资料', title = `${source} · 第一单元`;
        await editor.getByLabel('来源（选填）', { exact: true }).fill(source);
        await editor.getByLabel('单元/章节（选填）', { exact: true }).fill('第一单元');
        assert.equal(await editor.getByLabel('词本名称', { exact: true }).inputValue(), title);
        if (width === 320 && lang === 'zh') {
          let release, reached;
          const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { reached = resolve; });
          heldCreate = { reached, gate };
          try {
            await editor.getByRole('button', { name: '保存词本', exact: true }).click(); await bounded(ready, 'held create response');
            await page.keyboard.press('Escape'); assert.equal(await editor.isVisible(), true);
            assert.equal(await editor.getByLabel('词本名称', { exact: true }).isDisabled(), true);
            release(); await editor.waitFor({ state: 'detached' });
          } finally { release(); heldCreate = null; }
        } else {
          await editor.getByRole('button', { name: '保存词本', exact: true }).click(); await editor.waitFor({ state: 'detached' });
        }
        const book = (await api('GET', `/word-books?child_id=${child.id}&language=${lang}`)).items.find(row => row.name === title);
        await panel.getByLabel('按词本筛选', { exact: true }).selectOption(book.id);
        await panel.getByRole('button', { name: '管理词条', exact: true }).click();
        const manager = page.getByRole('dialog', { name: `管理词条 · ${title}`, exact: true }), text = lang === 'zh' ? '长' : 'apple';
        await manager.getByRole('button', { name: `加入「${text}」`, exact: true }).click();
        await manager.getByRole('button', { name: `移出「${text}」`, exact: true }).waitFor();
        if (lang === 'zh') {
          await manager.getByLabel('「长」在本词本的读音', { exact: true }).fill('zhang3');
          const saved = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().includes('/word-books/'));
          await manager.getByRole('button', { name: '保存读音', exact: true }).click(); assert.equal((await saved).status(), 200);
          await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.getAttribute('aria-label') === '「长」在本词本的读音' && input.value === 'zhǎng'));
        }
        await manager.getByRole('button', { name: '关闭', exact: true }).click();
        if (lang === 'zh') {
          if (width < 1024) await page.getByRole('button', { name: '切换为字卡', exact: true }).click();
          await page.getByRole('button', { name: '查看「长」的笔顺与详情', exact: true }).click();
        } else await page.locator('[data-english-word-card="apple"]').click();
        const detail = page.getByRole('dialog').last();
        const membership = detail.getByRole('region', { name: '字词的词本归属', exact: true });
        await membership.getByRole('button', { name: `从「${title}」移出`, exact: true }).click();
        await membership.getByText('未分本', { exact: true }).waitFor();
        await detail.getByRole('button', { name: '关闭', exact: true }).last().click();
        assert.equal((await api('GET', `/${lang === 'zh' ? 'characters' : 'english-words'}?child_id=${child.id}`)).length, 2, 'removing a membership preserves both words');
        await page.getByRole('button', { name: lang === 'zh' ? /查笔画 · 一键入本/ : /查词 · 收录单词/ }).click();
        const lookup = page.getByRole('dialog', { name: lang === 'zh' ? '实时查笔画' : '查词与收录单词', exact: true });
        if (lang === 'zh') await lookup.getByLabel('汉字或词语', { exact: true }).fill('河');
        else await lookup.getByLabel('英文词条 *', { exact: true }).fill('river');
        await lookup.getByLabel('收录到词本', { exact: true }).selectOption(book.id);
        const collected = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/${lang === 'zh' ? 'characters' : 'english-words'}`);
        await lookup.getByRole('button', { name: lang === 'zh' ? /加入生字生词本/ : '加入单词本' }).click();
        const response = await collected; assert.equal(response.status(), 201); assert.equal((await response.json()).books[0].id, book.id);
        if (lang === 'zh') await lookup.getByRole('button', { name: '关闭', exact: true }).click();
        else await lookup.waitFor({ state: 'detached' });
        await panel.getByRole('button', { name: '编辑词本', exact: true }).click();
        await page.getByRole('dialog', { name: '编辑词本', exact: true }).getByRole('button', { name: '删除词本', exact: true }).click();
        await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal((await api('GET', `/word-books?child_id=${child.id}&language=${lang}`)).items.length, 0);
        assert.equal((await api('GET', `/${lang === 'zh' ? 'characters' : 'english-words'}?child_id=${child.id}`)).length, 3, 'deleting the source preserves the newly collected word too');
        if (lang === 'en') {
          await page.getByRole('button', { name: /批量导入/ }).click();
          const batch = page.getByRole('dialog', { name: '批量导入英语单词', exact: true });
          await batch.getByLabel('导入到词本', { exact: true }).selectOption('new');
          await batch.getByLabel('来源（选填）', { exact: true }).fill('英语课外');
          await batch.getByLabel('单元/章节（选填）', { exact: true }).fill('U2');
          await batch.getByRole('textbox', { name: '单词列表', exact: true }).fill('apple\nMay\t五月\nmay\t可以');
          await batch.getByRole('button', { name: '不查词，手工预览', exact: true }).click();
          await batch.getByText('已有单词，仅加入词本', { exact: true }).waitFor();
          for (const word of ['May', 'may']) await batch.locator(`[data-english-import-word="${word}"]`).getByLabel(`确认将“${word}”作为独立词条保留`, { exact: true }).check();
          let imported;
          const waitForImport = () => page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/english-words/batch');
          if (width === 320) {
            let release, reached;
            const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { reached = resolve; });
            heldImport = { gate, reached };
            try {
              await batch.getByRole('button', { name: '确认导入 (3)', exact: true }).click(); await bounded(ready, 'held English import response');
              await page.keyboard.press('Escape'); assert.equal(await batch.isVisible(), true);
              await batch.getByRole('button', { name: '重试确认导入', exact: true }).waitFor({ timeout: 30000 });
              assert.equal(await batch.getByRole('textbox', { name: '单词列表', exact: true }).isDisabled(), true);
              release(); imported = waitForImport();
              await batch.getByRole('button', { name: '重试确认导入', exact: true }).click();
            } finally { release(); heldImport = null; }
            const attempts = importAttempts.filter(body => body.child_id === child.id);
            // The second body is checked after its HTTP response below.
            assert.ok(attempts.length >= 1);
          } else {
            imported = waitForImport(); await batch.getByRole('button', { name: '确认导入 (3)', exact: true }).click();
          }
          const saved = await imported; assert.equal(saved.status(), 201);
          const receipt = await saved.json(); assert.equal(receipt.added_count, 2); assert.equal(receipt.linked_count, 1);
          if (width === 320) { const attempts = importAttempts.filter(body => body.child_id === child.id); assert.equal(attempts.length, 2); assert.deepEqual(attempts[1], attempts[0]); }
          await batch.waitFor({ state: 'detached' });
          await page.getByRole('status').filter({ hasText: '导入完成：新增 2 项，已有单词加入词本 1 项，跳过 0 项。' }).waitFor();
          assert.equal((await api('GET', `/word-books/${receipt.book.id}/items`)).total, 3);
          assert.equal((await api('GET', `/english-words?child_id=${child.id}`)).length, 5);
        }
        await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page fits enlarged text');
        await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
      }
      await page.getByRole('button', { name: '新建词本', exact: true }).click();
      await page.getByRole('dialog', { name: '新建词本', exact: true }).getByLabel('词本名称', { exact: true }).fill('恢复前的草稿');
      await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      console.log(`PASS ${width}/${theme}: bilingual source CRUD, membership, pinyin, save lock, preserved words, enlarged layout and restore isolation`);
    } finally { await context.close(); }
    const childToken = c.app.jwt.sign({ role: 'child', child_id: child.id, epoch: c.app.sessionEpoch() });
    const childContext = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
    try {
      await useLocalLearningFont(childContext);
      await childContext.addInitScript(token => sessionStorage.setItem('taskie_child_token', token), childToken);
      const page = await childContext.newPage();
      await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
      assert.equal(await page.getByRole('button', { name: '新建词本', exact: true }).count(), 0);
      await page.locator('[data-english-word-card="apple"]').click();
      assert.equal(await page.getByLabel('加入已有词本', { exact: true }).count(), 0);
    } finally { await childContext.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await c.app.close(); cleanupTestApp(c); c.db.close();
});
