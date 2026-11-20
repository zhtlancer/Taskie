const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeAudioFixture, wav, zip } = require('../backend/test/dictionary-audio-fixture');

async function focusCheck(page, dialog) {
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].at(-1)?.contains(document.activeElement));
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert.equal(await dialog.evaluate(el => ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)), false, 'opening a touch dialog must not focus an input');
  const controls = dialog.locator('a[href], button, input, textarea, select, summary, [tabindex="0"]');
  const enabled = await controls.evaluateAll(elements => elements.filter(el => el.getClientRects().length && !el.matches(':disabled')).map(el => {
    el.setAttribute('data-focus-check', ''); return el;
  }).length);
  assert.ok(enabled > 1);
  const focusable = dialog.locator('[data-focus-check]');
  await focusable.last().focus(); await page.keyboard.press('Tab');
  assert.equal(await focusable.first().evaluate(el => el === document.activeElement), true, 'Tab wraps to first dialog control');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await focusable.last().evaluate(el => el === document.activeElement), true, 'Shift+Tab wraps to last dialog control');
  await controls.evaluateAll(elements => elements.forEach(el => el.removeAttribute('data-focus-check')));
}

module.exports = async function checkEnglishInteractions({ browser, base, api, parentToken, openContext, errors, dictionaryService: dictionary }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-english-interactions-'));
  const keys = ['dictDir', 'cacheDir', 'indexPath', 'audioCacheDir'];
  const previous = Object.fromEntries(keys.map(key => [key, dictionary[key]]));
  await dictionary.buildPromise; dictionary.releaseIndex();
  Object.assign(dictionary, { dictDir: path.join(root, 'dicts'), cacheDir: path.join(root, 'cache'), indexPath: path.join(root, 'cache/index.sqlite'), audioCacheDir: path.join(root, 'cache/audio') });
  try {
    const { media, zipPath } = writeAudioFixture(dictionary.dictDir);
    fs.writeFileSync(zipPath, zip({ ...media, 'record_n_gb.wav': wav(145, 3), 'record_v_gb.wav': wav(150, 3) }));
    for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
      const child = await api('POST', '/children', { name: `触控与发音${width}` });
      const match = (await api('GET', '/dictionary/lookup?word=record')).exact_matches[0];
      await api('POST', '/english-words', { child_id: child.id, word: 'record', senses: match.senses, primary_sense_id: match.senses[0].id });
      const { context, page } = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
      let release = () => {};
      try {
        await context.addInitScript(() => {
          const NativeAudio = window.Audio;
          window.__interactionAudio = [];
          window.Audio = function(src) {
            const audio = new NativeAudio(src); window.__interactionAudio.push(audio); return audio;
          };
        });
        await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
        const card = page.locator('[data-english-word-card="record"]');
        await card.tap();
        const detail = page.getByRole('dialog', { name: 'record', exact: true });
        await focusCheck(page, detail);
        const articleOpener = detail.getByRole('button', { name: /查看完整原词典/ });
        await articleOpener.focus(); await articleOpener.tap();
        const article = page.getByRole('dialog', { name: '原词典 · record', exact: true });
        await focusCheck(page, article);
        await page.keyboard.press('Escape'); await article.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.textContent.includes('查看完整原词典'));
        assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');

        // Verify first playback after an authenticated fetch is triggered by a
        // real touch gesture; do not disable the browser's autoplay policy.
        const audioButtons = detail.locator('[data-english-pronunciations]').getByRole('button', { name: '🔊 英音', exact: true });
        await audioButtons.first().waitFor();
        let requests = 0;
        page.on('request', request => {
          if (new URL(request.url()).pathname.includes('/dictionary/audio/')) {
            requests++; assert.match(request.headers().authorization, /^Bearer /);
          }
        });
        await audioButtons.first().tap();
        await page.waitForFunction(() => window.__interactionAudio.some(audio => !audio.paused && audio.currentTime > 0));
        assert.ok(requests > 0);
        await audioButtons.last().tap();
        await page.waitForFunction(() => window.__interactionAudio.length === 2 && window.__interactionAudio[0].paused && !window.__interactionAudio[1].paused);
        await detail.getByRole('button', { name: '关闭', exact: true }).last().tap();
        await detail.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => window.__interactionAudio.every(audio => audio.paused)), true, 'closing stops playback');
        assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');

        // Closing while a first uncached download is held must prevent playback
        // when that successful response arrives after another modal opens.
        await page.reload({ waitUntil: 'domcontentloaded' }); await card.tap();
        let arrive, finish;
        const gate = new Promise(resolve => { release = resolve; });
        const arrived = new Promise(resolve => { arrive = resolve; });
        const done = new Promise(resolve => { finish = resolve; });
        await page.route('**/api/dictionary/audio/**', async route => {
          try {
            const response = await route.fetch(); arrive(); await gate;
            try { await route.fulfill({ response }); }
            catch (error) { if (!/already handled|has been closed|context disposed/i.test(error.message)) throw error; }
          } finally { finish(); }
        }, { times: 1 });
        await audioButtons.first().tap(); await bounded(arrived);
        const aborted = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname.includes('/dictionary/audio/'));
        await detail.getByRole('button', { name: '关闭', exact: true }).last().tap(); await detail.waitFor({ state: 'detached' });
        await aborted;
        await card.tap(); await detail.waitFor();
        release(); await bounded(done);
        assert.equal(await page.evaluate(() => window.__interactionAudio.length), 0, 'old fetch must not create a player in the reopened modal');
        await detail.getByRole('button', { name: /编辑释义与单元/ }).tap();
        await page.keyboard.press('Tab');
        await focusCheck(page, detail);
        await detail.getByRole('button', { name: '取消', exact: true }).tap();
        await detail.getByRole('button', { name: '关闭', exact: true }).last().tap();
        await page.getByRole('button', { name: /查词 · 收录单词/ }).tap();
        const lookup = page.getByRole('dialog', { name: '查词与收录单词', exact: true });
        const query = lookup.getByPlaceholder(/输入英文单词或短语/);
        await query.fill('record'); await lookup.getByRole('button', { name: /查词/, exact: true }).tap();
        await lookup.locator('[data-english-pronunciations]').getByRole('button', { name: '🔊 英音', exact: true }).first().tap();
        await page.waitForFunction(() => window.__interactionAudio.some(audio => !audio.paused && audio.currentTime > 0));
        await query.fill('recording'); await lookup.getByRole('button', { name: /查词/, exact: true }).tap();
        assert.equal(await page.evaluate(() => window.__interactionAudio.every(audio => audio.paused)), true, 'switching the lookup word stops old playback');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log(`PASS interactions ${browser.browserType().name()} ${width}/${theme}: touch playback after authenticated fetch, audio/word switch, close/late-response cancellation, nested focus, scroll lock and edit keyboard loop`);
      } finally { release(); await context.close(); }
    }
  } finally {
    await dictionary.buildPromise?.catch(() => {}); dictionary.releaseIndex(); Object.assign(dictionary, previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
};

async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Audio interception did not settle')), 12000); })]); }
  finally { clearTimeout(timer); }
}

