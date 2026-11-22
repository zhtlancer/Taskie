const assert = require('node:assert/strict');

async function checkEnglishEdits({ browser, base, api, parentToken, openContext, errors }) {
  for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
    const child = await api('POST', '/children', { name: `冲突核对${width}` });
    const word = await api('POST', '/english-words', { child_id: child.id, word: 'bank', definition_zh: '银行', phonetic: 'bæŋk', note: '原笔记', textbook: '旧教材' });
    const first = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
    const second = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
    const url = `${base}/child/${child.id}/characters?lang=en`;
    const openEdit = async page => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('[data-english-word-card="bank"]').click();
      const dialog = page.getByRole('dialog', { name: 'bank', exact: true });
      await dialog.getByRole('button', { name: /编辑释义与笔记/ }).click(); return dialog;
    };
    const save = async (page, dialog) => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === `/api/english-words/${word.id}` && r.request().method() === 'PUT');
      await dialog.getByRole('button', { name: '保存修改', exact: true }).click(); return response;
    };
    try {
      const a = await openEdit(first.page), b = await openEdit(second.page);
      await a.getByLabel('记忆笔记', { exact: true }).fill('设备一的笔记');
      await b.getByLabel('默写时严格区分大小写', { exact: true }).check();
      assert.equal((await save(second.page, b)).status(), 200);
      assert.equal((await save(first.page, a)).status(), 409);
      const conflict = a.locator('[data-english-edit-conflict]'); await conflict.waitFor();
      assert.equal(await a.getByLabel('记忆笔记', { exact: true }).inputValue(), '设备一的笔记');
      assert.equal(await a.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);

      // Failed reads preserve the draft and can be retried locally.
      await first.page.route(`**/api/english-words/${word.id}`, route => route.fulfill({ status: 503, json: { error: '最新内容读取失败' } }), { times: 1 });
      await conflict.getByRole('button', { name: '读取最新内容', exact: true }).click();
      await a.getByRole('alert').getByText('最新内容读取失败', { exact: true }).waitFor();
      await conflict.getByRole('button', { name: '读取最新内容', exact: true }).click();
      await conflict.locator('[data-english-latest]').getByText('严格区分大小写：是', { exact: true }).waitFor();
      await conflict.getByRole('button', { name: '核对完成，保留我的更改继续编辑', exact: true }).click();
      assert.equal(await a.getByLabel('默写时严格区分大小写', { exact: true }).isChecked(), true);
      assert.equal(await a.getByLabel('记忆笔记', { exact: true }).inputValue(), '设备一的笔记');

      // A further remote edit after review must be checked again rather than forced through.
      let current = await api('GET', `/english-words/${word.id}`);
      await api('PUT', `/english-words/${word.id}`, { expected_version: current.version, unit: '远端第二次修改', phonetic: 'baŋk' });
      assert.equal((await save(first.page, a)).status(), 409);
      await conflict.getByRole('button', { name: '读取最新内容', exact: true }).click();
      await conflict.locator('[data-english-latest]').getByText(/远端第二次修改/).waitFor();
      await conflict.locator('[data-english-latest]').getByText('音标（未区分口音）：/baŋk/', { exact: true }).waitFor();
      await conflict.getByRole('button', { name: '核对完成，保留我的更改继续编辑', exact: true }).click();
      assert.equal((await save(first.page, a)).status(), 200);
      current = await api('GET', `/english-words/${word.id}`);
      assert.equal(current.note, '设备一的笔记'); assert.equal(current.strict_case, true); assert.equal(current.unit, '远端第二次修改');
      assert.equal(current.phonetic, 'baŋk', 'retaining a note draft must not clear remote generic phonetics');

      // Background refresh, including a remote rename, must not erase an open draft.
      await a.getByRole('button', { name: /编辑释义与笔记/ }).click();
      await a.getByLabel('记忆笔记', { exact: true }).fill('重命名前的草稿');
      await api('PUT', `/english-words/${word.id}`, { expected_version: current.version, word: 'banks', note: '最新远端笔记' });
      const refreshed = first.page.waitForResponse(r => new URL(r.url()).pathname === '/api/english-words');
      await first.page.evaluate(() => window.dispatchEvent(new Event('pageshow'))); await refreshed;
      const renamed = first.page.getByRole('dialog', { name: 'banks', exact: true }); await renamed.waitFor();
      assert.equal(await renamed.getByLabel('记忆笔记', { exact: true }).inputValue(), '重命名前的草稿');
      assert.equal((await save(first.page, renamed)).status(), 409);
      await renamed.getByRole('button', { name: '读取最新内容', exact: true }).click();
      await renamed.locator('[data-english-latest]').getByText(/最新远端笔记/).waitFor();
      await renamed.getByRole('button', { name: '使用最新内容重新编辑', exact: true }).click();
      assert.equal(await renamed.getByLabel('英文词条', { exact: true }).inputValue(), 'banks');
      assert.equal(await renamed.getByLabel('记忆笔记', { exact: true }).inputValue(), '最新远端笔记');

      // A restore while reading conflict details invalidates that read, even when
      // reopening the same word and immediately starting a new edit.
      current = await api('GET', `/english-words/${word.id}`);
      await api('PUT', `/english-words/${word.id}`, { expected_version: current.version, note: '恢复前的新内容' });
      assert.equal((await save(first.page, renamed)).status(), 409);
      let release, arrived, finished;
      const gate = new Promise(resolve => { release = resolve; });
      const began = new Promise(resolve => { arrived = resolve; });
      const done = new Promise(resolve => { finished = resolve; });
      await first.page.route(`**/api/english-words/${word.id}`, async route => {
        try {
          const response = await route.fetch(); arrived(); await gate;
          try { await route.fulfill({ response }); }
          catch (error) { if (!/already handled|has been closed|context disposed/i.test(error.message)) throw error; }
        } finally { finished(); }
      }, { times: 1 });
      try {
        await renamed.getByRole('button', { name: '读取最新内容', exact: true }).click();
        await bounded(began);
        await first.page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await first.page.getByRole('dialog').waitFor({ state: 'detached' });
        await first.page.locator('[data-english-word-card="banks"]').click();
        await renamed.getByRole('button', { name: /编辑释义与笔记/ }).click();
        await renamed.getByLabel('记忆笔记', { exact: true }).fill('恢复后新草稿');
        release(); await bounded(done);
        assert.equal(await renamed.getByLabel('记忆笔记', { exact: true }).inputValue(), '恢复后新草稿');
        assert.equal(await renamed.locator('[data-english-edit-conflict]').count(), 0);
        assert.equal(await renamed.getByRole('button', { name: '保存修改', exact: true }).isEnabled(), true);
      } finally { release(); }

      await renamed.getByLabel('记忆笔记', { exact: true }).fill('删除后的草稿');
      await api('DELETE', `/english-words/${word.id}`);
      assert.equal((await save(first.page, renamed)).status(), 404);
      await renamed.getByRole('button', { name: '读取最新内容', exact: true }).click();
      await renamed.getByRole('alert').getByText(/此单词已被移出/).waitFor();
      assert.equal(await renamed.getByLabel('记忆笔记', { exact: true }).inputValue(), '删除后的草稿');
      assert.equal(await first.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await renamed.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await renamed.locator('[data-english-edit-conflict]').count(), 0);
      assert.equal(await renamed.locator('button[aria-pressed]').first().isEnabled(), true);
      console.log(`PASS English edit conflicts ${width}/${theme}: two devices, read retry, retained draft, rebase, repeated conflict, remote rename, restore/read isolation, explicit latest and deletion`);
    } finally { await first.context.close(); await second.context.close(); }
  }
}
module.exports = checkEnglishEdits;

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Conflict read did not settle')), 12000); })]); }
  finally { clearTimeout(timer); }
}

