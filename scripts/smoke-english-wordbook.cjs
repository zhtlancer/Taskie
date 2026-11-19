// Build first. Real API + isolated SQLite + synthetic GoldenDict dict/ZIP-audio fixture;
// exercises English lookup, audio playback, original dictionary viewer, batch import, plans, and spelling/recognize study.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { getDb } = require('../backend/src/db');
const buildApp = require('../backend/src/app');
const checkEnglishModalRaces = require('./english-wordbook-races.cjs');
const checkEnglishCaseRules = require('./english-case-browser.cjs');

function makeSyntheticBglBlock(headword, gbBytes, posByte = 0x30, inflections = []) {
  const hwBuf = Buffer.from(headword, 'latin1');
  const mainBuf = Buffer.from(gbBytes);
  const defBuf = Buffer.concat([mainBuf, Buffer.from([0x14, 0x02, posByte])]);
  const tail = inflections.map(f => {
    const b = Buffer.from(f, 'latin1');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  const defLen = Buffer.from([(defBuf.length >> 8) & 0xff, defBuf.length & 0xff]);
  const payload = Buffer.concat([Buffer.from([hwBuf.length]), hwBuf, defLen, defBuf, ...tail]);
  const len = payload.length;
  const header = len <= 11
    ? Buffer.from([((len + 4) << 4) | 0x01])
    : len < 256
      ? Buffer.from([0x01, len])
      : Buffer.from([0x11, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.concat([header, payload]);
}

function makeRealPlayableWav() {
  // Valid 0.2s 11025Hz 8-bit unsigned PCM WAV (audible tone, decodable & playable by Chromium)
  const sampleRate = 11025;
  const samples = Math.floor(sampleRate * 0.2);
  const pcm = Buffer.alloc(samples);
  for (let i = 0; i < samples; i++) {
    pcm[i] = Math.round(128 + 40 * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
  }
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0);
  fmt.writeUInt16LE(1, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate, 8);
  fmt.writeUInt16LE(1, 12);
  fmt.writeUInt16LE(8, 14);
  const dataHdr = Buffer.alloc(8);
  dataHdr.write('data', 0, 4, 'ascii');
  dataHdr.writeUInt32LE(pcm.length, 4);
  const body = Buffer.concat([Buffer.from('WAVE'), Buffer.from('fmt '), Buffer.from([16, 0, 0, 0]), fmt, dataHdr, pcm]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length, 0);
  return Buffer.concat([Buffer.from('RIFF'), riffSize, body]);
}

function buildMinimalZip(entries) {
  const chunks = [];
  const cd = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const comp = zlib.deflateRawSync(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    chunks.push(lh, nameBuf, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    cd.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, eocd]);
}

function seedSyntheticDictionaries(root) {
  const dictDir = path.join(root, 'dicts');
  fs.mkdirSync(dictDir, { recursive: true });

  // 1. BGL (GB18030)
  const bglBlocks = Buffer.concat([
    makeSyntheticBglBlock('apple$1$', [0xc6, 0xbb, 0xb9, 0xfb], 0x30, ['apples']), // 苹果
    makeSyntheticBglBlock('book$2$', [0xca, 0xe9], 0x30, ['books']), // 书
    makeSyntheticBglBlock('May$3$', [0xce, 0xe5, 0xd4, 0xc2], 0x30, []), // 五月
    makeSyntheticBglBlock('may$4$', [0xbf, 0xc9, 0xd2, 0xd4], 0x32, []), // 可以
    makeSyntheticBglBlock("don't$5$", [0xb2, 0xbb, 0xd2, 0xaa], 0x30, []), // 不要
    makeSyntheticBglBlock('pie$6$', [0xcf, 0xda, 0xb1, 0xfd], 0x30, []) // 馅饼
  ]);
  fs.writeFileSync(path.join(dictDir, 'test-bgl.BGL'), Buffer.concat([Buffer.from([0x12, 0x34, 0x00, 0x01, 0x00, 0x00]), zlib.gzipSync(bglBlocks)]));

  // 2. OALD8 DSL.dz + media zip (PCM WAV served cleanly via ZIP)
  const wav = makeRealPlayableWav();
  const oaldText = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([
      '#NAME "OALD8 Smoke"',
      'apple',
      '\t[m0][b]apple[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[ˈæpl\\][/c] [s]z_apple_gb.wav[/s][/m]',
      '\t[m1]{{d}}a round crisp fruit{{/d}}[/m]',
      '\t[m2][ex]{{x}}an apple pie{{/x}}[/ex] ↑<<pie>>[/m]',
      'pie',
      '\t[m0][b]pie[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[paɪ\\][/c][/m]',
      '\t[m1]{{d}}baked dish of fruit or meat{{/d}}[/m]',
      'book',
      '\t[m0][b]book[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[bʊk\\][/c] [s]z_book_gb.wav[/s][/m]',
      '\t[m1]{{d}}a set of printed pages{{/d}}[/m]',
      'May',
      '\t[m0][b]May[/b] [c orange] noun[/c] [p]BrE[/p] [c darkcyan]\\[meɪ\\][/c][/m]',
      '\t[m1]{{d}}fifth month of the year{{/d}}[/m]',
      'may',
      '\t[m0][b]may[/b] [c orange] modal verb[/c] [p]BrE[/p] [c darkcyan]\\[meɪ\\][/c][/m]',
      '\t[m1]{{ud}}used to say sth is possible{{/ud}}[/m]',
      "don't",
      '\t[m0][b]don\'t[/b] [c orange] short form[/c] [p]BrE[/p] [c darkcyan]\\[dəʊnt\\][/c][/m]',
      '\t[m1]{{d}}do not{{/d}}[/m]'
    ].join('\n'), 'utf16le')
  ]);
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl.dz'), zlib.gzipSync(oaldText));
  fs.writeFileSync(path.join(dictDir, 'test-oald8.dsl.files.zip'), buildMinimalZip([
    { name: 'z_apple_gb.wav', data: wav },
    { name: 'z_book_gb.wav', data: wav }
  ]));

  return dictDir;
}

async function checkLayout(page, width, selector) {
  const controls = await page.locator(`${selector} button, ${selector} a`).evaluateAll(els =>
    els.filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect();
      return { label: el.textContent.trim() || el.getAttribute('aria-label') || '', width: r.width, height: r.height, left: r.left, right: r.right };
    })
  );
  for (const c of controls) {
    assert.ok(c.height >= 43.9 && c.width >= 43.9 && c.left >= -0.5 && c.right <= width + 1, `${width}px control failed: ${JSON.stringify(c)}`);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px horizontal overflow`);
}

async function openContext(browser, base, width, theme, token, child, role = 'child', errors = []) {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 1024 },
    colorScheme: theme,
    hasTouch: true,
    timezoneId: 'Asia/Shanghai',
    serviceWorkers: 'block',
    reducedMotion: 'reduce'
  });
  await context.addInitScript(({ token, child, theme, role }) => {
    sessionStorage.setItem(`taskie_${role}_token`, token);
    if (child) sessionStorage.setItem('current_child', JSON.stringify(child));
    localStorage.setItem('taskie_theme', theme);
    localStorage.setItem('app_sound_muted', 'true');
  }, { token, child, theme, role });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', err => errors.push(err.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  return { context, page };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-en-smoke-'));
  const dictDir = seedSyntheticDictionaries(dir);
  const db = getDb(':memory:');
  db.prepare("UPDATE settings SET value='0' WHERE key='parent_pin_is_default'").run();
  const app = buildApp({
    db,
    logger: false,
    deviceAuth: false,
    backupIntervalHours: 0,
    uploadDir: path.join(dir, 'uploads'),
    backupDir: path.join(dir, 'backups'),
    authorizedTokensFile: path.join(dir, 'tokens'),
    dictDir,
    dictCacheDir: path.join(dir, 'dict-cache'),
    clientDistDir: path.resolve(__dirname, '../frontend/dist')
  });

  let browser;
  try {
    await app.ready();
    await app.services.dictionaryService.rebuildIndex();
    const base = await app.listen({ host: '127.0.0.1', port: smokePort() });
    const parentToken = app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch() }, { expiresIn: '7d' });

    const api = async (method, url, payload, token = parentToken) => {
      const res = await app.inject({ method, url: `/api${url}`, payload, headers: { authorization: `Bearer ${token}` } });
      assert.ok(res.statusCode < 300, `${method} ${url}: ${res.statusCode} ${res.body}`);
      return res.json();
    };

    const child = await api('POST', '/children', { name: '英语小达人' });
    const childB = await api('POST', '/children', { name: '其他同学' });
    const childToken = app.jwt.sign({ role: 'child', child_id: child.id, epoch: app.sessionEpoch() }, { expiresIn: '7d' });
    const childBToken = app.jwt.sign({ role: 'child', child_id: childB.id, epoch: app.sessionEpoch() }, { expiresIn: '7d' });

    // Seed one empty-definition word to verify empty-def exclusion hint
    await api('POST', '/english-words', { child_id: child.id, word: 'mystery', unit: 'Unit 1' });

    browser = await chromium.launch(launchOptions());
    const errors = [];

    // 1. Child flow: lookup, play real audio, view original dictionary + cross-ref jump, add word, May/may, batch import
    {
      const { context, page } = await openContext(browser, base, 390, 'light', childToken, child, 'child', errors);
      try {
        // Track real /api/dictionary/audio response and HTMLAudioElement play inside browser
        let audioStatus = 0;
        page.on('response', res => {
          if (new URL(res.url()).pathname.startsWith('/api/dictionary/audio/')) audioStatus = res.status();
        });
        await page.addInitScript(() => {
          window.__playedAudio = [];
          const OrigAudio = window.Audio;
          window.Audio = function (src) {
            const a = new OrigAudio(src);
            const origPlay = a.play.bind(a);
            a.play = () => {
              const p = origPlay();
              a.addEventListener('ended', () => window.__playedAudio.push({ duration: a.duration, ended: true }), { once: true });
              return p;
            };
            return a;
          };
        });

        await page.goto(`${base}/child/${child.id}/characters`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: '英语单词' }).click();
        await page.locator('[data-english-wordbook]').waitFor();
        await checkLayout(page, 390, '[data-characters-page]');

        // Open Lookup modal
        await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
        const modal = page.getByRole('dialog', { name: '查词与收录单词' });
        await modal.waitFor();
        await modal.getByPlaceholder(/输入英文单词或短语/).fill('apple');
        await modal.getByRole('button', { name: /查词/ }).click();
        await modal.getByText('ˈæpl').waitFor();

        // Play audio & wait for real playback completion
        await modal.getByRole('button', { name: /英音/ }).click();
        await page.waitForFunction(() => (window.__playedAudio || []).length >= 1);
        assert.equal(audioStatus, 200);
        const played = await page.evaluate(() => window.__playedAudio[0]);
        assert.ok(played.duration > 0.1 && played.ended, 'real WAV audio played cleanly to end');

        // Open full original dictionary modal + jump cross-ref to pie + go back
        await modal.getByRole('button', { name: /查看完整原词典/ }).click();
        const artDialog = page.getByRole('dialog', { name: /原词典 · apple/ });
        await artDialog.waitFor();
        await artDialog.getByRole('button', { name: 'pie', exact: true }).click();
        await page.getByRole('dialog', { name: /原词典 · pie/ }).waitFor();
        await page.getByRole('button', { name: /返回 apple/ }).click();
        await page.getByRole('dialog', { name: /原词典 · apple/ }).waitFor();
        await page.getByRole('button', { name: '关闭' }).last().click();

        // Children may collect words; textbook/unit configuration belongs to parents.
        assert.equal(await modal.getByPlaceholder('如 Unit 1').isDisabled(), true);
        assert.equal(await modal.getByPlaceholder('如 人教版三年级').isDisabled(), true);
        await modal.getByRole('button', { name: '加入单词本' }).click();
        await page.locator('[data-english-word-card="apple"]').waitFor();

        // Verify empty-definition banner
        await page.getByText(/1 个单词缺少中英文释义/).waitFor();

        // Open Batch Import Modal & preview book + apple (dup) + customword (manual)
        await page.getByRole('button', { name: /批量导入/ }).click();
        const batchDlg = page.getByRole('dialog', { name: '批量导入英语单词' });
        assert.equal(await batchDlg.getByPlaceholder('如 Unit 2').isDisabled(), true);
        assert.equal(await batchDlg.getByPlaceholder('如 人教版四年级').isDisabled(), true);
        await batchDlg.getByPlaceholder(/apple/).fill('book\napple\ndon’t');
        await batchDlg.getByRole('button', { name: '解析预览' }).click();
        await batchDlg.getByText('已在单词本中（跳过）').waitFor();
        await batchDlg.getByRole('button', { name: /确认导入/ }).click();
        await page.locator('[data-english-word-card="book"]').waitFor();
        await page.locator('[data-english-word-card="don\'t"]').waitFor();

        await page.locator('[data-english-word-card="apple"]').click();
        const childDetail = page.getByRole('dialog', { name: 'apple', exact: true });
        await childDetail.getByRole('button', { name: /编辑释义/ }).click();
        assert.equal(await childDetail.getByLabel('教材/分类', { exact: true }).isDisabled(), true);
        assert.equal(await childDetail.getByLabel('单元', { exact: true }).isDisabled(), true);
        const apple = (await api('GET', `/english-words?child_id=${child.id}`)).find(word => word.word === 'apple');
        await api('PUT', `/english-words/${apple.id}`, { textbook: '家长新教材', unit: 'Unit 2' });
        await childDetail.getByLabel('记忆笔记', { exact: true }).fill('孩子补充笔记');
        const noteSave = page.waitForResponse(res => new URL(res.url()).pathname === `/api/english-words/${apple.id}` && res.request().method() === 'PUT');
        await childDetail.getByRole('button', { name: '保存修改', exact: true }).click();
        const noteResponse = await noteSave;
        assert.equal(noteResponse.status(), 200);
        const childPayload = noteResponse.request().postDataJSON();
        assert.equal(Object.hasOwn(childPayload, 'textbook'), false);
        assert.equal(Object.hasOwn(childPayload, 'unit'), false);
        await childDetail.getByText('孩子补充笔记', { exact: true }).waitFor();
        const updatedApple = await api('GET', `/english-words/${apple.id}`);
        assert.equal(updatedApple.textbook, '家长新教材');
        assert.equal(updatedApple.unit, 'Unit 2');
        assert.equal(updatedApple.note, '孩子补充笔记');
        await childDetail.getByRole('button', { name: '关闭', exact: true }).last().click();

        // Cross-child isolation in live API
        const resB = await app.inject({
          method: 'GET',
          url: `/api/english-words?child_id=${child.id}`,
          headers: { authorization: `Bearer ${childBToken}` }
        });
        assert.equal(resB.statusCode, 403);
      } finally {
        await context.close();
      }
    }

    // 2. Parent configures English study plan (write + recognize) in Dark 1180px tablet viewport
    {
      const { context, page } = await openContext(browser, base, 1180, 'dark', parentToken, child, 'parent', errors);
      try {
        await page.goto(`${base}/parent/word-plans?child=${child.id}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('tab', { name: /英语单词计划/ }).click();
        await page.getByText(/缺少中英文释义/).waitFor();

        // Enable English write (默写) plan across all 7 days (so CI passes on weekends too) and save
        const writeCard = page.locator('article').filter({ has: page.getByRole('heading', { name: '英语单词默写' }) });
        assert.equal(await writeCard.getByLabel('每日新学目标', { exact: true }).inputValue(), '3');
        await writeCard.getByRole('checkbox', { name: /未开启|已开启/ }).check();
        for (const dayBtn of ['周日', '周六']) {
          const btn = writeCard.getByRole('button', { name: dayBtn, exact: true });
          if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
        }
        await writeCard.getByRole('button', { name: /保存英语单词默写计划/ }).click();
        await writeCard.getByText('计划已保存').waitFor();

        // Enable English recognize plan across all 7 days too
        const recCard = page.locator('article').filter({ has: page.getByRole('heading', { name: '英语单词认读' }) });
        assert.equal(await recCard.getByLabel('每日新学目标', { exact: true }).inputValue(), '3');
        await recCard.getByRole('checkbox', { name: /未开启|已开启/ }).check();
        for (const dayBtn of ['周日', '周六']) {
          const btn = recCard.getByRole('button', { name: dayBtn, exact: true });
          if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click();
        }
        await recCard.getByRole('button', { name: /保存英语单词认读计划/ }).click();
        await recCard.getByText('计划已保存').waitFor();
      } finally {
        await context.close();
      }
    }

    // 3. Child navigates from TodayTasksView -> WordStudyView?language=en & completes spelling + recognize practice
    {
      const { context, page } = await openContext(browser, base, 820, 'dark', childToken, child, 'child', errors);
      try {
        await page.goto(`${base}/child/${child.id}/today`, { waitUntil: 'domcontentloaded' });
        await page.getByText('英语单词默写').first().click();
        await page.waitForURL(/\/word-study\?language=en/);

        // Start spelling batch & check mobile input attributes + curved apostrophe tolerance
        const writeSection = page.locator('section').filter({ has: page.getByRole('heading', { name: '英语单词默写' }) });
        await writeSection.getByRole('button', { name: /开始 \/ 继续学习/ }).click();

        const dlg = page.getByRole('dialog');
        const input = dlg.getByPlaceholder('在此输入英文拼写…');
        await input.waitFor();
        assert.equal(await input.getAttribute('autocapitalize'), 'off');
        assert.equal(await input.getAttribute('autocorrect'), 'off');
        assert.equal(await input.getAttribute('spellcheck'), 'false');

        // Type exact word (read from DB day items sequentially by meaning or submit)
        const enOverview = await api('GET', `/children/${child.id}/word-study?language=en`);
        const writeDay = enOverview.days.find(d => d.skill === 'write');
        for (const item of writeDay.batches[0].items) {
          const typed = item.text === "don't" ? 'don’t' : item.text.toUpperCase(); // verifies apostrophe & case tolerance
          await dlg.getByPlaceholder('在此输入英文拼写…').fill(typed);
          await dlg.getByRole('button', { name: '核对拼写' }).click();
          await dlg.getByText('✅ 拼写正确').waitFor();
          await dlg.getByRole('button', { name: /提交：独立拼对|独立完成/ }).click();
          await dlg.getByRole('button', { name: '下一项 / 返回清单' }).click();
        }
        await writeSection.getByText('基础目标已完成 ✓').waitFor();
      } finally {
        await context.close();
      }
    }

    // Confirmed writes must survive an older list response, including the TSV import path.
    {
      const { context, page } = await openContext(browser, base, 820, 'light', parentToken, child, 'parent', errors);
      try {
        await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-english-word-card="apple"]').waitFor();
        const raceRead = async (save, verify) => {
          let started, release, done;
          const began = new Promise(resolve => { started = resolve; });
          const gate = new Promise(resolve => { release = resolve; });
          const completed = new Promise(resolve => { done = resolve; });
          const pattern = `**/api/english-words?child_id=${child.id}`;
          const handler = async route => {
            try {
              const response = await route.fetch();
              started();
              await gate;
              await route.fulfill({ response });
            } catch { /* A confirmed write aborts this stale browser read. */ }
            finally { done(); }
          };
          await page.route(pattern, handler, { times: 1 });
          try {
            await page.evaluate(id => {
              const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('englishWord');
              void store.fetchWords(id).catch(() => {});
            }, child.id);
            let deadline;
            try {
              await Promise.race([began, new Promise((_, reject) => {
                deadline = setTimeout(() => reject(new Error('Timed out waiting for the stale English list snapshot')), 12000);
              })]);
            } finally { clearTimeout(deadline); }
            await save();
            release();
            await completed;
            await page.waitForFunction(() => !document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('englishWord').loading);
            await verify();
          } finally { release(); await page.unroute(pattern, handler); }
        };
        await raceRead(async () => {
          await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
          const lookup = page.getByRole('dialog', { name: '查词与收录单词' });
          await lookup.getByPlaceholder(/输入英文单词或短语/).fill('reviewfresh');
          await lookup.getByRole('button', { name: /查词/ }).click();
          await page.waitForFunction(input => input.value === 'reviewfresh', await lookup.getByLabel('英文词条 *', { exact: true }).elementHandle());
          await lookup.getByPlaceholder('例如：n. 苹果').fill('手工录入');
          await lookup.getByRole('button', { name: '加入单词本' }).click();
          await lookup.waitFor({ state: 'detached' });
        }, async () => {
          assert.equal(await page.locator('[data-english-word-card="reviewfresh"]').count(), 1);
        });
        await raceRead(async () => {
          await page.getByRole('button', { name: /批量导入/ }).click();
          const batch = page.getByRole('dialog', { name: '批量导入英语单词' });
          await batch.getByPlaceholder(/apple/).fill('reviewbatch\t批量释义，保留；标点');
          await batch.getByRole('button', { name: '解析预览' }).click();
          assert.equal(await batch.getByPlaceholder('中文释义（如：苹果；也可导入后补填）').inputValue(), '批量释义，保留；标点');
          await batch.getByRole('button', { name: /确认导入/ }).click();
          await batch.waitFor({ state: 'detached' });
        }, async () => {
          await page.locator('[data-english-word-card="reviewbatch"]').getByText('批量释义，保留；标点', { exact: true }).waitFor();
        });
        await raceRead(async () => {
          const card = page.locator('[data-english-word-card="reviewfresh"]');
          await card.getByRole('button', { name: '🌱 标记已掌握', exact: true }).click();
          await card.getByRole('button', { name: '✅ 已掌握', exact: true }).waitFor();
        }, async () => {
          assert.equal(await page.locator('[data-english-word-card="reviewfresh"]').getByRole('button', { name: '✅ 已掌握', exact: true }).count(), 1);
        });
        await page.locator('[data-english-word-card="reviewfresh"]').click();
        const detail = page.getByRole('dialog', { name: 'reviewfresh', exact: true });
        await raceRead(async () => {
          await detail.getByRole('button', { name: /会认读/ }).click();
          await detail.getByRole('button', { name: /会认读/ }).and(detail.locator('[aria-pressed="false"]')).waitFor();
        }, async () => {
          assert.equal(await detail.getByRole('button', { name: /会认读/ }).getAttribute('aria-pressed'), 'false');
        });
        await raceRead(async () => {
          await detail.getByRole('button', { name: /编辑释义与单元/ }).click();
          await detail.getByLabel('中文释义', { exact: true }).fill('更正后的释义');
          await detail.getByRole('button', { name: '保存修改', exact: true }).click();
          await detail.getByText('更正后的释义', { exact: true }).waitFor();
        }, async () => {
          assert.equal(await detail.getByText('更正后的释义', { exact: true }).count(), 1);
        });
        await raceRead(async () => {
          await detail.getByRole('button', { name: '🗑️ 移出单词本', exact: true }).click();
          await detail.getByRole('button', { name: '确认移出', exact: true }).click();
          await detail.waitFor({ state: 'detached' });
        }, async () => {
          assert.equal(await page.locator('[data-english-word-card="reviewfresh"]').count(), 0);
        });
        console.log('PASS stale list responses cannot undo English add/import/master/category/edit/delete writes');
      } finally { await context.close(); }
    }

    // Delayed writes must not affect a replacement dialog or release its locks.
    {
      const { context, page } = await openContext(browser, base, 820, 'dark', parentToken, child, 'parent', errors);
      try {
        await checkEnglishModalRaces({ page, base, child, childB, api,
          rotatedToken: app.jwt.sign({ role: 'parent', epoch: app.sessionEpoch(), rotation: 'scope-race' }, { expiresIn: '7d' }) });
      } finally { await context.close(); }
    }

    await checkEnglishCaseRules({ browser, base, api, parentToken, openContext, errors });

    // 4. Layout checks across 320px dark & 1180px light on English wordbook
    for (const [w, theme] of [[320, 'dark'], [1180, 'light']]) {
      const { context, page } = await openContext(browser, base, w, theme, childToken, child, 'child', errors);
      try {
        await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-english-wordbook]').waitFor();
        await checkLayout(page, w, '[data-characters-page]');
      } finally {
        await context.close();
      }
    }

    assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join('; ')}`);
    console.log('PASS English wordbook, dictionary audio/viewer, batch import & bilingual study smoke suite!');
  } finally {
    await browser?.close();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
