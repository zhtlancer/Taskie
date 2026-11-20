// Build first. Parent/child homepage, real API, temporary dictionary and database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { browserEngine, launchBrowser, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { writeAudioFixture } = require('../backend/test/dictionary-audio-fixture');

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Held query did not settle')), 15000); })]); }
  finally { clearTimeout(timer); }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-unified-lookup-'));
  const dictDir = path.join(root, 'dicts'); writeAudioFixture(dictDir);
  const ctx = createTestApp({ dictDir, dictCacheDir: path.join(root, 'cache'), clientDistDir: path.resolve(__dirname, '../frontend/dist') });
  let browser;
  try {
    await ctx.app.ready();
    const base = await ctx.app.listen({ host: '127.0.0.1', port: smokePort() });
    const api = async (method, url, payload) => { const r = await ctx.app.inject({ method, url: `/api${url}`, payload }); assert.ok(r.statusCode < 300, r.body); return r.json(); };
    browser = await launchBrowser(); const errors = [];
    for (const role of ['child', 'parent']) for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
      const child = await api('POST', '/children', { name: `统一查询${role}${width}` });
      const token = ctx.app.jwt.sign({ role, ...(role === 'child' ? { child_id: child.id } : {}), epoch: ctx.app.sessionEpoch() });
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, hasTouch: true, isMobile: browserEngine() === 'webkit', serviceWorkers: 'block', reducedMotion: 'reduce' });
      let release = () => {};
      try {
        await context.addInitScript(({ token, role, child, theme }) => {
          sessionStorage.setItem(`taskie_${role}_token`, token); sessionStorage.setItem('current_child', JSON.stringify(child));
          localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
          const NativeAudio = window.Audio; window.__lookupPlayed = [];
          window.Audio = function(src) { const audio = new NativeAudio(src); audio.addEventListener('ended', () => window.__lookupPlayed.push(audio.duration)); return audio; };
        }, { token, role, child, theme });
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
        await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('calendar')?.ready);
        const opener = page.getByRole('button', { name: '查字 / 查词', exact: true });
        await opener.tap();
        const dialog = page.getByRole('dialog', { name: '查字 / 查词', exact: true });
        let input = dialog.getByLabel('汉字或英文', { exact: true });
        await input.waitFor(); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '汉字或英文');
        assert.equal(await input.inputValue(), '', 'homepage lookup starts empty');
        let dictionaryReads = 0;
        page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/dictionary/lookup')) dictionaryReads++; });
        await input.fill('学apple'); await dialog.getByRole('button', { name: '查询', exact: true }).tap();
        await dialog.getByRole('alert').getByText(/中英混合/).waitFor();
        assert.equal(await dialog.getByRole('button', { name: /加入生字生词本/ }).isDisabled(), true);
        assert.equal(dictionaryReads, 0);

        // Pinyin during composition must not switch to English or issue dictionary reads.
        await input.dispatchEvent('compositionstart'); await input.fill('chuntian'); await input.press('Enter');
        assert.equal(await dialog.getByText('录入英语单词本', { exact: true }).count(), 0); assert.equal(dictionaryReads, 0);
        await input.fill('春天'); await input.dispatchEvent('compositionend', { data: '春天' });
        await dialog.getByRole('button', { name: /加入生字生词本/ }).tap();
        await dialog.getByText(/成功将「春天」加入/).waitFor();
        assert.deepEqual((await api('GET', `/characters?child_id=${child.id}`)).map(item => item.char), ['春天']);

        // Submitting English replaces the content, carries the complete input and queries automatically.
        await input.fill('record'); await input.press('Enter');
        await dialog.getByText('录入英语单词本', { exact: true }).waitFor();
        input = dialog.getByLabel('汉字或英文', { exact: true });
        await dialog.getByText('英 /ˈrekɔːd/', { exact: true }).waitFor();
        assert.equal(await input.inputValue(), 'record');
        assert.equal(await dialog.getByLabel('教材/分类（选填）', { exact: true }).isDisabled(), role === 'child');
        await dialog.getByPlaceholder('例如：n. 苹果').fill('课堂记录');
        let arrived, finished;
        let gate = new Promise(resolve => { release = resolve; });
        const saving = new Promise(resolve => { arrived = resolve; });
        const doneSave = new Promise(resolve => { finished = resolve; });
        await page.route('**/api/english-words', async route => {
          try { arrived(); await gate; await route.continue(); } finally { finished(); }
        }, { times: 1 });
        await dialog.getByRole('button', { name: '加入单词本', exact: true }).tap(); await bounded(saving);
        await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
        assert.equal(await input.isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: '查询', exact: true }).isDisabled(), true);
        release(); await bounded(doneSave); await dialog.waitFor({ state: 'detached' });
        const saved = (await api('GET', `/english-words?child_id=${child.id}`));
        assert.equal(saved.length, 1); assert.equal(saved[0].word, 'record'); assert.equal(saved[0].definition_zh, '课堂记录');
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查字 / 查词');
        assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');

        await opener.tap(); input = dialog.getByLabel('汉字或英文', { exact: true });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '汉字或英文');
        assert.equal(await input.inputValue(), '');
        await page.route('**/api/dictionary/lookup?word=record', route => route.fulfill({ status: 503, json: { error: '词典暂时不可用' } }), { times: 1 });
        await input.fill('record'); await dialog.getByRole('button', { name: '查询', exact: true }).tap();
        await dialog.getByRole('button', { name: '重试查询', exact: true }).waitFor();
        await dialog.getByRole('button', { name: '重试查询', exact: true }).tap();
        await dialog.getByText('英 /ˈrekɔːd/', { exact: true }).waitFor();
        await dialog.getByText('✅ 已在单词本中', { exact: true }).waitFor();
        await dialog.locator('[data-english-pronunciations]').getByRole('button', { name: '🔊 英音', exact: true }).first().tap();
        await page.waitForFunction(() => window.__lookupPlayed.length === 1);
        await dialog.getByRole('button', { name: /查看完整原词典/ }).tap();
        const article = page.getByRole('dialog', { name: '原词典 · record', exact: true }); await article.waitFor();
        await page.keyboard.press('Escape'); await article.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');

        // A slow English success must not replace the Chinese view after switching back.
        let arriveRead, finishRead; gate = new Promise(resolve => { release = resolve; });
        const readStarted = new Promise(resolve => { arriveRead = resolve; });
        const doneRead = new Promise(resolve => { finishRead = resolve; });
        await page.route('**/api/dictionary/lookup?word=oldword', async route => {
          try {
            const response = await route.fetch(); arriveRead(); await gate;
            try { await route.fulfill({ response }); } catch (error) { if (!/already handled|has been closed|context disposed/i.test(error.message)) throw error; }
          } finally { finishRead(); }
        }, { times: 1 });
        await input.fill('oldword'); await dialog.getByRole('button', { name: '查询', exact: true }).tap(); await bounded(readStarted);
        await input.fill('秋天'); await dialog.getByRole('button', { name: '查询', exact: true }).tap();
        await dialog.getByRole('button', { name: /加入生字生词本/ }).waitFor();
        release(); await bounded(doneRead);
        input = dialog.getByLabel('汉字或英文', { exact: true });
        assert.equal(await input.inputValue(), '秋天'); assert.equal(await dialog.getByText('录入英语单词本', { exact: true }).count(), 0);
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await dialog.waitFor({ state: 'detached' });
        await opener.tap(); await dialog.getByLabel('汉字或英文', { exact: true }).waitFor();
        assert.equal(await dialog.getByLabel('汉字或英文', { exact: true }).inputValue(), '');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log(`PASS unified lookup ${browser.browserType().name()} ${role} ${width}/${theme}: IME, mixed-input rejection, Chinese/English collection, retry, duplicates, playback/article, save lock, stale read, restore and focus`);
      } finally { release(); await context.close(); }
    }
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await ctx.app.close(); cleanupTestApp(ctx); fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
