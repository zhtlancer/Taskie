// Build first. BROWSER=webkit covers Safari-engine layouts; successful writes use the real API.
const assert = require('node:assert/strict');
const { chromium, launchOptions, smokePort } = require('./browser-env.cjs');
const { webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { createTestApp, cleanupTestApp } = require('../backend/test/helper');
const { getTodayDate, shiftDate } = require('../backend/src/utils/date');
const c = createTestApp();
let browser;

async function checkBounds(root, selector, count, sameRow = false) {
  // Jump finite animations/transitions to their end: Chromium can leave a reduced-motion transition started by
  // the enlarged root font pending indefinitely, so awaiting `finished` could stall the suite.
  await root.evaluate(async el => {
    for (const animation of el.parentElement.getAnimations({ subtree: true })) {
      if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const boxes = await root.evaluate((el, selector) => {
    const rect = node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height }; };
    return [...el.querySelectorAll(selector)].map(field => {
      const form = field.closest('form'), style = getComputedStyle(form), box = rect(form);
      return { field: rect(field), column: rect(field.parentElement), type: field.type,
        contentLeft: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        contentRight: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight) };
    });
  }, selector);
  assert.equal(boxes.length, count);
  for (let i = 0; i < boxes.length; i++) {
    const { field, column, type, contentLeft, contentRight } = boxes[i];
    assert.ok(field.left >= column.left - 1 && field.right <= column.right + 1, `input border must fit its column: ${JSON.stringify(boxes[i])}`);
    assert.ok(field.left >= contentLeft - 1 && field.right <= contentRight + 1, 'inputs must stay inside form padding, clear of its border');
    if (['date', 'time'].includes(type)) assert.ok(field.height >= 43.9, 'date/time touch targets remain at least 44px');
    // Longer labels can wrap with enlarged text; their columns must still share one grid row.
    if (sameRow) assert.ok(Math.abs(column.top - boxes[0].column.top) < 1, 'the original side-by-side columns remain');
    for (const { field: other } of boxes.slice(i + 1)) {
      assert.ok(field.right + 1 <= other.left || other.right + 1 <= field.left || field.bottom + 1 <= other.top || other.bottom + 1 <= field.top, 'input borders must remain separated');
    }
  }
}

async function checkSizes(page, root, selector, count, sameRow = false) {
  await checkBounds(root, selector, count, sameRow);
  await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
  try { await checkBounds(root, selector, count, sameRow); }
  finally { await page.evaluate(() => { document.documentElement.style.fontSize = ''; }); }
}

async function main() {
  await c.app.ready();
  const { childrenService, periodsService, scheduleService } = c.app.services;
  const child = childrenService.createChild({ name: '输入边界检查' });
  const today = getTodayDate(), end = shiftDate(today, 30), changedEnd = shiftDate(today, 40);
  const goals = ['position', 'increment'].map(input_mode => periodsService.createGoal(child.id, { title: `日期任务-${input_mode}`, subject: '语文',
    mode: 'progress', input_mode, total_amount: 200, unit: '页', start_date: shiftDate(today, -7), end_date: end }));
  const timetable = scheduleService.createTimetable(child.id, { name: '日期检查学期', start_date: shiftDate(today, -7), end_date: end,
    slots: [{ id: 'morning', kind: 'class', label: '第1节', start_time: '08:00', end_time: '08:40' }], lessons: [] });
  const cls = scheduleService.createClass({ title: '日期检查课程', child_ids: [child.id], start_date: today, end_date: end,
    days_of_week: [1, 3, 5], start_time: '16:00', end_time: '17:00' });
  // A daily class guarantees a lesson on the board today for its parent move dialog.
  const daily = scheduleService.createClass({ title: '看板调课检查', child_ids: [child.id], start_date: today, end_date: end,
    days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time: '16:00', end_time: '17:00' });
  const token = c.app.jwt.sign({ role: 'parent', epoch: c.app.sessionEpoch() });
  const base = await c.app.listen({ host: '127.0.0.1', port: smokePort() });
  const engine = process.env.BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch(engine === webkit ? { headless: true } : launchOptions());
  const errors = [];
  for (const [width, height] of [[390, 844], [507, 820], [768, 1024], [820, 1180], [1180, 820]]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: theme,
      hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    try {
      await context.addInitScript(({ token, child, theme }) => {
        sessionStorage.setItem('taskie_parent_token', token); sessionStorage.setItem('current_child', JSON.stringify(child));
        localStorage.setItem('taskie_theme', theme);
      }, { token, child, theme });
      const page = await context.newPage(); page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      const save = theme === 'light' && [390, 820].includes(width);
      const goto = path => page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
      const cancel = form => form.getByRole('button', { name: '取消', exact: true }).click();
      const goalForm = () => page.locator('form').filter({ has: page.getByPlaceholder('例如：寒假作业、读完《西游记》', { exact: true }) });
      const goalCard = goal => page.locator('div.rounded-2xl.border.p-3').filter({ has: page.getByText(goal.title, { exact: true }) });

      await goto('/parent/periods');
      await page.getByRole('button', { name: /新增长期任务/ }).click();
      let form = goalForm();
      await checkSizes(page, form, 'input[type=date]', 2, true);
      assert.equal(await form.getByLabel('截止日期（可不填）', { exact: true }).inputValue(), '', 'optional empty dates stay supported');
      await cancel(form);
      await goalCard(goals[0]).getByRole('button', { name: '编辑', exact: true }).click();
      form = goalForm();
      await checkSizes(page, form, 'input[type=date]', 2, true);
      if (save) {
        await form.getByLabel('截止日期（可不填）', { exact: true }).fill(changedEnd);
        const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/period-tasks/${goals[0].id}`));
        await form.getByRole('button', { name: '确认保存', exact: true }).click();
        const saved = await response; assert.equal(saved.status(), 200, await saved.text()); assert.equal((await saved.json()).end_date, changedEnd);
        await form.waitFor({ state: 'detached' });
      } else await cancel(form);
      for (const goal of goals) {
        await goalCard(goal).getByRole('button', { name: '补记进度', exact: true }).click();
        form = page.locator('form').filter({ has: page.getByRole('heading', { name: `补记「${goal.title}」`, exact: true }) });
        await checkSizes(page, form, 'input', 2, true);
        if (save) {
          await form.getByLabel('日期', { exact: true }).fill(shiftDate(today, -1));
          const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith(`/period-tasks/${goal.id}/logs`));
          await form.getByRole('button', { name: '补记', exact: true }).click();
          const saved = await response; assert.equal(saved.status(), 201, await saved.text());
          assert.ok(periodsService.listGoals(child.id).find(row => row.id === goal.id).logs.some(log => log.date === shiftDate(today, -1)));
          await form.waitFor({ state: 'detached' });
        } else await cancel(form);
      }
      // The earlier holiday fix now uses the same opt-in style, so retain its layout checks.
      await page.getByRole('button', { name: /新增假期/ }).click();
      form = page.locator('form').filter({ has: page.getByPlaceholder('例如：寒假', { exact: true }) });
      await checkSizes(page, form, 'input[type=date]', 2, true); await cancel(form);

      await goto(`/parent/schedule?child=${child.id}`);
      await page.getByRole('button', { name: '➕ 新建课程表', exact: true }).click();
      form = page.locator('form').filter({ has: page.getByRole('heading', { name: '🏫 新建课程表', exact: true }) });
      await checkSizes(page, form, 'input[type=date]', 2, width >= 640); await cancel(form);
      const timetableCard = page.locator('div.p-4.rounded-2xl').filter({ has: page.getByText(timetable.name, { exact: true }) });
      await timetableCard.getByRole('button', { name: '✏️ 编辑', exact: true }).click();
      form = page.locator('form').filter({ has: page.getByRole('heading', { name: '🏫 编辑课程表', exact: true }) });
      await checkSizes(page, form, 'input[type=date]', 2, width >= 640);
      if (save) {
        await form.getByLabel('结束日期', { exact: true }).fill(changedEnd);
        const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/timetables/${timetable.id}`));
        await form.getByRole('button', { name: '保存课程表', exact: true }).click();
        const saved = await response; assert.equal(saved.status(), 200, await saved.text()); assert.equal((await saved.json()).end_date, changedEnd);
        await form.waitFor({ state: 'detached' });
      } else await cancel(form);

      await page.getByRole('button', { name: '➕ 新增课外班', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '新增课外班', exact: true });
      await checkSizes(page, dialog, 'input[type=date], input[type=time]', 3);
      await dialog.getByLabel('排课方式', { exact: true }).selectOption('date');
      await checkSizes(page, dialog, 'input[type=date], input[type=time]', 4); await cancel(dialog);
      await page.locator(`[data-class-id="${cls.id}"]`).getByRole('button', { name: '编辑', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '编辑课外班', exact: true });
      await checkSizes(page, dialog, 'input[type=date], input[type=time]', 4);
      if (save) {
        await dialog.getByLabel('到哪天结束', { exact: true }).fill(changedEnd);
        await dialog.getByLabel('开始时间', { exact: true }).fill('15:30');
        const response = page.waitForResponse(r => r.request().method() === 'PUT' && r.url().endsWith(`/outside-classes/${cls.id}`));
        await dialog.getByRole('button', { name: '保存', exact: true }).click();
        const saved = await response; assert.equal(saved.status(), 200, await saved.text());
        const result = await saved.json(); assert.deepEqual([result.start_time, result.end_date], ['15:30', changedEnd]);
        await dialog.waitFor({ state: 'detached' });
      } else await cancel(dialog);

      await goto(`/child/${child.id}/today`);
      await page.locator('button[title="今天的课"]').click();
      await page.getByRole('dialog', { name: '今天的课', exact: true }).locator(`[data-class-id="${daily.id}"][data-source-date="${today}"]`)
        .getByRole('button', { name: '调课', exact: true }).click();
      dialog = page.getByRole('dialog', { name: '调整这节课', exact: true });
      await checkSizes(page, dialog, 'input[type=date], input[type=time]', 3);
      assert.deepEqual(await dialog.locator('input').evaluateAll(fields => fields.map(field => getComputedStyle(field).borderTopWidth)), ['1px', '1px', '1px'], 'board move fields keep visible borders');
      await cancel(dialog);
      console.log(`PASS ${engine.name()} ${width}x${height}/${theme}: goal, both backfill modes, holiday, timetable, outside-class and board move fields fit their columns and padded containers${save ? '; real date/time saves passed' : ''}`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], 'no browser errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await c.app.close(); cleanupTestApp(c); c.db.close();
});
