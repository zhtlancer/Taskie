// Build first. Real API and isolated SQLite; exercises CharactersView, characterStore, cards and modals.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-child-characters-')), db = getDb(':memory:');
db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
const app = buildApp({ db, logger: false, deviceAuth: false, backupIntervalHours: 0,
  uploadDir: path.join(dir, 'uploads'), backupDir: path.join(dir, 'backups'), authorizedTokensFile: path.join(dir, 'tokens'),
  clientDistDir: path.resolve(__dirname, '../frontend/dist') });
let browser;

function attachHelpers(page, base) {
  const push = target => page.evaluate(target => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(target), target);
  const resume = () => page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  const errorBox = name => page.locator('[data-page-state=error]').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const hold = async (pattern, failure = false, status = 503, json = { error: '本轮模拟读取失败' }) => {
    let release, arrive, finish, count = 0;
    const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrive = resolve; }), done = new Promise(resolve => { finish = resolve; });
    const handler = async route => {
      count++;
      let fetched = null;
      try { fetched = await route.fetch(); } catch { fetched = null; }
      arrive(); await gate;
      try {
        if (failure) await route.fulfill({ status, json });
        else if (fetched) await route.fulfill({ response: fetched });
        else await route.abort();
      } catch (err) {
        if (!/closed|canceled|cancelled|Invalid Interception/i.test(err.message)) throw err;
      } finally { finish(); }
    };
    await page.route(pattern, handler);
    return { release, done, handler, count: () => count, started: async () => {
      let timer;
      try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`request did not start: ${pattern}`)), 12000); })]); }
      finally { clearTimeout(timer); }
    } };
  };
  let charReads = 0;
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === base && u.pathname === '/api/characters' && req.method() === 'GET') charReads++;
  });
  return { push, resume, errorBox, hold, charReads: () => charReads, resetCharReads: () => { charReads = 0; } };
}

async function openContext(base, width, theme, owner, seedChild, role = 'parent', errors = []) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 1024 },
    colorScheme: theme, hasTouch: true, timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', reducedMotion: 'reduce'
  });
  await context.addInitScript(({ owner, seedChild, theme, role }) => {
    if (owner) sessionStorage.setItem(`taskie_${role}_token`, owner);
    if (seedChild) sessionStorage.setItem('current_child', JSON.stringify(seedChild));
    localStorage.setItem('taskie_theme', theme);
    localStorage.setItem('app_sound_muted', 'true');
  }, { owner, seedChild, theme, role });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', err => errors.push(err.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return { context, page };
}

async function checkControlsAndOverflow(page, width, containerSelector = '[data-characters-page]') {
  const controls = await page.locator(`${containerSelector} button, ${containerSelector} a`).evaluateAll(items =>
    items.filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim() || el.getAttribute('aria-label') || el.title || '', width: r.width, height: r.height, left: r.left, right: r.right };
    })
  );
  for (const c of controls) assert.ok(c.height >= 43.9 && c.width >= 43.9 && c.left >= -0.5 && c.right <= width + 1, `${width}px control failed: ${JSON.stringify(c)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px horizontal overflow`);
}

