const assert = require('node:assert/strict');

module.exports = async function checkEnglishCaseRules({ browser, base, api, parentToken, openContext, errors }) {
  const child = await api('POST', '/children', { name: '大小写规则验收' });
  const words = () => api('GET', `/english-words?child_id=${child.id}`);
  const { context, page } = await openContext(browser, base, 390, 'light', parentToken, child, 'parent', errors);
  try {
    await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
    const lookup = page.getByRole('dialog', { name: '查词与收录单词' });
    const input = lookup.getByLabel('英文词条 *', { exact: true });
    const save = lookup.locator('button.ui-button-primary');
    const confirm = word => `确认将“${word}”作为独立词条保留`;
    await input.fill('May');
    await lookup.getByPlaceholder('例如：n. 苹果').fill('五月');
    await lookup.getByRole('checkbox', { name: '默写时严格区分大小写', exact: true }).check();
    await save.click();
    await lookup.waitFor({ state: 'detached' });
    await page.locator('[data-english-word-card="May"]').waitFor();
    assert.equal((await words()).find(word => word.word === 'May').strict_case, true);

    await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
    await input.fill('may');
    await lookup.getByPlaceholder('例如：n. 苹果').fill('可以');
    await lookup.getByRole('checkbox', { name: confirm('may'), exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    await lookup.getByRole('checkbox', { name: confirm('may'), exact: true }).check();
    await input.fill('maY');
    assert.equal(await lookup.getByRole('checkbox', { name: confirm('maY'), exact: true }).isChecked(), false, 'editing the spelling resets consent');
    await input.fill('may');
    await lookup.getByRole('checkbox', { name: confirm('may'), exact: true }).check();
    await save.click();
    await lookup.waitFor({ state: 'detached' });
    await page.locator('[data-english-word-card="may"]').click();
    const detail = page.getByRole('dialog', { name: 'may', exact: true });
    await detail.getByRole('button', { name: /编辑释义与单元/ }).click();
    await detail.getByLabel('英文词条', { exact: true }).fill('MAY');
    assert.equal(await detail.getByRole('button', { name: '保存修改', exact: true }).isDisabled(), true);
    await detail.getByRole('checkbox', { name: confirm('MAY'), exact: true }).check();
    await detail.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('dialog', { name: 'MAY', exact: true }).getByRole('button', { name: /编辑释义与单元/ }).waitFor();
    await page.getByRole('dialog', { name: 'MAY', exact: true }).getByRole('button', { name: '关闭', exact: true }).last().click();

    await page.getByRole('button', { name: /批量导入/ }).click();
    const batch = page.getByRole('dialog', { name: '批量导入英语单词' });
    await batch.getByPlaceholder(/apple/).fill('US\t美国\nus\t我们\nMay\t不能覆盖原释义\nbook\t书');
    await batch.getByRole('button', { name: '解析预览', exact: true }).click();
    const upper = batch.locator('[data-english-import-word="US"]');
    const lower = batch.locator('[data-english-import-word="us"]');
    await upper.getByRole('checkbox', { name: confirm('US'), exact: true }).waitFor();
    assert.equal(await batch.getByRole('button', { name: /确认导入/ }).isDisabled(), true);
    await upper.getByRole('checkbox', { name: 'US', exact: true }).uncheck();
    assert.equal(await lower.getByRole('checkbox', { name: confirm('us'), exact: true }).count(), 0, 'unselected peers do not require confirmation');
    await upper.getByRole('checkbox', { name: 'US', exact: true }).check();
    await upper.getByRole('checkbox', { name: '默写时严格区分大小写', exact: true }).check();
    await upper.getByRole('checkbox', { name: confirm('US'), exact: true }).check();
    await lower.getByRole('checkbox', { name: confirm('us'), exact: true }).check();
    await batch.getByRole('button', { name: /确认导入/ }).click();
    await batch.waitFor({ state: 'detached' });
    await page.locator('[data-english-word-card="US"]').waitFor();
    const imported = await words();
    assert.equal(imported.find(word => word.word === 'May').definition_zh, '五月');
    assert.equal(imported.find(word => word.word === 'May').strict_case, true);
    assert.equal(imported.find(word => word.word === 'US').strict_case, true);
    assert.equal(imported.find(word => word.word === 'us').strict_case, false);

    // Another device creates variants after the local list was loaded.
    await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
    await input.fill('Tree');
    await lookup.getByPlaceholder('例如：n. 苹果').fill('树');
    await api('POST', '/english-words', { child_id: child.id, word: 'tree', definition_zh: '树' });
    await save.click();
    await lookup.getByRole('checkbox', { name: confirm('Tree'), exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    await lookup.getByRole('checkbox', { name: confirm('Tree'), exact: true }).check();
    await save.click();
    await lookup.waitFor({ state: 'detached' });
    await page.locator('[data-english-word-card="Tree"]').waitFor();
    await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
    await input.fill('TREE');
    await lookup.getByPlaceholder('例如：n. 苹果').fill('树（缩写练习）');
    await lookup.getByRole('checkbox', { name: confirm('TREE'), exact: true }).check();
    await save.click();
    // The cached list knows Tree, but the server also knows tree. Consent resets.
    await lookup.getByText('存在大小写相近的词条，请确认后分别保留', { exact: true }).waitFor();
    assert.equal(await lookup.getByRole('checkbox', { name: confirm('TREE'), exact: true }).isChecked(), false);
    await lookup.getByRole('checkbox', { name: confirm('TREE'), exact: true }).check();
    await save.click();
    await lookup.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS case-variant create/rename/batch consent, unchanged exact duplicates and concurrent variant re-confirmation');
  } finally { await context.close(); }

  // Rules are read from the generated items, even after the live word is edited.
  await api('PUT', `/children/${child.id}/word-study/en/plans/write`, {
    enabled: true, days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 50, review_target: 0
  });
  const day = (await api('GET', `/children/${child.id}/word-study?language=en`)).days.find(day => day.skill === 'write');
  const all = await words();
  for (const word of all.filter(word => ['May', 'US', 'book'].includes(word.word))) {
    await api('PUT', `/english-words/${word.id}`, { strict_case: !word.strict_case });
  }
  const dark = await openContext(browser, base, 820, 'dark', parentToken, child, 'parent', errors);
  try {
    const page = dark.page;
    await page.goto(`${base}/child/${child.id}/word-study?language=en`, { waitUntil: 'domcontentloaded' });
    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: '英语单词默写', exact: true }) });
    await section.locator('summary').click();
    for (const [word, typed, correct, strict] of [['May', 'may', false, true], ['May', 'May', true, true], ['US', 'us', false, true], ['book', 'BOOK', true, false]]) {
      const index = day.batches[0].items.findIndex(item => item.text === word);
      assert.ok(index >= 0);
      assert.equal(day.batches[0].items[index].strict_case, strict);
      await section.getByRole('button', { name: new RegExp(`^待默写 #${index + 1} ·`) }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByPlaceholder('在此输入英文拼写…').fill(typed);
      await dialog.getByRole('button', { name: '核对拼写', exact: true }).click();
      await dialog.getByText(correct ? '✅ 拼写正确！' : /你输入的是/).waitFor();
      assert.equal(await dialog.getByText('✅ 拼写正确！', { exact: false }).count(), correct ? 1 : 0);
      await dialog.getByRole('button', { name: '关闭练习', exact: true }).click();
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS strict and tolerant spelling use frozen item rules after live word changes (dark tablet)');
  } finally { await dark.context.close(); }
};
