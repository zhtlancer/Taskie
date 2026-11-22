const assert = require('node:assert/strict');

module.exports = async function checkDictionaryFallback({ browser, base, api, parentToken, openContext, errors, dictionaryService }) {
  const originalLookup = dictionaryService.lookup.bind(dictionaryService);
  let broken = false, lookupCalls = 0;
  dictionaryService.lookup = async word => {
    lookupCalls++;
    if (broken && word === 'brokenword') throw { code: 'DICTIONARY_INVALID' };
    return originalLookup(word);
  };
  try {
    for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
      const child = await api('POST', '/children', { name: `词典异常${width}` });
      await api('POST', '/english-words', { child_id: child.id, word: 'apple', definition_zh: '已保存的课堂释义' });
      const { context, page } = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
      let release;
      try {
        let mode = 'unconfigured', seen, finished;
        let held, started, delayedDone;
        await page.route('**/api/dictionary/lookup**', async route => {
          const word = new URL(route.request().url()).searchParams.get('word');
          if (mode === 'hold' && word === 'apple') {
            seen();
            await held;
            try { await route.fulfill({ status: 503, json: { error: '旧词条的延迟失败', code: 'DICTIONARY_INVALID' } }); }
            catch {} finally { finished(); }
            return;
          }
          if (mode === 'ready' || mode === 'hold') return route.continue();
          if (mode === 'invalid') return route.fulfill({ status: 503, json: { error: '词典或资源包损坏，暂时无法读取，请检查词典文件后重试。', code: 'DICTIONARY_INVALID' } });
          return route.fulfill({ json: { available: mode !== 'unconfigured', index_ready: mode !== 'unconfigured' && mode !== 'unready',
            exact_matches: mode === 'no-audio' ? [{ word, definition_zh: '候选释义', audio: [] }] : [], suggestions: [] } });
        });
        await page.route('**/api/dictionary/article**', route => mode === 'unconfigured'
          ? route.fulfill({ json: { available: false, articles: [], reason: '当前环境未挂载离线原词典' } }) : route.continue());
        await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
        const card = word => page.locator(`[data-english-word-card="${word}"]`);
        await card('apple').click();
        const detail = page.getByRole('dialog', { name: 'apple', exact: true });
        const state = detail.locator('[data-dictionary-detail-state]');
        await state.getByText(/未配置或未发现/).waitFor();
        await detail.getByText('已保存的课堂释义', { exact: true }).waitFor();
        await detail.getByRole('button', { name: /查看完整原词典/ }).click();
        const article = page.getByRole('dialog', { name: '原词典 · apple', exact: true });
        await article.getByText('当前环境未挂载离线原词典', { exact: true }).waitFor();
        mode = 'ready';
        await article.getByRole('button', { name: '重试读取', exact: true }).click();
        await article.getByText('苹果', { exact: true }).waitFor();
        await article.getByRole('button', { name: '关闭', exact: true }).last().click();
        await detail.getByRole('button', { name: /编辑释义与笔记/ }).click();
        await detail.getByLabel('中文释义', { exact: true }).fill('重试期间保留的更正');
        await detail.getByLabel('例句（选填）', { exact: true }).fill('An apple a day.');
        for (const [nextMode, notice] of [['not-found', /未找到该词条/], ['unready', /索引尚未就绪/], ['invalid', /资源包损坏/], ['no-audio', /暂无可用发音/]]) {
          mode = nextMode;
          await detail.getByRole('button', { name: '重新查询词典', exact: true }).click();
          await state.getByText(notice).waitFor();
          assert.equal(await detail.getByLabel('中文释义', { exact: true }).inputValue(), '重试期间保留的更正');
          assert.equal(await detail.getByLabel('例句（选填）', { exact: true }).inputValue(), 'An apple a day.');
        }
        mode = 'ready';
        await detail.getByRole('button', { name: '重新查询词典', exact: true }).click();
        await detail.locator('summary').filter({ hasText: '选择收录词典义项' }).waitFor();
        assert.equal(await detail.getByLabel('中文释义', { exact: true }).inputValue(), '重试期间保留的更正');
        await detail.getByRole('button', { name: '保存修改', exact: true }).click();
        await detail.getByText('重试期间保留的更正', { exact: true }).waitFor();
        await detail.getByRole('button', { name: '关闭', exact: true }).last().click();

        // A failure of the full preview HTTP request also leaves the existing edits intact.
        await page.getByRole('button', { name: /批量导入/ }).click();
        const batch = page.getByRole('dialog', { name: '批量导入英语单词' });
        await batch.getByPlaceholder(/apple/).fill('book\t表格中的书\nbrokenword\t手工释义\npear\t梨\napple\t不能覆盖');
        broken = true;
        await batch.getByRole('button', { name: '解析预览', exact: true }).click();
        await batch.locator('[data-dictionary-batch-warning]').getByText(/资源包损坏/).waitFor();
        const bookRow = batch.locator('[data-english-import-word="book"]');
        const pearRow = batch.locator('[data-english-import-word="pear"]');
        const meaning = bookRow.getByPlaceholder('中文释义（如：苹果；也可导入后补填）');
        assert.equal(await meaning.inputValue(), '表格中的书');
        await meaning.fill('手工修订的书');
        await bookRow.getByRole('checkbox', { name: '默写时严格区分大小写', exact: true }).check();
        await pearRow.getByRole('checkbox', { name: 'pear', exact: true }).uncheck();
        broken = false;
        await batch.getByRole('button', { name: '解析预览', exact: true }).click();
        await bookRow.getByText('词典已匹配', { exact: true }).waitFor();
        assert.equal(await meaning.inputValue(), '手工修订的书');
        assert.equal(await pearRow.getByRole('checkbox', { name: 'pear', exact: true }).isChecked(), false);
        assert.equal(await bookRow.getByRole('checkbox', { name: '默写时严格区分大小写', exact: true }).isChecked(), true);
        const failPreview = route => route.fulfill({ status: 503, json: { error: '临时无法读取预览' } });
        await page.route('**/api/english-words/batch-preview', failPreview);
        await batch.getByRole('button', { name: '解析预览', exact: true }).click();
        await batch.getByRole('alert').getByText('临时无法读取预览', { exact: true }).waitFor();
        assert.equal(await meaning.inputValue(), '手工修订的书');
        await page.unroute('**/api/english-words/batch-preview', failPreview);
        const beforeManual = lookupCalls;
        await batch.getByRole('button', { name: '不查词，手工预览', exact: true }).click();
        await batch.locator('[data-dictionary-batch-warning]').getByText(/已跳过词典查询/).waitFor();
        assert.equal(lookupCalls, beforeManual);
        assert.equal(await meaning.inputValue(), '手工修订的书');
        await batch.getByRole('button', { name: /确认导入/ }).click();
        await batch.waitFor({ state: 'detached' });
        const saved = await api('GET', `/english-words?child_id=${child.id}`);
        assert.equal(saved.find(word => word.word === 'book').definition_zh, '手工修订的书');
        assert.equal(saved.find(word => word.word === 'book').strict_case, true);
        assert.equal(saved.find(word => word.word === 'apple').definition_zh, '重试期间保留的更正');
        assert.equal(saved.some(word => word.word === 'pear'), false);

        // An obsolete lookup failure cannot overwrite another word's detail or loading lock.
        mode = 'hold';
        held = new Promise(resolve => { release = resolve; });
        started = new Promise(resolve => { seen = resolve; });
        delayedDone = new Promise(resolve => { finished = resolve; });
        await card('apple').click();
        await started;
        await detail.getByRole('button', { name: '关闭', exact: true }).last().click();
        await card('book').click();
        const freshDetail = page.getByRole('dialog', { name: 'book', exact: true });
        await freshDetail.getByRole('button', { name: '重新查询词典', exact: true }).waitFor();
        await page.waitForFunction(el => !el.disabled, await freshDetail.getByRole('button', { name: '重新查询词典', exact: true }).elementHandle());
        release(); await delayedDone;
        assert.equal(await freshDetail.getByText(/旧词条的延迟失败/).count(), 0);
        await freshDetail.getByRole('button', { name: '关闭', exact: true }).last().click();

        // A manual lookup correction survives a failed or empty retry, and a new word starts blank.
        await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
        const lookup = page.getByRole('dialog', { name: '查词与收录单词' });
        mode = 'invalid';
        await lookup.getByPlaceholder(/输入英文单词或短语/).fill('manualword');
        await lookup.getByRole('button', { name: /查词/, exact: false }).click();
        await lookup.getByRole('button', { name: '重试查询', exact: true }).waitFor();
        await lookup.getByLabel('中文释义', { exact: true }).fill('无需词典的手工更正');
        await lookup.getByRole('button', { name: '重试查询', exact: true }).click();
        await lookup.getByRole('alert').getByText(/资源包损坏/).waitFor();
        assert.equal(await lookup.getByLabel('中文释义', { exact: true }).inputValue(), '无需词典的手工更正');
        mode = 'not-found';
        await lookup.getByRole('button', { name: '重试查询', exact: true }).click();
        await lookup.getByText(/词典中未找到该词条/).waitFor();
        assert.equal(await lookup.getByLabel('中文释义', { exact: true }).inputValue(), '无需词典的手工更正');
        await lookup.getByRole('button', { name: '加入单词本', exact: true }).click();
        await lookup.waitFor({ state: 'detached' });
        assert.equal((await api('GET', `/english-words?child_id=${child.id}`)).find(word => word.word === 'manualword').definition_zh, '无需词典的手工更正');
        await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
        await lookup.getByPlaceholder(/输入英文单词或短语/).fill('MAY');
        await lookup.getByRole('button', { name: /查词/ }).click();
        await lookup.getByText(/词典中未找到该词条/).waitFor();
        await lookup.getByLabel('中文释义', { exact: true }).fill('大小写近似匹配也保留更正');
        mode = 'ready';
        await lookup.getByRole('button', { name: /查词/ }).click();
        await lookup.getByRole('button', { name: /查看完整原词典/ }).waitFor();
        assert.equal(await lookup.getByLabel('英文词条 *', { exact: true }).inputValue(), 'MAY');
        assert.equal(await lookup.getByLabel('中文释义', { exact: true }).inputValue(), '大小写近似匹配也保留更正');
        mode = 'not-found';
        await lookup.getByPlaceholder(/输入英文单词或短语/).fill('differentword');
        await lookup.getByRole('button', { name: /查词/ }).click();
        await lookup.getByText(/词典中未找到该词条/).waitFor();
        assert.equal(await lookup.getByLabel('中文释义', { exact: true }).inputValue(), '', 'changing the query must not carry a different word’s meaning');
        await lookup.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        console.log(`PASS ${width}/${theme}: dictionary missing/not-ready/miss/corrupt/no-audio, safe retries, partial batch/manual import, edit preservation and stale detail isolation`);
      } finally { release?.(); broken = false; await context.close(); }
    }
  } finally { dictionaryService.lookup = originalLookup; }
};
