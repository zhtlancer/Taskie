const assert = require('node:assert/strict');
const { launchBrowser, smokePort } = require('./browser-env.cjs');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const c = createTestApp({ dictDir: null }),
  parent = { role: 'parent' };
let browser,
  hold,
  serial = 0;
const requestId = () => `browser_test_${++serial}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually(fn) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error('Expected persisted self-test state');
}
function held(path, method = 'POST') {
  let release, reached;
  const gate = new Promise((resolve) => {
      release = resolve;
    }),
    ready = new Promise((resolve) => {
      reached = resolve;
    });
  hold = { path, method, gate, reached };
  return { release, ready };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Self-test request did not reach server')), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function main() {
  c.app.addHook('onSend', async (request, reply, payload) => {
    if (hold && request.method === hold.method && hold.path(request.url)) {
      const h = hold;
      hold = null;
      h.reached();
      await h.gate;
    }
    return payload;
  });
  await c.app.ready();
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await launchBrowser();
  const errors = [];
  const {
    childrenService: children,
    wordBooksService: books,
    charactersService: chars,
    englishWordsService: words,
    wordTestsService: tests,
  } = c.app.services;
  for (const [width, theme] of [
    [320, 'light'],
    [390, 'dark'],
    [820, 'light'],
    [1024, 'dark'],
    [1180, 'light'],
  ]) {
    const child = children.createChild({ name: `自测-${width}` }),
      other = children.createChild({ name: `其他-${width}` });
    const a = books.create({ child_id: child.id, language: 'zh', name: '课内词本', source: '学校' }, parent),
      b = books.create({ child_id: child.id, language: 'zh', name: '多音词本', source: '课外' }, parent),
      en = books.create({ child_id: child.id, language: 'en', name: '英语词本' }, parent);
    const char = chars.createCharacter({ child_id: child.id, char: '长', pinyin: 'cháng' });
    books.add(a.id, { character_id: char.id, pinyin_override: 'chang2' }, parent);
    books.add(b.id, { character_id: char.id, pinyin_override: 'zhang3' }, parent);
    for (const [word, meaning] of [
      ['May', '五月'],
      ['apple', '苹果'],
    ]) {
      const w = words.createWord(
        {
          child_id: child.id,
          word,
          definition_zh: meaning,
          strict_case: word === 'May',
          categories: ['recognize', 'write'],
        },
        parent,
      );
      books.add(en.id, { english_word_id: w.id }, parent);
    }
    const context = await browser.newContext({
      viewport: { width, height: width < 500 ? 844 : 1024 },
      colorScheme: theme,
      locale: 'zh-CN',
      hasTouch: true,
      isMobile: true,
      reducedMotion: 'reduce',
    });
    let release;
    try {
      const token = c.app.jwt.sign({ ...parent, epoch: c.app.sessionEpoch() });
      await context.addInitScript((token) => {
        if (!sessionStorage.getItem('taskie_child_token'))
          sessionStorage.setItem('taskie_parent_token', token);
      }, token);
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${base}/child/${child.id}/characters`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('按词本筛选', { exact: true }).selectOption(a.id);
      await page.getByRole('link', { name: '按此词本自测', exact: true }).click();
      const start = page.getByRole('button', { name: '开始自测', exact: true });
      await start.waitFor();
      await page.getByLabel('自测词本「课内词本」', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('自测词本「课内词本」', { exact: true }).isChecked(), true);
      await page.getByLabel('自测词本「多音词本」', { exact: true }).check();
      await page.getByLabel('测试方式', { exact: true }).selectOption('write');
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '24px';
      });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'launcher fits enlarged text',
      );
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      if (width === 320) {
        const h = held((url) => url === '/api/word-tests');
        release = h.release;
        await start.click();
        await bounded(h.ready);
        assert.equal(await page.getByRole('button', { name: '新建自测', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: '重试确认创建', exact: true }).waitFor({ timeout: 30000 });
        release();
        release = null;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '重试确认创建', exact: true }).click();
      } else await start.click();
      const question = page.locator('[data-word-test-question]');
      await question.getByRole('button', { name: '核对字形', exact: true }).waitFor();
      assert.ok(await question.getByRole('button', {name:'核对字形',exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44), 'touch controls are at least 44px');
      const testId = new URL(page.url()).searchParams.get('test');
      assert.ok(testId);
      assert.equal(tests.get(testId, parent).total_count, 2);
      assert.equal(tests.list({ child_id: child.id, language: 'zh' }, parent).items.length, 1);
      await question.getByRole('button', { name: '核对字形', exact: true }).click();
      assert.equal((await question.locator('svg').count()) > 0, true, 'paper-writing grid is present');
      if (width === 320) {
        const h = held((url) => url.endsWith('/answer'));
        release = h.release;
        await question.getByRole('button', { name: '还不熟', exact: true }).click();
        await bounded(h.ready);
        await page.getByRole('button', { name: '重试确认答案', exact: true }).waitFor({ timeout: 30000 });
        release();
        release = null;
        await page.reload({ waitUntil: 'domcontentloaded' });
      } else {
        await question.getByRole('button', { name: '还不熟', exact: true }).click();
        await page.getByRole('button', { name: '下一题', exact: true }).click();
        await eventually(()=>question.evaluate(el=>document.activeElement===el.parentElement));
      }
      await question.getByRole('button', { name: '核对字形', exact: true }).waitFor();
      await question.getByRole('button', { name: '核对字形', exact: true }).click();
      await question.getByRole('button', { name: '记住了', exact: true }).click();
      await page.getByRole('heading', { name: '自测已完成 · 50%', exact: true }).waitFor();
      assert.equal(tests.get(testId, parent).answered_count, 2);
      await page.getByRole('button', { name: '将错词标为易错', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '易错标记：新增 1 项' }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: '自测已完成 · 50%', exact: true }).waitFor();
      if (width === 320) {
        const h = held((url) => url.endsWith('/retry-wrong'));
        release = h.release;
        await page.getByRole('button', { name: '只复测错题', exact: true }).click();
        await bounded(h.ready);
        await page.getByRole('button', { name: '重试确认错题复测', exact: true }).waitFor({ timeout: 30000 });
        release();
        release = null;
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '重试确认错题复测', exact: true }).click();
      } else await page.getByRole('button', { name: '只复测错题', exact: true }).click();
      await question.getByRole('button', { name: '核对字形', exact: true }).waitFor();
      assert.equal(tests.get(new URL(page.url()).searchParams.get('test'), parent).total_count, 1);
      assert.equal(tests.list({ child_id: child.id, language: 'zh' }, parent).items.length, 2);
      await page.getByRole('button', { name: '切换英语', exact: true }).click();
      await page.getByLabel('自测词本「英语词本」', { exact: true }).check();
      await page.getByLabel('测试方式', { exact: true }).selectOption('write');
      await start.click();
      const input = question.getByLabel('输入拼写', { exact: true });
      await input.fill('may');
      const englishTest = new URL(page.url()).searchParams.get('test');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await input.waitFor();
      assert.equal(await input.inputValue(), 'may', 'unsubmitted spelling draft survives refresh');
      await page.getByRole('button', { name: '确认拼写', exact: true }).click();
      await question.getByText('本题需复习', { exact: false }).waitFor();
      assert.equal(
        tests.get(englishTest, parent).items[0].result,
        'wrong',
        'strict case is graded on server',
      );
      await page.getByRole('button', { name: '下一题', exact: true }).click();
      await input.fill('APPLE');
      await page.getByRole('button', { name: '确认拼写', exact: true }).click();
      await page.getByRole('heading', { name: '自测已完成 · 50%', exact: true }).waitFor();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '24px';
      });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'results fit enlarged text',
      );
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      await page.goto(`${base}/child/${child.id}/characters?lang=zh`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('按词本筛选', { exact: true }).selectOption(a.id);
      await page.getByRole('link', { name: '最近自测：本词本正确 0/1 题', exact: true }).waitFor();
      // Two browser tabs racing a first answer must converge on the saved answer.
      if (width === 320) {
        const concurrent = tests.create(
          {
            child_id: child.id,
            language: 'en',
            skill: 'write',
            book_ids: [en.id],
            request_id: requestId(),
            limit: 1,
          },
          parent,
        );
        const tab = await context.newPage();
        await Promise.all([
          page.goto(`${base}/child/${child.id}/word-test?language=en&test=${concurrent.id}`, {
            waitUntil: 'domcontentloaded',
          }),
          tab.goto(`${base}/child/${child.id}/word-test?language=en&test=${concurrent.id}`, {
            waitUntil: 'domcontentloaded',
          }),
        ]);
        await page.getByLabel('输入拼写', { exact: true }).fill('May');
        await tab.getByLabel('输入拼写', { exact: true }).fill('wrong');
        await page.getByRole('button', { name: '确认拼写', exact: true }).click();
        await page.getByRole('heading', { name: '自测已完成 · 100%', exact: true }).waitFor();
        await tab.getByRole('button', { name: '确认拼写', exact: true }).click();
        await tab.getByRole('heading', { name: '自测已完成 · 100%', exact: true }).waitFor();
        assert.equal(tests.get(concurrent.id, parent).items[0].typed_answer, 'May');
        await tab.close();
        // Simulated network loss before sending retains the immutable answer across reload.
        const offline = tests.create(
          {
            child_id: child.id,
            language: 'en',
            skill: 'write',
            book_ids: [en.id],
            request_id: requestId(),
            limit: 1,
          },
          parent,
        );
        await page.goto(`${base}/child/${child.id}/word-test?language=en&test=${offline.id}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.getByLabel('输入拼写', { exact: true }).fill('May');
        await context.setOffline(true);
        await page.getByRole('button', { name: '确认拼写', exact: true }).click();
        await page.getByRole('button', { name: '重试确认答案', exact: true }).waitFor({ timeout: 30000 });
        await context.setOffline(false);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: '重试确认答案', exact: true }).click();
        await page.getByRole('heading', { name: '自测已完成 · 100%', exact: true }).waitFor();
        await page.getByRole('button', { name: '新建自测', exact: true }).click();
        await page.getByLabel('自测词本「英语词本」', { exact: true }).check();
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await eventually(() =>
          page
            .getByLabel('自测词本「英语词本」', { exact: true })
            .isChecked()
            .then((value) => !value),
        );
        assert.equal(
          await page.evaluate(() =>
            Object.keys(sessionStorage).some(
              (key) =>
                key.startsWith('taskie_word_test_v1:') && JSON.parse(sessionStorage.getItem(key)).attempt,
            ),
          ),
          false,
          'restore clears pending attempts',
        );
        await page.goto(`${base}/child/${other.id}/word-test?language=en`, { waitUntil: 'domcontentloaded' });
        await page.getByText('暂无词本，请先请家长在字词本整理来源。', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: '开始自测', exact: true }).isDisabled(), true);
        // Slow reads from a previous child are cancelled and cannot fill the next child's page.
        await page.goto(`${base}/child/${child.id}/word-test?language=en&test=${offline.id}`, {
          waitUntil: 'domcontentloaded',
        });
        await page.getByRole('heading', { name: '自测已完成 · 100%', exact: true }).waitFor();
        const stale = held((url) => url === `/api/word-tests/${offline.id}`, 'GET');
        release = stale.release;
        await page.getByRole('button', { name: '读取保存状态', exact: true }).click();
        await bounded(stale.ready);
        await page.evaluate((path) => {
          history.pushState({}, '', path);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, `/child/${other.id}/word-test?language=en`);
        await page.getByText('暂无词本，请先请家长在字词本整理来源。', { exact: true }).waitFor();
        release();
        release = null;
        await sleep(200);
        assert.equal(await page.locator('[data-word-test-result]').count(), 0);
        // Pagination uses stable server cursors and does not repeat the first page.
        for (let i = 0; i < 21; i++)
          tests.create(
            {
              child_id: child.id,
              language: 'en',
              skill: 'write',
              book_ids: [en.id],
              request_id: requestId(),
              limit: 1,
            },
            parent,
          );
        await page.goto(`${base}/child/${child.id}/word-test?language=en&view=history`, {
          waitUntil: 'domcontentloaded',
        });
        const historyPanel = page.getByRole('region', { name: '自测记录', exact: true });
        await historyPanel.getByRole('button', { name: '加载更多记录', exact: true }).click();
        await eventually(() =>
          historyPanel
            .locator('button')
            .count()
            .then((n) => n > 22),
        );
        // Child entry uses the same UI without any parent management controls.
        const childToken = c.app.jwt.sign({ role: 'child', child_id: child.id, epoch: c.app.sessionEpoch() });
        await page.evaluate((token) => {
          sessionStorage.removeItem('taskie_parent_token');
          sessionStorage.setItem('taskie_child_token', token);
          window.dispatchEvent(new Event('taskie:session-changed'));
        }, childToken);
        await page.goto(`${base}/child/${child.id}/word-test?language=zh`, { waitUntil: 'domcontentloaded' });
        await page.getByLabel('自测词本「课内词本」', { exact: true }).check();
        await start.click();
        await question.getByRole('button', { name: '揭晓拼音', exact: true }).click();
        await question.getByRole('button', { name: '记住了', exact: true }).click();
        await page.getByRole('heading', { name: '自测已完成 · 100%', exact: true }).waitFor();
      }
      console.log(
        `PASS ${width}/${theme}: book entrance, polyphones, paper grid, history, restore, English spelling and ${width === 320 ? 'lost responses/network/concurrent tabs/child role' : 'layout'}`,
      );
    } catch(error) {
      await reportBrowserFailure(`word-tests-${width}`,error,context);
      throw error;
    } finally {
      release?.();
      hold = null;
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    await c.app.close();
    cleanupTestApp(c);
    c.db.close();
  });
