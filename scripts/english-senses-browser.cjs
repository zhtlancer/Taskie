const assert = require('node:assert/strict');

module.exports = async function checkEnglishSenses({ browser, base, api, parentToken, openContext, errors }) {
  const child = await api('POST', '/children', { name: '多义项验收' });
  const words = () => api('GET', `/english-words?child_id=${child.id}`);
  // Exercise real dictionary candidates, manual corrections and removing a primary sense.
  for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
    const { context, page } = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
    try {
      await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
      if (width === 390) {
        await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
        const lookup = page.getByRole('dialog', { name: '查词与收录单词' });
        await lookup.getByPlaceholder(/输入英文单词或短语/).fill('apple');
        await lookup.getByRole('button', { name: /查词/ }).click();
      await lookup.getByText('英 /ˈæpl/', { exact: true }).waitFor();
        await lookup.getByLabel('中文释义', { exact: true }).fill('手工更正：苹果');
        // Looking up the same spelling again must preserve edits.
        await lookup.getByRole('button', { name: /查词/ }).click();
        await lookup.getByRole('button', { name: /查词/ }).waitFor();
        await lookup.locator('summary').filter({ hasText: '选择收录词典义项' }).click();
        const second = lookup.getByRole('button', { name: '收录义项 2', exact: true });
        await second.click();
        assert.equal(await lookup.getByLabel('中文释义', { exact: true }).inputValue(), '手工更正：苹果');
        assert.equal(await lookup.locator('[data-sense-id]').count(), 2);
        await lookup.getByRole('button', { name: '已收录义项 2', exact: true }).waitFor();
        assert.equal(await lookup.getByRole('button', { name: '已收录义项 2', exact: true }).isDisabled(), true);
        await lookup.getByLabel('义项 2 例句（选填）', { exact: true }).fill('An apple a day.');
        await lookup.getByRole('button', { name: '加入单词本', exact: true }).click();
        await lookup.waitFor({ state: 'detached' });
        const apple = (await words()).find(word => word.word === 'apple');
        assert.equal(apple.senses.length, 2);
        assert.equal(apple.definition_zh, '手工更正：苹果');
        assert.equal(apple.senses[1].source.dict_id, 'oald8');
        assert.equal(apple.senses[1].example, 'An apple a day.');
      }

      await page.locator('[data-english-word-card="apple"]').click();
      const detail = page.getByRole('dialog', { name: 'apple', exact: true });
      await detail.getByText('手工更正：苹果', { exact: true }).waitFor();
      await detail.getByRole('button', { name: /编辑释义与笔记/ }).click();
      const editor = detail.locator('[data-english-senses-editor]');
      if (width === 390) {
        await editor.getByRole('button', { name: '设为学习释义', exact: true }).click();
        assert.match(await editor.getByLabel('英文释义', { exact: true }).inputValue(), /fruit/);
        await detail.getByRole('button', { name: '保存修改', exact: true }).click();
        await detail.locator('[data-sense-detail]').first().waitFor();
        assert.match((await words())[0].definition_en, /fruit/);
        assert.equal((await words())[0].senses[0].definition_zh, '手工更正：苹果');
      } else {
        // A blank manual sense is allowed; choose it, fill it, then remove it.
        await editor.getByRole('button', { name: '＋ 手动新增义项', exact: true }).click();
        const third = editor.locator('[data-sense-id]').nth(2);
        await third.getByRole('button', { name: '设为学习释义', exact: true }).click();
        await third.getByLabel('中文释义', { exact: true }).fill('新的备用义项');
        await third.getByRole('button', { name: '移除义项 3', exact: true }).click();
        assert.equal(await editor.getByLabel('中文释义', { exact: true }).inputValue(), '手工更正：苹果');
        await detail.getByRole('button', { name: '保存修改', exact: true }).click();
        await detail.locator('[data-sense-detail]').first().waitFor();
        assert.equal((await words())[0].definition_zh, '手工更正：苹果');
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await detail.locator('[data-sense-detail]').count(), 2);
      await detail.getByRole('button', { name: '关闭', exact: true }).last().click();

      // Search includes saved non-primary meanings and examples.
      const search = page.getByPlaceholder('搜索单词、释义或单元…');
      await search.fill('An apple a day.');
      await page.locator('[data-english-word-card="apple"]').waitFor();
      await search.fill('手工更正');
      await page.locator('[data-english-word-card="apple"]').waitFor();
      await search.fill('');

      if (width === 820) {
        await page.getByRole('button', { name: /批量导入/ }).click();
        const batch = page.getByRole('dialog', { name: '批量导入英语单词' });
        await batch.getByPlaceholder(/apple/).fill('book\t手工书本');
        await batch.getByRole('button', { name: '解析预览', exact: true }).click();
        const row = batch.locator('[data-english-import-word="book"]');
        await row.getByPlaceholder('中文释义（如：苹果；也可导入后补填）').fill('更正后的书本');
        await row.locator('summary').filter({ hasText: '管理义项与例句' }).click();
        const batchEditor = row.locator('[data-english-senses-editor]');
        assert.equal(await batchEditor.getByLabel('中文释义', { exact: true }).inputValue(), '更正后的书本');
        await batchEditor.getByLabel('例句（选填）', { exact: true }).fill('Read this book.');
        await batch.getByRole('button', { name: /确认导入/ }).click();
        await batch.waitFor({ state: 'detached' });
        const book = (await words()).find(word => word.word === 'book');
        assert.equal(book.definition_zh, '更正后的书本');
        assert.equal(book.senses[0].example, 'Read this book.');
        assert.ok(book.senses.length > 1, 'batch import retains separate dictionary definitions');
      }
    } finally { await context.close(); }
  }
  console.log('PASS multiple senses: dictionary append preserves edits, primary selection/removal, provenance, examples and batch editing in phone/light and tablet/dark');
};
