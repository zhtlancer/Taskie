// Build first. Real routes/API, temporary SQLite; screenshots are optional via SCREENSHOT_DIR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const c = createTestApp();
let browser;
const errors = [];
const pass = message => console.log(`PASS ${message}`);
async function render(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function keyboardCheck(page, modal) {
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  const controls = modal.locator('button:visible:not([disabled]), input:visible:not([disabled]), textarea:visible:not([disabled]), summary:visible');
  await controls.last().focus(); await page.keyboard.press('Tab');
  assert.ok(await modal.evaluate(el => el.contains(document.activeElement)));
  await controls.first().focus(); await page.keyboard.press('Shift+Tab');
  assert.ok(await modal.evaluate(el => el.contains(document.activeElement)));
  const sizes = await modal.locator('button:visible').evaluateAll(buttons => buttons.map(el => ({ name: el.textContent.trim(), h: el.getBoundingClientRect().height })));
  assert.deepEqual(sizes.filter(button => button.h < 43.9), [], 'modal controls need a 44px touch target');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function failOnce(page, pattern, action, modal, checkDraft) {
  await page.route(pattern, route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '测试保存失败' }) }), { times: 1 });
  await action();
  await modal.getByText(/测试保存失败|保存错题失败/).waitFor();
  if (checkDraft) await checkDraft();
}
async function heldSave(page, pattern, action, modal, closes = true) {
  let arrive, release;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(pattern, async route => { arrive(); await gate; await route.continue(); }, { times: 1 });
  const timeout = setTimeout(() => release(), 10000);
  let missing;
  try {
    await action();
    await Promise.race([arrived, new Promise((_, reject) => missing = setTimeout(() => reject(new Error(`Missing save ${pattern}`)), 8000))]);
    assert.equal(await modal.getByRole('button', { name: '关闭', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), true);
  } finally { release(); clearTimeout(timeout); clearTimeout(missing); }
  if (closes) {
    await modal.waitFor({ state: 'detached' });
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  } else {
    await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].some(el => el.getAttribute('aria-label') === '关闭' && !el.disabled));
    assert.equal(await modal.isVisible(), true);
  }
}
// Focusing a field on a touch screen would open its keyboard over the dialog's quick choices.
async function touchFocusCheck(page, modal) {
  await page.waitForFunction(() => document.querySelector('[role=dialog]')?.contains(document.activeElement));
  assert.equal(await modal.evaluate(() => ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)), false, 'touch screens keep the keyboard closed until a field is tapped');
}
async function signal(promise) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Request was not intercepted')), 10000); })]); }
  finally { clearTimeout(timer); }
}
async function main() {
  await c.app.ready();
  const api = async (method, url, payload) => {
    const result = await c.app.inject({ method, url: `/api${url}`, payload });
    assert.ok(result.statusCode < 300, result.body); return result.json();
  };
  const child = await api('POST', '/children', { name: '弹窗验收' });
  const task = await api('POST', `/children/${child.id}/adhoc-tasks`, { title: '跳过弹窗练习', subject: '其他' });
  const goal = await api('POST', `/children/${child.id}/goals`, { title: '用时弹窗练习', subject: '语文', mode: 'progress', unit: '页', total_amount: 100, track_time: true });
  const character = await api('POST', '/characters', { child_id: child.id, char: '山', categories: [] });
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', timezoneId: 'Asia/Shanghai', hasTouch: true });
  await context.addInitScript(value => { if (location.protocol === 'http:') sessionStorage.setItem('taskie_parent_token', value); }, token);
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const goto = name => page.goto(`${base}/child/${child.id}/${name}`, { waitUntil: 'domcontentloaded' });
  const shot = async name => {
    if (!process.env.SCREENSHOT_DIR) return;
    fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.getByRole('dialog').evaluate(el => el.querySelectorAll('.overflow-y-auto').forEach(area => { area.scrollTop = 0; }));
    await render(page);
    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `${name}.png`) });
  };
  const openSkip = async () => {
    const card = page.locator('[data-task-card]').filter({ hasText: '跳过弹窗练习' });
    await card.getByRole('button', { name: '更多任务操作', exact: true }).click();
    await card.getByRole('button', { name: '跳过任务', exact: true }).click();
    return page.getByRole('dialog', { name: /跳过这项任务/ });
  };
  await goto('today');
  await page.getByRole('button', { name: /开始计时/ }).waitFor();
  assert.ok((await page.getByRole('button', { name: /开始计时/ }).boundingBox()).height >= 44);
  const shortHeaderButtons = await page.locator('header').first().locator('button:visible, a:visible').evaluateAll(items => items.filter(el => el.getBoundingClientRect().height < 43.9 || el.getBoundingClientRect().width < 43.9).map(el => el.textContent));
  assert.deepEqual(shortHeaderButtons, []);
  let modal = await openSkip();
  await touchFocusCheck(page, modal);
  await modal.getByLabel('理由（必填）').fill('失败后仍保留的理由');
  await keyboardCheck(page, modal);
  await failOnce(page, '**/api/daily-tasks/*/skip', () => modal.getByRole('button', { name: '确认跳过', exact: true }).click(), modal,
    async () => assert.equal(await modal.getByLabel('理由（必填）').inputValue(), '失败后仍保留的理由'));
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  modal = await openSkip(); await modal.getByLabel('理由（必填）').fill('确认跳过');
  await heldSave(page, '**/api/daily-tasks/*/skip', () => modal.getByRole('button', { name: '确认跳过', exact: true }).click(), modal);
  assert.equal((await api('GET', `/daily-tasks?child_id=${child.id}`)).find(row => row.id === task.id).is_skipped, true);
  pass('skip dialog traps focus, retains failed input and protects a pending save');
  const openDuration = async () => {
    await page.getByRole('button', { name: '记录今天的进度', exact: true }).click();
    return page.getByRole('dialog', { name: /用了多久/ });
  };
  modal = await openDuration(); await touchFocusCheck(page, modal); await modal.getByRole('spinbutton').fill('12');
  await keyboardCheck(page, modal);
  await failOnce(page, '**/api/period-tasks/*/logs', () => modal.getByRole('button', { name: '完成', exact: true }).click(), modal,
    async () => assert.equal(await modal.getByRole('spinbutton').inputValue(), '12'));
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  modal = await openDuration(); await modal.getByRole('spinbutton').fill('12');
  await heldSave(page, '**/api/period-tasks/*/logs', () => modal.getByRole('button', { name: '完成', exact: true }).click(), modal);
  assert.equal((await api('GET', `/children/${child.id}/goals`)).find(row => row.id === goal.id).logs[0].duration_seconds, 720);
  pass('duration dialog retains failed input, protects pending saves and records the chosen time');

  await page.getByTitle('实时查笔画', { exact: true }).click();
  modal = page.getByRole('dialog', { name: '实时查笔画', exact: true });
  await modal.getByRole('textbox').fill('春天'); await modal.getByRole('textbox').dispatchEvent('input');
  await keyboardCheck(page, modal);
  const clearOverlap = await modal.evaluate(el => {
    const input = el.querySelector('input[aria-label="汉字或词语"]'), clear = el.querySelector('button[title="清空"]');
    return input.getBoundingClientRect().right - parseFloat(getComputedStyle(input).paddingRight) - clear.getBoundingClientRect().left;
  });
  assert.ok(clearOverlap <= 0, `the clear button covers ${clearOverlap}px of the typed text`);
  await failOnce(page, '**/api/characters', () => modal.getByRole('button', { name: /加入生字生词本/ }).click(), modal,
    async () => assert.equal(await modal.getByRole('textbox').inputValue(), '春天'));
  let release, arrive; const gate = new Promise(resolve => { release = resolve; }); const ready = new Promise(resolve => { arrive = resolve; });
  await page.route('**/api/characters', async route => { arrive(); await gate; await route.continue(); }, { times: 1 });
  const timer = setTimeout(release, 10000);
  try {
    await modal.getByRole('button', { name: /加入生字生词本/ }).click(); await signal(ready);
    await page.keyboard.press('Escape'); assert.equal(await modal.isVisible(), true);
  } finally { release(); clearTimeout(timer); }
  await modal.getByText('已在生字生词本', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  assert.equal(await page.getByTitle('实时查笔画', { exact: true }).evaluate(el => el === document.activeElement), true);
  pass('stroke lookup retains failed text, blocks closure while adding and restores its opener');

  await goto('characters');
  const openCharacter = async () => {
    await page.locator('button:visible').filter({ has: page.getByText('山', { exact: true }) }).first().click();
    return page.getByRole('dialog', { name: '生字笔顺与临摹', exact: true });
  };
  modal = await openCharacter(); await keyboardCheck(page, modal);
  await modal.getByRole('button', { name: '移出', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '确认操作', exact: true });
  await confirm.waitFor(); await page.keyboard.press('Escape'); await confirm.waitFor({ state: 'detached' });
  assert.equal(await modal.isVisible(), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  assert.equal(await modal.getByRole('button', { name: '移出', exact: true }).evaluate(el => el === document.activeElement), true);
  await failOnce(page, '**/api/characters/*/master', () => modal.getByRole('button', { name: /标记为已掌握/ }).click(), modal);
  assert.equal((await api('GET', `/characters?child_id=${child.id}`)).find(item => item.id === character.id).is_mastered, false);
  await heldSave(page, '**/api/characters/*/master', () => modal.getByRole('button', { name: /标记为已掌握/ }).click(), modal, false);
  await modal.getByRole('button', { name: /已掌握/ }).waitFor();
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'detached' });
  pass('character details preserve nested confirmation focus and display recoverable save errors');

  // A real white paper image, with an asymmetric coloured corner to inspect rotation/cropping.
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 600, 400);
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 100, 80); ctx.fillStyle = 'black'; ctx.font = '30px sans-serif'; ctx.fillText('12 + 8 = 20', 130, 190);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const file = { name: 'worksheet.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
  const openPhoto = async () => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /相册选图/ }).first().click()]);
    await chooser.setFiles(file);
    const dialog = page.getByRole('dialog'); await dialog.getByLabel('裁剪选区', { exact: true }).waitFor(); return dialog;
  };
  await goto('mistakes'); modal = await openPhoto(); await keyboardCheck(page, modal);
  const region = modal.getByLabel('裁剪选区', { exact: true });
  const before = await region.boundingBox();
  await page.mouse.move(before.x + before.width - 1, before.y + before.height - 1);
  await page.mouse.down(); await page.mouse.move(before.x + before.width - 30, before.y + before.height - 20, { steps: 4 }); await page.mouse.up();
  const changed = await region.boundingBox(); assert.ok(changed.width < before.width, 'dragging the crop corner shrinks the selection');
  const touch = await context.newCDPSession(page);
  const x = changed.x + changed.width / 2, y = changed.y + changed.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 8, y: y + 8, id: 1 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await render(page);
  const touched = await region.boundingBox();
  assert.ok(touched.x > changed.x + 5 && touched.y > changed.y + 5, 'a touch drag moves the selection in CSS coordinates');
  await touch.detach();
  await modal.getByRole('button', { name: '顺时针旋转 90 度', exact: true }).click();
  const canvas = modal.locator('canvas'); assert.ok(await canvas.evaluate(el => el.height > el.width));
  await modal.getByRole('button', { name: /下一步/ }).click();
  await modal.getByRole('textbox').fill('裁剪保存失败后保留的说明');
  await modal.getByRole('button', { name: /原图模式/ }).click();
  await modal.getByRole('button', { name: /确认保存至错题本/ }).waitFor();
  await modal.getByRole('button', { name: /重新裁剪/ }).click();
  await region.waitFor(); assert.ok(await canvas.evaluate(el => el.width > 0 && el.height > 0));
  const initialRatio = (await region.boundingBox()).width / (await canvas.boundingBox()).width;
  await page.setViewportSize({ width: 1180, height: 820 }); await render(page);
  assert.ok(Math.abs((await region.boundingBox()).width / (await canvas.boundingBox()).width - initialRatio) < 0.01, 'resizing preserves the crop in natural image coordinates');
  const selected = await region.boundingBox(), display = await canvas.boundingBox();
  const expectedImage = { width: Math.round(selected.width / display.width * 400), height: Math.round(selected.height / display.height * 600) };
  await modal.getByRole('button', { name: /下一步/ }).click();
  await page.waitForFunction(() => document.querySelector('img[alt="裁剪增强预览"]')?.naturalWidth > 0);
  const preview = await modal.getByAltText('裁剪增强预览').evaluate(el => ({ width: el.naturalWidth, height: el.naturalHeight }));
  assert.ok(Math.abs(preview.width - expectedImage.width) <= 2 && Math.abs(preview.height - expectedImage.height) <= 2, 'the preview uses the selected natural image coordinates after resize');
  await failOnce(page, '**/api/mistakes', () => modal.getByRole('button', { name: /确认保存至错题本/ }).click(), modal,
    async () => assert.equal(await modal.getByRole('textbox').inputValue(), '裁剪保存失败后保留的说明'));
  // A 5xx leaves the result unconfirmed, so only the original upload may be retried.
  assert.equal(await modal.getByRole('button', { name: /确认保存至错题本/ }).isDisabled(), true);
  await heldSave(page, '**/api/mistakes', () => modal.getByRole('button', { name: '按原内容重试', exact: true }).click(), modal);
  const records = await api('GET', `/mistakes?child_id=${child.id}`);
  assert.equal(records.length, 1); assert.ok(records[0].photo_path);
  const savedSize = await page.evaluate(async ([url, token]) => { const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error(`Photo HTTP ${response.status}`); const bitmap = await createImageBitmap(await response.blob()); const result = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return result; }, [`${base}${records[0].photo_path}`, token]);
  assert.deepEqual(savedSize, preview, 'saved image dimensions match the processed preview');
  pass('photo crop supports drag/rotate/recrop/resize, retains failed input and saves a real image');

  // Keep reviewable screenshots of all five dialogs in both themes and viewport sizes.
  await api('POST', `/daily-tasks/${task.id}/unskip`);
  for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 1180, height: 820 }]]) {
    await page.setViewportSize(viewport);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await goto('today'); modal = await openSkip(); await shot(`${device}-${theme}-skip`); await page.keyboard.press('Escape');
      modal = await openDuration(); await shot(`${device}-${theme}-duration`); await page.keyboard.press('Escape');
      await page.getByTitle('实时查笔画', { exact: true }).click(); modal = page.getByRole('dialog');
      await keyboardCheck(page, modal); await shot(`${device}-${theme}-lookup`); await page.keyboard.press('Escape');
      await goto('characters'); modal = await openCharacter(); await keyboardCheck(page, modal);
      const paper = modal.locator('div.touch-none').first();
      assert.equal(await paper.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
      await shot(`${device}-${theme}-character`); await page.keyboard.press('Escape');
      await goto('mistakes'); modal = await openPhoto(); await keyboardCheck(page, modal); await shot(`${device}-${theme}-crop`); await page.keyboard.press('Escape');
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
      assert.equal(await page.getByRole('button', { name: /相册选图/ }).first().evaluate(el => el === document.activeElement), true);
    }
  }
  assert.deepEqual(errors, []);
  pass('all five dialogs fit phone/tablet light/dark, retain white paper and release scroll locks');
}
main().catch(error => { console.error(error); if (errors.length) console.error('Page errors:', errors); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); await c.app.close(); cleanupTestApp(c);
});
