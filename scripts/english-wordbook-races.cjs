const assert = require('node:assert/strict');

// Run against the smoke suite's isolated app. Hold actual HTTP responses after
// server writes, then replace the owner of the pending UI operation.
module.exports = async function checkEnglishModalRaces({ page, base, child, childB, api, rotatedToken }) {
  const entries = new Map();
  for (const owner of [child, childB]) {
    entries.set(owner.id, await api('POST', '/english-words', {
      child_id: owner.id, word: 'scopeword', definition_zh: '作用域测试', categories: ['recognize']
    }));
  }
  let owner = child;
  let serial = 0;
  const gates = new Set();
  const pattern = '**/api/**';
  async function hold(method, pathname, fail) {
    let started, release, done;
    const began = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const completed = new Promise(resolve => { done = resolve; });
    let used = false;
    const handler = async route => {
      if (used || route.request().method() !== method || new URL(route.request().url()).pathname !== pathname) return route.fallback();
      used = true;
      try {
        const response = fail ? null : await route.fetch();
        started();
        await gate;
        if (fail) await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: '旧请求错误' }) });
        else await route.fulfill({ response });
      } catch (error) {
        // Editing the lookup input deliberately aborts obsolete dictionary GETs.
        if (method !== 'GET') throw error;
      } finally { done(); }
    };
    await page.route(pattern, handler);
    const held = {
      async wait() {
        let timeout;
        try {
          await Promise.race([began, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`No held ${method} ${pathname}`)), 12000); })]);
        } finally { clearTimeout(timeout); }
        await page.unroute(pattern, handler);
      },
      async release() { release(); if (used) await completed; gates.delete(held); }
    };
    gates.add(held);
    return held;
  }

  async function settled() {
    await page.waitForFunction(() => {
      const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('englishWord');
      return s && s.isLoaded && !s.loading;
    });
  }
  async function reset(kind) {
    if (kind === 'child') {
      owner = owner.id === child.id ? childB : child;
      await page.evaluate(id => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(`/child/${id}/characters?lang=en`), owner.id);
    } else {
      await page.evaluate(({ kind, token }) => {
        if (kind === 'session') sessionStorage.setItem('taskie_parent_token', token);
        else sessionStorage.removeItem('taskie_data_generation');
        window.dispatchEvent(new Event(kind === 'session' ? 'taskie:session-changed' : 'taskie:data-restored'));
      }, { kind, token: rotatedToken });
    }
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await settled();
  }
  async function prepare(type, word, note) {
    if (type === 'lookup') {
      await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
      const dialog = page.getByRole('dialog', { name: '查词与收录单词' });
      // WebKit fill() focuses first and inserts text in a later step; let the
      // dialog's initial autofocus settle so the text reaches the intended field.
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].at(-1)?.contains(document.activeElement));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const wordInput = dialog.getByLabel('英文词条 *', { exact: true });
      const definition = dialog.getByPlaceholder('例如：n. 苹果');
      await wordInput.fill(word);
      await definition.fill('竞态释义');
      assert.equal(await wordInput.inputValue(), word, 'lookup word field keeps the filled word');
      assert.equal(await definition.inputValue(), '竞态释义');
      // Offline collection can proceed as an unassigned word even if the optional book list failed.
      assert.equal(await dialog.getByLabel('收录到词本', { exact: true }).count(), 1);
      return { dialog, button: dialog.locator('button.ui-button-primary'), action: 'addWord', method: 'POST', pathname: '/api/english-words' };
    }
    if (type === 'batch') {
      await page.getByRole('button', { name: /批量导入/ }).click();
      const dialog = page.getByRole('dialog', { name: '批量导入英语单词' });
      assert.equal(await dialog.getByPlaceholder('如 Unit 2').isEnabled(), true);
      await dialog.getByPlaceholder(/apple/).fill(`${word}\t竞态释义`);
      await dialog.getByRole('button', { name: '解析预览', exact: true }).click();
      await dialog.getByPlaceholder('中文释义（如：苹果；也可导入后补填）').waitFor();
      return { dialog, button: dialog.locator('button.ui-button-primary'), action: 'batchImportWords', method: 'POST', pathname: '/api/english-words/batch' };
    }
    const entry = entries.get(owner.id);
    await page.locator('[data-english-word-card="scopeword"]').click();
    const dialog = page.getByRole('dialog', { name: 'scopeword', exact: true });
    if (type === 'edit') {
      await dialog.getByRole('button', { name: /编辑释义与笔记/ }).click();
      await dialog.getByLabel('记忆笔记', { exact: true }).fill(note);
      assert.equal(await dialog.getByLabel('英式音标', { exact: true }).isEnabled(), true);
      await dialog.getByLabel('英式音标', { exact: true }).fill('test');
      return { dialog, button: dialog.locator('button.ui-button-primary'), action: 'updateWord', method: 'PUT', pathname: `/api/english-words/${entry.id}` };
    }
    if (type === 'category') return { dialog, button: dialog.getByRole('button', { name: /会认读/ }), action: 'setCategories', method: 'PUT', pathname: `/api/english-words/${entry.id}/categories` };
    if (type === 'master') return { dialog, button: dialog.getByRole('button', { name: /标记已掌握|✅ 已掌握/ }), action: 'toggleMaster', method: 'PUT', pathname: `/api/english-words/${entry.id}/master` };
    await dialog.getByRole('button', { name: '🗑️ 移出单词本', exact: true }).click();
    return { dialog, button: dialog.getByRole('button', { name: '确认移出', exact: true }), action: 'removeWord', method: 'DELETE', pathname: `/api/english-words/${entry.id}` };
  }

  await page.goto(`${base}/child/${child.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
  await settled();
  try {
    for (const [type, scope, fail] of [
      ['lookup', 'restore', true], ['lookup', 'child', false],
      ['batch', 'restore', false], ['batch', 'session', true],
      ['edit', 'restore', true], ['edit', 'child', false],
      ['category', 'restore', true], ['master', 'restore', true], ['delete', 'restore', true]
    ]) {
      const word = `raceword${++serial}`;
      const old = await prepare(type, word, '旧笔记');
      await page.evaluate(action => {
        const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('englishWord');
        window.__raceDone = [];
        let seq = 0;
        window.__stopRace = s.$onAction(({ name, after, onError }) => {
          if (name !== action) return;
          const index = seq++;
          after(() => { window.__raceDone[index] = true; });
          onError(() => { window.__raceDone[index] = true; });
        });
      }, old.action);
      const pendingOld = await hold(old.method, old.pathname, fail);
      await old.button.click();
      await pendingOld.wait();
      await reset(scope);

      const fresh = await prepare(type, fail ? word : `${word}new`, '新笔记');
      const pendingNew = await hold(fresh.method, fresh.pathname, false);
      await fresh.button.click();
      await pendingNew.wait();
      await pendingOld.release();
      await page.waitForFunction(() => window.__raceDone[0]);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

      assert.equal(await fresh.dialog.isVisible(), true, `${type}/${scope}: old callback must not close new dialog`);
      assert.equal(await fresh.button.isDisabled(), true, `${type}/${scope}: old finally must not release new save lock`);
      assert.equal(await fresh.dialog.getByText('旧请求错误', { exact: true }).count(), 0);
      if (type === 'lookup') {
        assert.equal(await page.evaluate(() => Object.keys(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('englishWord').addingKeys).length), 1);
      } else if (!['batch'].includes(type)) {
        assert.equal(await page.evaluate(() => Object.keys(document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('englishWord').busyIds).length), 1);
      }
      await pendingNew.release();
      await page.waitForFunction(() => window.__raceDone[1]);
      if (['lookup', 'batch', 'delete'].includes(type)) await fresh.dialog.waitFor({ state: 'detached' });
      else {
        if (type === 'edit') {
          await fresh.dialog.getByText('新笔记', { exact: true }).waitFor();
          const updated = await api('GET', `/english-words/${entries.get(owner.id).id}`);
          assert.equal(updated.phonetic_uk, 'test');
        }
        await fresh.dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
      }
      await page.evaluate(() => window.__stopRace());
      console.log(`PASS stale ${type} ${fail ? 'error' : 'success'} across ${scope} preserves new modal and save lock`);
    }

    // A slow dictionary lookup or autocomplete must not overwrite changed input.
    await page.getByRole('button', { name: /查词 · 收录单词/ }).click();
    const lookup = page.getByRole('dialog', { name: '查词与收录单词' });
    const input = lookup.getByPlaceholder(/输入英文单词或短语/);
    const oldLookup = await hold('GET', '/api/dictionary/lookup', false);
    await input.fill('apple');
    await lookup.getByRole('button', { name: /查词/ }).click();
    await oldLookup.wait();
    await input.fill('book');
    await lookup.getByRole('button', { name: /查词/ }).click();
    await page.waitForFunction(el => el.value === 'book', await lookup.getByLabel('英文词条 *', { exact: true }).elementHandle());
    await oldLookup.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await lookup.getByLabel('英文词条 *', { exact: true }).inputValue(), 'book');
    const oldSuggestion = await hold('GET', '/api/dictionary/suggest', false);
    await input.fill('ap');
    await oldSuggestion.wait();
    await input.fill('bo');
    await lookup.getByRole('button', { name: 'book', exact: true }).waitFor();
    await oldSuggestion.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await lookup.getByRole('button', { name: 'apple', exact: true }).count(), 0);
    await input.fill('apple');
    await lookup.getByRole('button', { name: /查词/ }).click();
    await page.waitForFunction(el => el.value === 'apple', await lookup.getByLabel('英文词条 *', { exact: true }).elementHandle());
    await lookup.getByRole('button', { name: /查看完整原词典/ }).click();
    const article = page.getByRole('dialog', { name: '原词典 · apple', exact: true });
    await article.getByRole('button', { name: 'pie', exact: true }).waitFor();
    const oldArticle = await hold('GET', '/api/dictionary/article', false);
    await article.getByRole('button', { name: 'pie', exact: true }).click();
    await oldArticle.wait();
    await page.getByRole('button', { name: /返回 apple/ }).click();
    await article.getByText('a round crisp fruit', { exact: true }).waitFor();
    await oldArticle.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await article.getByText('baked dish of fruit or meat', { exact: true }).count(), 0);
    await article.getByRole('button', { name: '关闭', exact: true }).last().click();
    await lookup.getByRole('button', { name: '取消', exact: true }).click();

    // Preview results belong to their original raw text, and to the original modal.
    await page.getByRole('button', { name: /批量导入/ }).click();
    const batch = page.getByRole('dialog', { name: '批量导入英语单词' });
    const raw = batch.getByPlaceholder(/apple/);
    const oldPreview = await hold('POST', '/api/english-words/batch-preview', false);
    await raw.fill('oldpreview\t旧释义');
    await batch.getByRole('button', { name: '解析预览', exact: true }).click();
    await oldPreview.wait();
    await raw.fill('newpreview\t新释义');
    await batch.getByRole('button', { name: '解析预览', exact: true }).click();
    await batch.getByText('newpreview', { exact: true }).waitFor();
    await oldPreview.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await batch.getByText('oldpreview', { exact: true }).count(), 0);
    await batch.getByRole('button', { name: '取消', exact: true }).click();

    await page.getByRole('button', { name: /批量导入/ }).click();
    const stalePreview = await hold('POST', '/api/english-words/batch-preview', false);
    await raw.fill('oldpreview\t旧释义');
    await batch.getByRole('button', { name: '解析预览', exact: true }).click();
    await stalePreview.wait();
    await reset('restore');
    await page.getByRole('button', { name: /批量导入/ }).click();
    const freshPreview = await hold('POST', '/api/english-words/batch-preview', false);
    await raw.fill('newpreview\t新释义');
    await batch.getByRole('button', { name: '解析预览', exact: true }).click();
    await freshPreview.wait();
    await stalePreview.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await batch.getByRole('button', { name: '解析匹配中…', exact: true }).isDisabled(), true);
    assert.equal(await batch.getByText('oldpreview', { exact: true }).count(), 0);
    await freshPreview.release();
    await batch.getByText('newpreview', { exact: true }).waitFor();
    await batch.getByRole('button', { name: '取消', exact: true }).click();
    console.log('PASS delayed lookup, autocomplete, dictionary article and batch previews cannot overwrite new input or modal');

    // The plan editor also survives a same-child restore during save.
    await page.goto(`${base}/parent/word-plans?child=${owner.id}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /英语单词计划/ }).click();
    const plan = page.locator('article').filter({ has: page.getByRole('heading', { name: '英语单词认读' }) });
    for (const fail of [true, false]) {
      const pathname = `/api/children/${owner.id}/word-study/en/plans/recognize`;
      await plan.getByLabel('每日新学目标', { exact: true }).fill('7');
      const oldPlan = await hold('PUT', pathname, fail);
      await plan.getByRole('button', { name: /保存英语单词认读计划/ }).click();
      await oldPlan.wait();
      await page.evaluate(() => {
        sessionStorage.removeItem('taskie_data_generation');
        window.dispatchEvent(new Event('taskie:data-restored'));
      });
      // The parent page reloads the child picker and remounts settings in Chinese.
      await page.getByRole('tab', { name: /英语单词计划/ }).click();
      await plan.getByLabel('每日新学目标', { exact: true }).waitFor();
      await plan.getByLabel('每日新学目标', { exact: true }).fill('11');
      const freshPlan = await hold('PUT', pathname, false);
      await plan.getByRole('button', { name: /保存英语单词认读计划/ }).click();
      await freshPlan.wait();
      await oldPlan.release();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await plan.getByRole('button', { name: '保存中…', exact: true }).isDisabled(), true);
      assert.equal(await plan.getByLabel('每日新学目标', { exact: true }).inputValue(), '11');
      assert.equal(await plan.getByText('旧请求错误', { exact: true }).count(), 0);
      assert.equal(await plan.getByText('计划已保存，并按约定生效。', { exact: true }).count(), 0);
      await freshPlan.release();
      await plan.getByText('计划已保存，并按约定生效。', { exact: true }).waitFor();
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /英语单词计划/ }).click();
    await plan.getByLabel('每日新学目标', { exact: true }).waitFor();
    assert.equal(await plan.getByLabel('每日新学目标', { exact: true }).inputValue(), '11');
    console.log('PASS stale plan save success/error after restore preserves new save and parent target');

    // Use the actual 409 interceptor so generation is unknown while a new modal
    // starts saving. Completing its first calibration must not strand that save.
    const trigger = await api('POST', '/english-words', { child_id: owner.id, word: 'calibrationtrigger', definition_zh: '校准触发词' });
    await page.goto(`${base}/child/${owner.id}/characters?lang=en`, { waitUntil: 'domcontentloaded' });
    await settled();
    const calibration = await hold('GET', '/api/auth/data-generation', false);
    await page.route(`**/api/english-words/${trigger.id}/master`, route => route.fulfill({
      status: 409, contentType: 'application/json',
      body: JSON.stringify({ code: 'DATA_RESTORED', error: '数据已恢复，这次操作没有执行，请核对后重新操作' })
    }), { times: 1 });
    await page.locator('[data-english-word-card="calibrationtrigger"]').getByRole('button', { name: /标记已掌握/ }).click();
    await calibration.wait();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('taskie_data_generation')), null);
    const currentSave = await prepare('lookup', 'calibrationword', '');
    await currentSave.button.click();
    await currentSave.dialog.getByRole('button', { name: '保存中…', exact: true }).waitFor();
    const saved = page.waitForResponse(res => new URL(res.url()).pathname === '/api/english-words' && res.request().method() === 'POST');
    await calibration.release();
    assert.equal((await saved).status(), 201);
    await currentSave.dialog.waitFor({ state: 'detached' });
    await page.locator('[data-english-word-card="calibrationword"]').waitFor();
    assert.equal((await api('GET', `/english-words?child_id=${owner.id}`)).filter(word => word.word === 'calibrationword').length, 1);
    console.log('PASS first generation calibration after DATA_RESTORED completes a new save and closes its modal');
  } finally {
    // Release any outstanding intercepted requests before closing the context.
    await page.unroute(pattern);
    await Promise.allSettled([...gates].map(gate => gate.release()));
  }
};
