const assert = require('node:assert/strict');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');

module.exports = async function checkEnglishProgress({ browser, base, api, parentToken, openContext, errors, db }) {
  const child = await api('POST', '/children', { name: '学习进度验收' });
  const today = getTodayDate();
  const entries = {};
  for (const word of ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'mystery']) {
    entries[word] = await api('POST', '/english-words', { child_id: child.id, word,
      definition_zh: word === 'mystery' ? '' : `含义 ${word}`,
      textbook: ['alpha', 'beta'].includes(word) ? '进度教材' : '', unit: ['alpha', 'beta'].includes(word) ? '第一单元' : '' });
  }
  await api('PUT', `/english-words/${entries.delta.id}/master`, { is_mastered: true });
  const insert = db.prepare(`INSERT INTO word_study_states
    (id, child_id, language, english_word_id, skill, stage, next_due_date, last_review_date, failures)
    VALUES (?, ?, 'en', ?, ?, 1, ?, ?, 0)`);
  for (const [word, skill, dueOffset, lastOffset] of [
    ['beta', 'recognize', -1, -4], ['beta', 'write', 3, 0],
    ['gamma', 'recognize', 2, -1], ['gamma', 'write', 0, -3], ['epsilon', 'recognize', -1, 0]
  ]) insert.run(`progress-${word}-${skill}`, child.id, entries[word].id, skill, shiftDate(today, dueOffset), shiftDate(today, lastOffset));
  for (const skill of ['recognize', 'write']) await api('PUT', `/children/${child.id}/word-study/en/plans/${skill}`, {
    days_of_week: [0, 1, 2, 3, 4, 5, 6], new_target: 50, review_target: 50, categories: [], include_mastered: true
  });

  for (const [width, theme] of [[390, 'light'], [820, 'dark']]) {
    const { context, page } = await openContext(browser, base, width, theme, parentToken, child, 'parent', errors);
    try {
      const bookUrl = `${base}/child/${child.id}/characters?lang=en`;
      await page.goto(bookUrl, { waitUntil: 'domcontentloaded' });
      const card = word => page.locator(`[data-english-word-card="${word}"]`);
      const row = (word, skill) => card(word).locator(`[data-study-skill="${skill}"]`);
      await row('beta', 'recognize').getByText('认读 · 今日待复习', { exact: true }).waitFor();
      await row('beta', 'recognize').getByText(`最近学习：${shiftDate(today, -4)}`, { exact: true }).waitFor();
      await row('beta', 'recognize').getByText(`下次复习：${shiftDate(today, -1)}`, { exact: true }).waitFor();
      await row('alpha', 'write').getByText('默写 · 未学习', { exact: true }).waitFor();
      await row('alpha', 'write').getByText('最近学习：—', { exact: true }).waitFor();
      await row('delta', 'recognize').getByText('认读 · 未学习', { exact: true }).waitFor();
      await card('delta').getByRole('button', { name: '✅ 已掌握', exact: true }).waitFor();
      await row('epsilon', 'recognize').getByText('认读 · 复习中', { exact: true }).waitFor();

      const skillFilter = page.getByLabel('练习技能', { exact: true });
      const statusFilter = page.getByLabel('学习进度', { exact: true });
      await skillFilter.selectOption('recognize');
      await statusFilter.selectOption('due');
      assert.deepEqual(await page.locator('[data-english-word-card]').evaluateAll(nodes => nodes.map(node => node.dataset.englishWordCard)), ['beta']);
      await page.getByLabel('按教材筛选').selectOption('进度教材');
      await page.getByLabel('按单元筛选').selectOption('第一单元');
      await page.getByPlaceholder('搜索单词、释义或单元…').fill('gamma');
      await page.locator('[data-english-empty]').getByText('当前筛选下没有单词', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看全部单词', exact: true }).click();
      assert.equal(await skillFilter.inputValue(), 'any');
      assert.equal(await statusFilter.inputValue(), 'all');
      await statusFilter.selectOption('unlearned');
      const unlearned = await page.locator('[data-english-word-card]').evaluateAll(nodes => nodes.map(node => node.dataset.englishWordCard).sort());
      assert.deepEqual(unlearned, ['alpha', 'delta', 'epsilon', 'mystery']);
      await skillFilter.selectOption('write');
      await statusFilter.selectOption('due');
      if (width === 390) {
        await card('gamma').waitFor();
        // Keyboard navigation must follow the nested link without opening the detail dialog.
        const link = card('gamma').getByRole('link', { name: '前往默写练习', exact: true });
        await link.focus();
        await page.keyboard.press('Enter');
        await page.locator('[data-study-skill-filter]').getByText('当前查看：英语默写', { exact: true }).waitFor();
        assert.equal(new URL(page.url()).searchParams.get('language'), 'en');
        assert.equal(new URL(page.url()).searchParams.get('skill'), 'write');
        await page.locator('[data-study-day-skill="write"]').waitFor();
        assert.equal(await page.locator('[data-study-day-skill="recognize"]').count(), 0);
        assert.equal(await page.getByRole('dialog').count(), 0);
        const overview = await api('GET', `/children/${child.id}/word-study?language=en`);
        const day = overview.days.find(day => day.skill === 'write');
        const index = day.batches[0].items.findIndex(item => item.english_word_id === entries.gamma.id);
        assert.ok(index >= 0);
        const section = page.locator('[data-study-day-skill="write"]');
        await section.locator('summary').click();
        await section.getByRole('button', { name: new RegExp(`^待默写 #${index + 1} ·`) }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByPlaceholder('在此输入英文拼写…').fill('gamma');
        await dialog.getByRole('button', { name: '核对拼写', exact: true }).click();
        await dialog.getByRole('button', { name: '提交：独立拼对', exact: true }).click();
        await dialog.getByText(/已记录“独立完成”/).waitFor();
        await dialog.getByRole('button', { name: '关闭练习', exact: true }).click();
        await page.getByRole('button', { name: '查看全部技能', exact: true }).click();
        await page.locator('[data-study-day-skill="recognize"]').waitFor();
        await page.getByRole('link', { name: '英语单词本', exact: true }).click();
        await row('gamma', 'write').getByText('默写 · 复习中', { exact: true }).waitFor();
        await row('gamma', 'write').getByText(`最近学习：${today}`, { exact: true }).waitFor();
      } else {
        // The previous context really completed gamma, so the due filter is now empty.
        await page.locator('[data-english-empty]').getByText('当前筛选下没有单词', { exact: true }).waitFor();
        await statusFilter.selectOption('all');
        await card('beta').click();
        const detail = page.getByRole('dialog', { name: 'beta', exact: true });
        await detail.locator('[data-study-skill="recognize"]').getByText('认读 · 今日待复习', { exact: true }).waitFor();
        await detail.getByRole('link', { name: '前往认读练习', exact: true }).click();
        await page.locator('[data-study-skill-filter]').getByText('当前查看：英语认读', { exact: true }).waitFor();
        await page.locator('[data-study-day-skill="recognize"]').waitFor();
        assert.equal(await page.locator('[data-study-day-skill="write"]').count(), 0);
        await page.getByRole('link', { name: '英语单词本', exact: true }).click();
      }

      // A returning tab rereads progress written by another device.
      db.prepare("UPDATE word_study_states SET next_due_date = ?, last_review_date = ? WHERE english_word_id = ? AND skill = 'recognize'")
        .run(shiftDate(today, 3), today, entries.beta.id);
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await row('beta', 'recognize').getByText('认读 · 复习中', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const smallLinks = await page.locator('[data-english-study-progress] a').evaluateAll(links => links.filter(link => {
        const rect = link.getBoundingClientRect();
        return rect.height < 43.9 || rect.width < 43.9 || rect.left < -0.5 || rect.right > innerWidth + 1;
      }).length);
      assert.equal(smallLinks, 0);
      // Restore the due fixture for the second viewport.
      db.prepare("UPDATE word_study_states SET next_due_date = ?, last_review_date = ? WHERE english_word_id = ? AND skill = 'recognize'")
        .run(shiftDate(today, -1), shiftDate(today, -4), entries.beta.id);
    } finally { await context.close(); }
  }
  console.log('PASS English skill progress: independent states/dates, manual mastery, combined filters, keyboard links, real grading, returning-tab refresh and phone/light + tablet/dark layout');
};