if (require.main === module) (async () => {
  const path = require('node:path');
  const { browserEngine, launchBrowser, smokePort } = require('./browser-env.cjs');
  const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
  const ctx = createTestApp({ clientDistDir: path.resolve(__dirname, '../frontend/dist'), dictDir: 'off' });
  let browser;
  try {
    await ctx.app.ready(); const base = await ctx.app.listen({ host: '127.0.0.1', port: smokePort() });
    const parentToken = ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() });
    const api = async (method, url, payload) => { const response = await ctx.app.inject({ method, url: `/api${url}`, payload }); assert.ok(response.statusCode < 300, response.body); return response.json(); };
    const errors = [];
    const openContext = async (browser, base, width, theme, token, child, role) => {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, hasTouch: true, isMobile: browserEngine() === 'webkit', serviceWorkers: 'block', reducedMotion: 'reduce' });
      await context.addInitScript(({ token, child, theme }) => { sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child)); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true'); }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort()); return { context, page };
    };
    browser = await launchBrowser();
    await checkEnglishEdits({ browser, base, api, parentToken, openContext, errors }); assert.deepEqual(errors, []);
  } finally { await browser?.close(); await ctx.app.close(); cleanupTestApp(ctx); }
})().catch(error => { console.error(error); process.exitCode = 1; });
