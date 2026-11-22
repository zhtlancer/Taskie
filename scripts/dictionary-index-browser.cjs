const assert = require('node:assert/strict');

module.exports = async function checkDictionaryIndexNotice({ browser, base, api, parentToken, openContext, errors }) {
  for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
    const child = await api('POST', '/children', { name: `词典准备进度${width}` });
    await api('POST', '/english-words', { child_id: child.id, word: 'apple', definition_zh: '已保存的释义' });
    const { context, page } = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
    let release;
    try {
      let phase = 'entries', statusCalls = 0;
      await page.route('**/api/dictionary/status', route => {
        statusCalls++;
        return route.fulfill({ json: { available: true, indexing: true, index_ready: false,
          dictionaries: [{ dict_id: 'oald8', name: '牛津词典' }],
          progress: { dict_id: 'oald8', phase, processed: phase === 'entries' ? 5000 : 10000 } } });
      });
      await page.route('**/api/dictionary/lookup**', async route => {
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ json: { available: true, index_ready: true, exact_matches: [], suggestions: [] } }).catch(() => {});
      });
      await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
      const lookup = page.getByRole('dialog', { name: '查词与收录单词' });
      await lookup.getByPlaceholder(/输入英文单词或短语/).fill('workerword');
      await lookup.getByRole('button', { name: '🔍 查词', exact: true }).click();
      const notice = lookup.locator('[data-dictionary-index-progress]');
      await notice.getByText(/已读取 5,000 个词条/).waitFor();
      await lookup.getByLabel('中文释义', { exact: true }).fill('准备期间的手工更正');
      phase = 'media';
      await notice.getByText(/已整理 10,000 个资源/).waitFor();
      if (width === 390) {
        await page.waitForTimeout(15500);
        assert.equal(await lookup.getByRole('button', { name: '查询中…', exact: true }).count(), 1, 'a cold build must not hit the ordinary 15-second request timeout');
      }
      release(); release = null;
      await notice.waitFor({ state: 'detached' });
      assert.equal(await lookup.getByLabel('中文释义', { exact: true }).inputValue(), '准备期间的手工更正');
      await lookup.getByRole('button', { name: '取消', exact: true }).click();
      const settledCalls = statusCalls;
      await page.waitForTimeout(1200);
      assert.equal(statusCalls, settledCalls, 'leaving lookup must stop progress polling');

      await page.locator('[data-english-word-card="apple"]').click();
      const detail = page.getByRole('dialog', { name: 'apple', exact: true });
      await detail.locator('[data-dictionary-index-progress]').waitFor();
      await detail.getByText('已保存的释义', { exact: true }).waitFor();
      await detail.getByRole('button', { name: /编辑释义与笔记/ }).click();
      await detail.getByLabel('中文释义', { exact: true }).fill('详情中的更正');
      release(); release = null;
      await detail.locator('[data-dictionary-index-progress]').waitFor({ state: 'detached' });
      assert.equal(await detail.getByLabel('中文释义', { exact: true }).inputValue(), '详情中的更正');
      await detail.getByRole('button', { name: '取消', exact: true }).click();
      await detail.getByRole('button', { name: '关闭', exact: true }).last().click();

      await page.getByRole('button', { name: /批量导入/ }).click();
      const batch = page.getByRole('dialog', { name: '批量导入英语单词' });
      await batch.getByRole('textbox', { name: '单词列表', exact: true }).fill('book\t手工释义');
      const beforeManual = statusCalls;
      await batch.getByRole('button', { name: '不查词，手工预览', exact: true }).click();
      await batch.getByText('可导入 1', { exact: false }).waitFor();
      assert.equal(statusCalls, beforeManual, 'manual preview must not poll dictionary status');
      await page.route('**/api/english-words/batch-preview', async route => {
        await new Promise(resolve => { release = resolve; });
        await route.continue().catch(() => {});
      });
      await batch.getByRole('button', { name: '解析预览', exact: true }).click();
      await batch.locator('[data-dictionary-index-progress]').waitFor();
      release(); release = null;
      await batch.locator('[data-dictionary-index-progress]').waitFor({ state: 'detached' });
      await batch.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      console.log(`PASS ${width}/${theme}: dictionary preparation progress in lookup/detail/batch, edits preserved, polling stopped and manual preview skips progress requests`);
    } finally { release?.(); await context.close(); }
  }
};