if (require.main === module) (async () => {
  const { launchBrowser, smokePort } = require('./browser-env.cjs');
  const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
  const ctx = createTestApp({ clientDistDir: path.resolve(__dirname, '../frontend/dist'), dictDir: 'off' });
  let browser;
  try {
    await ctx.app.ready(); const base = await ctx.app.listen({ host: '127.0.0.1', port: smokePort() });
    const parentToken = ctx.app.jwt.sign({ role: 'parent', epoch: ctx.app.sessionEpoch() });
    const api = async (method, url, payload) => {
      const response = await ctx.app.inject({ method, url: `/api${url}`, payload }); assert.ok(response.statusCode < 300, response.body); return response.json();
    };
    const errors = [];
    const openContext = async (browser, base, width, theme, token, child) => {
      const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1024 }, colorScheme: theme, hasTouch: true, isMobile: process.env.BROWSER === 'webkit', serviceWorkers: 'block', reducedMotion: 'reduce' });
      await context.addInitScript(({ token, child, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child)); localStorage.setItem('taskie_theme', theme); localStorage.setItem('app_sound_muted', 'true');
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort()); return { context, page };
    };
    browser = await launchBrowser();
    await module.exports({ browser, base, api, parentToken, openContext, errors, dictionaryService: ctx.app.services.dictionaryService });
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await ctx.app.close(); cleanupTestApp(ctx); }
})().catch(error => { console.error(error); process.exitCode = 1; });
