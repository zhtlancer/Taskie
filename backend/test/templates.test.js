const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');

describe('Task Templates API (/api/task-templates)', () => {
  let ctx;

  afterEach(() => {
    if (ctx) cleanupTestApp(ctx);
  });

  test('Create, list, update, and delete task templates', async () => {
    ctx = createTestApp();

    // 1. Create template
    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/task-templates',
      payload: {
        title: '数学口算',
        subject: '数学',
        days_of_week: [1, 2, 3, 4, 5],
        points: 15
      }
    });
    assert.equal(createRes.statusCode, 201);
    const tmpl = JSON.parse(createRes.body);
    assert.equal(tmpl.title, '数学口算');
    assert.equal(tmpl.subject, '数学');
    assert.deepEqual(tmpl.days_of_week, [1, 2, 3, 4, 5]);
    assert.equal(tmpl.points, 15);
    assert.ok(tmpl.id);

    // 2. List templates
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/task-templates'
    });
    assert.equal(listRes.statusCode, 200);
    const list = JSON.parse(listRes.body);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, tmpl.id);

    // 3. Update template
    const updateRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/task-templates/${tmpl.id}`,
      payload: {
        title: '数学口算打卡',
        points: 20,
        days_of_week: [0, 1, 2, 3, 4, 5, 6]
      }
    });
    assert.equal(updateRes.statusCode, 200);
    const updated = JSON.parse(updateRes.body);
    assert.equal(updated.title, '数学口算打卡');
    assert.equal(updated.points, 20);
    assert.deepEqual(updated.days_of_week, [0, 1, 2, 3, 4, 5, 6]);

    // 4. Delete template
    const deleteRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/task-templates/${tmpl.id}`
    });
    assert.equal(deleteRes.statusCode, 200);

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/task-templates/${tmpl.id}`
    });
    assert.equal(getRes.statusCode, 404);
  });

  test('Templates can be limited to specific children', async () => {
    ctx = createTestApp();
    const createChild = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
    const a = await createChild('孩子A'), b = await createChild('孩子B');
    const create = payload => ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: { subject: '语文', days_of_week: [0, 1, 2, 3, 4, 5, 6], ...payload } });
    const titles = async childId => (await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks?child_id=${childId}` })).json().map(t => t.title).sort();

    const shared = (await create({ title: '全家任务' })).json();
    assert.equal(shared.child_ids, null);
    const onlyA = (await create({ title: 'A的任务', child_ids: [a.id, a.id] })).json();
    assert.deepEqual(onlyA.child_ids, [a.id]);
    assert.deepEqual((await ctx.app.inject({ method: 'GET', url: '/api/task-templates' })).json().map(t => t.child_ids), [null, [a.id]]);

    for (const child_ids of [[], 'all', ['missing-child'], [1]]) {
      assert.equal((await create({ title: '无效分配', child_ids })).statusCode, 400, JSON.stringify(child_ids));
    }
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM task_templates').get().n, 2);

    assert.deepEqual(await titles(a.id), ['A的任务', '全家任务']);
    assert.deepEqual(await titles(b.id), ['全家任务']);

    // Updating other fields keeps the assignment; null opens it to every child.
    assert.deepEqual((await ctx.app.inject({ method: 'PUT', url: `/api/task-templates/${onlyA.id}`, payload: { points: 20 } })).json().child_ids, [a.id]);
    assert.deepEqual((await ctx.app.inject({ method: 'PUT', url: `/api/task-templates/${onlyA.id}`, payload: { child_ids: [b.id] } })).json().child_ids, [b.id]);
    assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/task-templates/${onlyA.id}`, payload: { child_ids: [] } })).statusCode, 400);
    assert.deepEqual(ctx.app.services.tasksService.getTemplate(onlyA.id).child_ids, [b.id]);

    // Deleting the only assigned child leaves the template unassigned instead of applying it to everyone.
    await ctx.app.inject({ method: 'DELETE', url: `/api/children/${b.id}` });
    assert.deepEqual(ctx.app.services.tasksService.getTemplate(onlyA.id).child_ids, []);
    const c = await createChild('孩子C');
    assert.deepEqual(await titles(c.id), ['全家任务']);

    assert.equal((await ctx.app.inject({ method: 'PUT', url: `/api/task-templates/${onlyA.id}`, payload: { child_ids: null } })).json().child_ids, null);
    assert.deepEqual(await titles(c.id), ['A的任务', '全家任务']);
  });
  test('Assignment edits immediately revoke pending today tasks and fill newly assigned children', async () => {
    ctx = createTestApp();
    const child = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
    const a = await child('A'), b = await child('B');
    const daily = async id => (await ctx.app.inject({ method: 'GET', url: `/api/daily-tasks?child_id=${id}` })).json();
    const edit = (id, child_ids) => ctx.app.inject({ method: 'PUT', url: `/api/task-templates/${id}`, payload: { child_ids } });
    for (const schedule_type of ['fixed_days', 'weekly_times']) {
      const template = (await ctx.app.inject({ method: 'POST', url: '/api/task-templates', payload: {
        title: schedule_type, subject: '数学', schedule_type, weekly_target_times: 2, points: 10
      } })).json();
      const oldA = (await daily(a.id)).find(t => t.template_id === template.id);
      const oldB = (await daily(b.id)).find(t => t.template_id === template.id);
      // Failed changes must roll back both assignments and pending tasks.
      assert.equal((await edit(template.id, [a.id, 'missing'])).statusCode, 400);
      assert.ok(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(oldB.id));
      assert.equal((await edit(template.id, [a.id])).statusCode, 200);
      assert.equal(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(oldB.id), undefined);
      assert.equal((await edit(template.id, [b.id])).statusCode, 200);
      assert.equal(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(oldA.id), undefined);
      const token = ctx.app.jwt.sign({ role: 'child', child_id: a.id, epoch: ctx.app.sessionEpoch() });
      assert.equal((await ctx.rawInject({ method: 'POST', url: `/api/daily-tasks/${oldA.id}/complete`, headers: { authorization: `Bearer ${token}` } })).statusCode, 404);
      assert.equal(ctx.app.services.rewardsService.getTotalPoints(a.id), 0);
      assert.equal((await daily(a.id)).some(t => t.template_id === template.id), false);
      assert.equal((await daily(b.id)).filter(t => t.template_id === template.id).length, 1);
      assert.equal((await daily(b.id)).filter(t => t.template_id === template.id).length, 1);
      await edit(template.id, null);
      assert.equal((await daily(a.id)).filter(t => t.template_id === template.id).length, 1);
    }
  });

  test('Reassignment preserves completed tasks, earned points and history; undo cannot revive revoked tasks', async () => {
    ctx = createTestApp();
    const child = async name => (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name } })).json();
    const a = await child('A'), b = await child('B'), service = ctx.app.services.tasksService;
    const template = service.createTemplate({ title: '阅读', subject: '语文', child_ids: [a.id], points: 10 });
    const yesterday = shiftDate(getTodayDate(), -1);
    const historical = service.getDailyTasks(a.id, yesterday)[0];
    const current = service.getDailyTasks(a.id)[0];
    service.completeDailyTask(current.id);
    service.updateTemplate(template.id, { child_ids: [b.id] });
    assert.equal(service.getDailyTasks(a.id)[0].is_completed, true);
    assert.equal(service.getDailyTasks(a.id, yesterday)[0].id, historical.id);
    assert.equal(ctx.app.services.rewardsService.getTotalPoints(a.id), 10);
    // The parent can still backfill historical tasks after reassignment.
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${historical.id}/complete` })).statusCode, 200);
    assert.equal(ctx.app.services.rewardsService.getTotalPoints(a.id), 20);
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${current.id}/uncomplete` })).statusCode, 200);
    assert.deepEqual(service.getDailyTasks(a.id), []);
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${current.id}/complete` })).statusCode, 404);
    assert.equal(ctx.app.services.rewardsService.getTotalPoints(a.id), 10);
    assert.equal(service.getDailyTasks(a.id, yesterday)[0].is_completed, true);
  });

  test('Previously generated future tasks are checked against assignment when their date becomes today', async () => {
    ctx = createTestApp();
    const a = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: 'A' } })).json();
    const b = (await ctx.app.inject({ method: 'POST', url: '/api/children', payload: { name: 'B' } })).json();
    const service = ctx.app.services.tasksService;
    const template = service.createTemplate({ title: '阅读', subject: '语文', child_ids: [a.id] });
    const task = service.getDailyTasks(a.id, shiftDate(getTodayDate(), 1))[0];
    service.updateTemplate(template.id, { child_ids: [b.id] });
    // Simulate this pre-generated task reaching today's date, without a list refresh.
    ctx.db.prepare('UPDATE daily_tasks SET date = ? WHERE id = ?').run(getTodayDate(), task.id);
    assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/daily-tasks/${task.id}/complete` })).statusCode, 409);
    assert.equal(ctx.app.services.rewardsService.getTotalPoints(a.id), 0);
    assert.deepEqual(service.getDailyTasks(a.id), []);
    assert.equal(ctx.db.prepare('SELECT id FROM daily_tasks WHERE id = ?').get(task.id), undefined);
  });
});