async function main() {
  await app.ready();
  const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
  const token = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' }), errors = [];
  const api = async (method, url, payload, owner = token) => {
    const response = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${owner}` } });
    assert.ok(response.statusCode < 300, `${url}: ${response.body}`);
    return response.json();
  };

  for (const width of [320, 390, 820, 1024, 1180]) for (const theme of ['light', 'dark']) {
    browser = await chromium.launch(launchOptions());
    const child = await api('POST', '/children', { name: `字词甲${width}${theme}` });
    const other = await api('POST', '/children', { name: `字词乙${width}${theme}` });
    const empty = await api('POST', '/children', { name: `空字词${width}${theme}` });

    await api('POST', '/characters', { child_id: child.id, char: '山', pinyin: 'shān', strokes: 3, radical: '山', categories: ['write'] });
    await api('POST', '/characters', { child_id: child.id, char: '一举两得一心一意', pinyin: 'yī jǔ liǎng dé yī xīn yī yì', categories: ['error_prone'] });
    await api('POST', '/characters', { child_id: other.id, char: '独立字', pinyin: 'dú lì zì', categories: [] });

    const { context, page } = await openContext(base, width, theme, token, other, 'parent', errors);
    try {
      const { push, resume, errorBox, hold, charReads, resetCharReads } = attachHelpers(page, base);
      const visibleChar = text => page.locator('[data-characters-page] button:visible', { hasText: text }).first();
      const childCharsUrl = `**/api/characters?child_id=${child.id}*`;

      // 1) Slow initial request: placeholders, no zeros, no fake empty; then 503 failure + retry recovery.
      const initHold = await hold(childCharsUrl, true);
      try {
        await page.goto(`${base}/child/${child.id}/characters`, { waitUntil: 'domcontentloaded' });
        await initHold.started();
        await page.locator('[data-page-state="loading"]').getByText('正在读取生字生词本…', { exact: true }).waitFor();
        const summaryLoading = await page.locator('[data-characters-summary]').textContent();
        assert.match(summaryLoading, /共 — 项 · 已掌握 — · 学习中 — · 掌握率 —/);
        assert.equal(await page.locator('[data-characters-empty]').count(), 0);
        assert.equal(await page.getByText('0 项').count(), 0);
      } finally {
        initHold.release(); await initHold.done;
      }

      await errorBox('生字生词本未能读取').waitFor();
      assert.equal(await page.getByRole('button', { name: '关闭错误提示', exact: true }).count(), 0);
      assert.equal(await page.locator('[data-characters-empty]').count(), 0);
      assert.match(await page.locator('[data-characters-summary]').textContent(), /共 — 项/);

      await page.unroute(childCharsUrl, initHold.handler);
      await errorBox('生字生词本未能读取').getByRole('button', { name: '重新读取', exact: true }).click();
      await page.getByText('共 2 项 · 已掌握 0 · 学习中 2 · 掌握率 0%').waitFor();
      await visibleChar('一举两得一心一意').waitFor();

      // 2) Same-child background refresh keeps known entries while loading and on refresh error.
      const refreshFail = await hold(childCharsUrl, true);
      try {
        await resume(); await refreshFail.started();
        await page.getByText('正在更新生字生词本，当前显示上次读取的数据。', { exact: true }).waitFor();
        await visibleChar('一举两得一心一意').waitFor();
        refreshFail.release(); await refreshFail.done;
        await errorBox('生字生词本未能读取').waitFor();
        await visibleChar('一举两得一心一意').waitFor();
        assert.match(await page.locator('[data-characters-summary]').textContent(), /共 2 项/);
      } finally { refreshFail.release(); if (!page.isClosed()) await page.unroute(childCharsUrl, refreshFail.handler); }
      await resume(); await errorBox('生字生词本未能读取').waitFor({ state: 'detached' });

      // 3) Toggle card view on phones/tablets, preserve warm white Tian-Zi-Ge paper in dark mode, test mastery toggle failure & retry.
      if (width < 1024) {
        await page.getByRole('button', { name: '切换为字卡', exact: true }).click();
      }
      const cardPaperBg = await page.locator('[data-characters-page] .font-kai').first().evaluate(el => getComputedStyle(el.parentElement).backgroundColor);
      assert.equal(cardPaperBg, 'rgb(255, 253, 249)', 'calligraphy grid retains warm white paper in light/dark');

      await page.getByRole('button', { name: /全部拼音|拼音默认遮罩中/ }).click();
      await page.locator('[data-characters-page] button:visible', { hasText: 'yī jǔ liǎng dé yī xīn yī yì' }).first().waitFor();

      const failMaster = route => route.fulfill({ status: 500, json: { error: '本轮掌握保存失败' } });
      await page.route('**/api/characters/*/master', failMaster, { times: 1 });
      await page.locator('[data-characters-page] button[title*="已掌握"]').first().click();
      await page.locator('[data-characters-action-error]').getByText('本轮掌握保存失败', { exact: true }).waitFor();
      await page.locator('[data-characters-action-error]').getByRole('button', { name: '重试保存', exact: true }).click();
      await page.getByText('共 2 项 · 已掌握 1 · 学习中 1 · 掌握率 50%').waitFor();

      // 4) Status + category filtering vs empty filter result & clearing filter.
      await page.locator('summary', { hasText: '分类筛选' }).click();
      await page.getByRole('button', { name: /笔画要改正/ }).click();
      await page.locator('[data-characters-empty]').getByText('当前筛选下没有字词', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看全部字词', exact: true }).click();
      await visibleChar('一举两得一心一意').waitFor();

      // 5) Layout, touch sizing & no horizontal overflow in both main page & modals.
      await checkControlsAndOverflow(page, width);
      if (width === 320 || width === 1180) {
        await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
        const lookupDialog = page.getByRole('dialog', { name: '实时查笔画', exact: true });
        await lookupDialog.waitFor();
        await checkControlsAndOverflow(page, width, '[role="dialog"]');
        await page.keyboard.press('Escape');
        await lookupDialog.waitFor({ state: 'detached' });

        await page.getByRole('button', { name: '查看「一举两得一心一意」的笔顺与详情', exact: true }).click();
        const detailDialog = page.getByRole('dialog', { name: '生词笔顺与临摹', exact: true });
        await detailDialog.waitFor();
        await checkControlsAndOverflow(page, width, '[role="dialog"]');
        await page.keyboard.press('Escape');
        await detailDialog.waitFor({ state: 'detached' });
      }

      // 6) Stale child delayed 200 success & delayed failure cannot overwrite newly selected child.
      const staleOk = await hold(childCharsUrl, false);
      try {
        await resume(); await staleOk.started();
        await push(`/child/${other.id}/characters`);
        await page.getByText('共 1 项 · 已掌握 0 · 学习中 1 · 掌握率 0%').waitFor();
        await visibleChar('独立字').waitFor();
        staleOk.release(); await staleOk.done;
        assert.equal(await page.getByText('共 1 项').count(), 1);
        assert.equal(await page.getByText('一举两得一心一意').count(), 0);
      } finally { staleOk.release(); if (!page.isClosed()) await page.unroute(childCharsUrl, staleOk.handler); }

      // 7) Real empty child book shows empty book state cleanly.
      await push(`/child/${empty.id}/characters`);
      await page.getByText('共 0 项 · 已掌握 0 · 学习中 0 · 掌握率 0%').waitFor();
      await page.locator('[data-characters-empty]').getByText('生字生词本还是空的', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: '查看全部字词', exact: true }).count(), 0);
      assert.equal(await page.locator('[data-page-state=error]').count(), 0);

      // 8) Deep lifecycle, out-of-order restore, shared TodayTasksView entry & delayed mutation isolation (390px light).
      if (width === 390 && theme === 'light') {
        await push(`/child/${child.id}/characters`);
        await page.getByText('共 2 项 · 已掌握 1 · 学习中 1 · 掌握率 50%').waitFor();

        // A) Restore event while old 200 GET is still in flight: new data wins and stale 200 does not revert it.
        const preRestoreHold = await hold(childCharsUrl, false);
        try {
          await resume(); await preRestoreHold.started();
          await page.unroute(childCharsUrl, preRestoreHold.handler);
          await api('POST', '/characters', { child_id: child.id, char: '晴', pinyin: 'qíng', categories: [] });
          await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
          await page.getByText('共 3 项').waitFor();
          await visibleChar('晴').waitFor();
          preRestoreHold.release(); await preRestoreHold.done;
          assert.equal(await page.getByText('共 3 项').count(), 1);
          assert.equal(await visibleChar('晴').count(), 1);
        } finally { preRestoreHold.release(); if (!page.isClosed()) await page.unroute(childCharsUrl, preRestoreHold.handler); }

        // B) Delayed write isolation includes the reopened modal and a newer submission's busy state.
        await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
        const modal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
        await modal.getByRole('textbox').fill('云');
        const slowAdd = await hold('**/api/characters', false);
        try {
          await modal.getByRole('button', { name: /加入生字生词本/ }).click();
          await slowAdd.started();
          await page.unroute('**/api/characters', slowAdd.handler);
          await push(`/child/${other.id}/characters`);
          await page.getByText('共 1 项 · 已掌握 0 · 学习中 1 · 掌握率 0%').waitFor();
          await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
          const otherModal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
          assert.equal(await otherModal.getByRole('textbox').isDisabled(), false, 'old child submission does not lock the new modal');
          await otherModal.getByRole('textbox').fill('日');
          const newerAdd = await hold('**/api/characters', false);
          try {
            await otherModal.getByRole('button', { name: /加入生字生词本/ }).click();
            await newerAdd.started();
            const oldResponse = page.waitForResponse(response => response.request().method() === 'POST' &&
              response.url().endsWith('/api/characters') && response.request().postDataJSON()?.child_id === child.id);
            slowAdd.release(); await slowAdd.done;
            await (await oldResponse).finished();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
            assert.equal(await otherModal.getByRole('textbox').isDisabled(), true, 'old finally cannot release the newer submission');
            assert.equal(await otherModal.getByText('🌟 成功将「云」加入生字生词本！', { exact: true }).count(), 0);
            assert.equal(await page.getByText('共 1 项').count(), 1);
            newerAdd.release(); await newerAdd.done;
            await otherModal.getByText('🌟 成功将「日」加入生字生词本！', { exact: true }).waitFor();
            await page.getByText('共 2 项').waitFor();
            assert.equal((await api('GET', `/characters?child_id=${other.id}`)).some(row => row.char === '云'), false);
            await pageKeyboardClose(page, otherModal);
          } finally { newerAdd.release(); await page.unroute('**/api/characters', newerAdd.handler); }
        } finally { slowAdd.release(); if (!page.isClosed()) await page.unroute('**/api/characters', slowAdd.handler); }

        // C) Shared StrokeLookupModal from TodayTasksView respects child scope (other vs child).
        await push(`/child/${other.id}/today`);
        await page.getByTitle('实时查笔画', { exact: true }).click();
        let todayModal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
        await todayModal.getByRole('textbox').fill('山');
        await todayModal.getByRole('button', { name: /加入生字生词本/ }).waitFor();
        await todayModal.getByRole('textbox').fill('独立字');
        await todayModal.getByText('已在生字生词本', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await todayModal.waitFor({ state: 'detached' });

        // Test 409 server duplicate sync when lookup submits a word already saved elsewhere.
        await push(`/child/${child.id}/today`);
        await page.getByTitle('实时查笔画', { exact: true }).click();
        todayModal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
        await api('POST', '/characters', { child_id: child.id, char: '风', pinyin: 'fēng' });
        await page.route('**/api/characters', route => route.request().method() === 'POST'
          ? route.fulfill({ status: 409, json: { error: '该字词已在生字生词本中，请勿重复添加' } })
          : route.continue(), { times: 1 });
        await todayModal.getByRole('textbox').fill('风');
        await todayModal.getByRole('button', { name: /加入生字生词本/ }).click();
        await todayModal.getByText('该字词已在生字生词本中，请勿重复添加', { exact: true }).waitFor();
        await todayModal.getByText('已在生字生词本', { exact: true }).waitFor();
        await page.keyboard.press('Escape');
        await todayModal.waitFor({ state: 'detached' });

        // D) Leave CharactersView with in-flight read -> unmount cleans listeners -> return via mobile drawer reloads cleanly.
        await push(`/child/${child.id}/characters`);
        await page.getByText('共 5 项').waitFor();
        const leaveHold = await hold(childCharsUrl, false);
        try {
          await resume(); await leaveHold.started();
          await page.locator(`nav[aria-label="学生导航"] a[href="/child/${child.id}/today"]`).click();
          await page.waitForURL(`**/child/${child.id}/today`);
          leaveHold.release(); await leaveHold.done;
          await page.unroute(childCharsUrl, leaveHold.handler);
          resetCharReads();
          await resume();
          assert.equal(charReads(), 0, 'unmounted CharactersView no longer listens to pageshow');
          await page.getByRole('button', { name: '更多学习功能', exact: true }).click();
          await page.locator(`nav[aria-label="更多学习功能"] a[href="/child/${child.id}/characters"]`).click();
          await page.waitForURL(`**/child/${child.id}/characters`);
          await page.getByText('共 5 项').waitFor();
          assert.ok(charReads() >= 1, 'returning to CharactersView fetches fresh list');
        } finally { leaveHold.release(); if (!page.isClosed()) await page.unroute(childCharsUrl, leaveHold.handler); }

        // E) Detail modal: category toggle fail + retry, nested delete confirmation focus & deletion.
        await page.locator('button:visible', { hasText: '风' }).first().click();
        const detail = page.getByRole('dialog', { name: '生字笔顺与临摹', exact: true });
        await detail.waitFor();
        await page.route('**/api/characters/*/categories', route => route.fulfill({ status: 500, json: { error: '分类保存失败试错' } }), { times: 1 });
        await detail.getByRole('button', { name: /会写/ }).click();
        await detail.getByText('分类保存失败试错', { exact: true }).waitFor();
        await detail.getByRole('button', { name: /会写/ }).click();
        await assert.doesNotReject(() => detail.locator('button[aria-pressed="true"]', { hasText: '会写' }).waitFor());

        await detail.getByRole('button', { name: '移出', exact: true }).click();
        const confirm = page.getByRole('dialog', { name: '确认操作', exact: true });
        await confirm.getByRole('button', { name: '确认', exact: true }).click();
        await detail.waitFor({ state: 'detached' });
        await page.getByText('共 4 项').waitFor();

        // F) A pre-save list response must not revert confirmed mastery/category/delete writes.
        await page.getByRole('button', { name: '切换为字卡', exact: true }).click();
        const savingEntry = (await api('GET', `/characters?child_id=${child.id}`)).find(row => row.char === '山');
        await page.getByRole('button', { name: '查看「山」的笔顺与详情', exact: true }).click();
        const savingDetail = page.getByRole('dialog', { name: '生字笔顺与临摹', exact: true });
        const raceRefreshWithSave = async (save, verify) => {
          const oldRead = await hold(childCharsUrl, false);
          try {
            await resume(); await oldRead.started();
            await page.unroute(childCharsUrl, oldRead.handler);
            await save();
            oldRead.release(); await oldRead.done;
            await page.getByText('正在更新生字生词本，当前显示上次读取的数据。', { exact: true }).waitFor({ state: 'detached' });
            await verify();
          } finally { oldRead.release(); await page.unroute(childCharsUrl, oldRead.handler); }
        };
        const masteryAfterSave = savingEntry.is_mastered ? '⭐ 标记为已掌握' : '✅ 已掌握（点击改为学习中）';
        await raceRefreshWithSave(async () => {
          await savingDetail.getByRole('button', { name: /标记为已掌握|已掌握（点击改为学习中）/ }).click();
          await savingDetail.getByRole('button', { name: masteryAfterSave, exact: true }).waitFor();
        }, async () => {
          assert.equal(await savingDetail.getByRole('button', { name: masteryAfterSave, exact: true }).count(), 1);
          const saved = (await api('GET', `/characters?child_id=${child.id}`)).find(row => row.id === savingEntry.id);
          assert.equal(Boolean(saved.is_mastered), !Boolean(savingEntry.is_mastered));
        });
        await raceRefreshWithSave(async () => {
          await savingDetail.getByRole('button', { name: /笔画要改正/ }).click();
          await savingDetail.locator('button[aria-pressed="true"]', { hasText: '笔画要改正' }).waitFor();
        }, async () => {
          assert.equal(await savingDetail.locator('button[aria-pressed="true"]', { hasText: '笔画要改正' }).count(), 1);
        });
        await raceRefreshWithSave(async () => {
          await savingDetail.getByRole('button', { name: '移出', exact: true }).click();
          await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '确认', exact: true }).click();
          await savingDetail.waitFor({ state: 'detached' });
        }, async () => {
          assert.equal(await page.getByRole('button', { name: '查看「山」的笔顺与详情', exact: true }).count(), 0);
          assert.equal((await api('GET', `/characters?child_id=${child.id}`)).some(row => row.id === savingEntry.id), false);
        });

        // G) Start the POST first but hold it before the server; the later GET still has pre-write data.
        await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
        const addingModal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
        await addingModal.getByRole('textbox').fill('雨');
        let releaseWrite;
        const writeGate = new Promise(resolve => { releaseWrite = resolve; });
        const beforeSend = async route => { await writeGate; await route.continue(); };
        await page.route('**/api/characters', beforeSend);
        const oldAddRead = await hold(childCharsUrl, false);
        try {
          const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/characters'));
          await addingModal.getByRole('button', { name: /加入生字生词本/ }).click();
          await submitted;
          await resume(); await oldAddRead.started();
          await page.unroute(childCharsUrl, oldAddRead.handler);
          releaseWrite();
          await addingModal.getByText('🌟 成功将「雨」加入生字生词本！', { exact: true }).waitFor();
          oldAddRead.release(); await oldAddRead.done;
          await page.getByText('正在更新生字生词本，当前显示上次读取的数据。', { exact: true }).waitFor({ state: 'detached' });
          assert.equal(await addingModal.getByText('已在生字生词本', { exact: true }).count(), 1);
          assert.equal((await api('GET', `/characters?child_id=${child.id}`)).some(row => row.char === '雨'), true);
        } finally {
          releaseWrite(); oldAddRead.release();
          await page.unroute('**/api/characters', beforeSend);
          await page.unroute(childCharsUrl, oldAddRead.handler);
        }
        await pageKeyboardClose(page, addingModal);

        // H) Old failure must not surface after returning to the same child in a new data generation.
        await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
        const staleErrorModal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
        await staleErrorModal.getByRole('textbox').fill('霜');
        const oldFailure = await hold('**/api/characters', true, 503, { error: '旧收录请求失败' });
        try {
          await staleErrorModal.getByRole('button', { name: /加入生字生词本/ }).click();
          await oldFailure.started();
          await page.unroute('**/api/characters', oldFailure.handler);
          await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
          await staleErrorModal.waitFor({ state: 'detached' });
          await page.getByRole('button', { name: /查笔画 · 一键入本/ }).click();
          const freshModal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
          await freshModal.getByRole('textbox').fill('星');
          const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/characters'));
          oldFailure.release(); await oldFailure.done;
          await (await response).finished();
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
          assert.equal(await freshModal.getByText('旧收录请求失败', { exact: true }).count(), 0);
          assert.equal(await freshModal.getByRole('textbox').isDisabled(), false);
          await pageKeyboardClose(page, freshModal);
        } finally { oldFailure.release(); await page.unroute('**/api/characters', oldFailure.handler); }
        console.log('PASS confirmed writes survive stale reads; old adds cannot leak success/error or unlock a newer modal submission');
      }
      console.log(`PASS ${width}px ${theme}: loading, error/retry, refresh retain, filters, empty/layout, modals & stale isolation`);
    } finally {
      await context.close();
      await browser.close();
      browser = undefined;
    }
    await api('DELETE', `/children/${child.id}`); await api('DELETE', `/children/${other.id}`); await api('DELETE', `/children/${empty.id}`);
  }

  // Dedicated Auth & Session-Change Scenario: Child role route guard, category/delete restrictions, 403 sibling isolation, and session-changed race.
  const childA = await api('POST', '/children', { name: '字词权限甲' });
  const childB = await api('POST', '/children', { name: '字词权限乙' });
  const entryA = await api('POST', '/characters', { child_id: childA.id, char: '雪', pinyin: 'xuě', categories: ['fix_strokes'] });
  const entryB = await api('POST', '/characters', { child_id: childB.id, char: '月', pinyin: 'yuè', categories: [] });
  const childAToken = (await app.inject({ method: 'POST', url: '/api/auth/child-login', payload: { child_id: childA.id } })).json().token;

  browser = await chromium.launch(launchOptions());
  const { context: authCtx, page: authPage } = await openContext(base, 390, 'dark', childAToken, childA, 'child', errors);
  try {
    const { hold, resume, charReads, resetCharReads } = attachHelpers(authPage, base);
    await authPage.goto(`${base}/child/${childA.id}/characters`, { waitUntil: 'networkidle' });
    await authPage.getByText('共 1 项').waitFor();

    // Child can add a new category, cannot remove parent-marked category, and cannot delete categorized entry.
    await authPage.locator('button:visible', { hasText: '雪' }).first().click();
    const detail = authPage.getByRole('dialog', { name: '生字笔顺与临摹', exact: true });
    await detail.getByRole('button', { name: /笔画要改正/ }).click();
    await detail.getByText('去掉「笔画要改正」需要家长操作', { exact: true }).waitFor();
    assert.equal(await detail.getByRole('button', { name: '移出', exact: true }).isDisabled(), true);
    await pageKeyboardClose(authPage, detail);

    // Server-side child ownership & category/delete boundaries (403).
    assert.equal((await app.inject({ method: 'GET', url: `/api/characters?child_id=${childB.id}`, headers: { authorization: `Bearer ${childAToken}` } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/characters', payload: { child_id: childB.id, char: '星' }, headers: { authorization: `Bearer ${childAToken}` } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `/api/characters/${entryB.id}`, headers: { authorization: `Bearer ${childAToken}` } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/characters/${entryA.id}/categories`, payload: { categories: [] }, headers: { authorization: `Bearer ${childAToken}` } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/characters/${entryA.id}`, headers: { authorization: `Bearer ${childAToken}` } })).statusCode, 403);

    // Child browser route guard blocks direct sibling URL without requesting sibling characters.
    resetCharReads();
    await authPage.goto(`${base}/child/${childB.id}/characters`, { waitUntil: 'networkidle' });
    await authPage.waitForURL(`${base}/`);
    assert.equal(charReads(), 0);

    // Session change clears characters and ignores delayed old-session 200 response.
    await authPage.goto(`${base}/child/${childA.id}/characters`, { waitUntil: 'networkidle' });
    await authPage.locator('[data-characters-page] button:visible', { hasText: '雪' }).first().waitFor();
    const childACharsUrl = `**/api/characters?child_id=${childA.id}*`;
    const sessionHold = await hold(childACharsUrl, false);
    try {
      await resume(); await sessionHold.started();
      await authPage.evaluate(() => {
        sessionStorage.removeItem('taskie_child_token');
        window.dispatchEvent(new Event('taskie:session-changed'));
      });
      await authPage.getByText('共 — 项').waitFor();
      sessionHold.release(); await sessionHold.done;
      assert.equal(await authPage.getByText('雪', { exact: true }).count(), 0);
      await authPage.unroute(childACharsUrl, sessionHold.handler);
      await authPage.evaluate(tok => {
        sessionStorage.setItem('taskie_child_token', tok);
        window.dispatchEvent(new Event('taskie:session-changed'));
      }, childAToken);
      await authPage.getByText('共 1 项').waitFor();
      await authPage.locator('[data-characters-page] button:visible', { hasText: '雪' }).first().waitFor();
    } finally { sessionHold.release(); if (!authPage.isClosed()) await authPage.unroute(childACharsUrl, sessionHold.handler); }

    console.log('PASS child permissions, route guard, category/delete restrictions and session-changed isolation');
  } finally {
    await authCtx.close();
    await browser.close();
    browser = undefined;
  }

  assert.deepEqual(errors, []);
}

async function pageKeyboardClose(page, modal) {
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await app.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
