const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync, gunzipSync } = require('node:zlib');
const Database = require('better-sqlite3');
const { createTestApp, cleanupTestApp } = require('./helper');
const { getTodayDate, shiftDate } = require('../src/utils/date');
const { SCHEMA_VERSION } = require('../src/db');
async function fixture(t) {
  const ctx = createTestApp(); t.after(() => cleanupTestApp(ctx)); await ctx.app.ready();
  const child = ctx.app.services.childrenService.createChild({ name: '退款草稿验证' });
  const task = ctx.app.services.tasksService.createAdhocTask(child.id, { title: '获得积分', subject: '数学', points: 100 });
  ctx.app.services.tasksService.completeDailyTask(task.id);
  const item = ctx.app.services.redemptionsService.createItem({ title: '周末活动', cost: 40 });
  const redemption = ctx.app.services.redemptionsService.requestRedemption(child.id, item.id);
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: child.id, epoch: ctx.app.sessionEpoch() })}` };
  const refund = (reason = '活动取消', extra = {}) => ctx.app.inject({ method: 'POST', url: `/api/redemptions/${redemption.id}/refund`, payload: { reason }, ...extra });
  return { ctx, child, item, redemption, headers, refund };
}
test('parent refund preserves approval and original price, returns points once and appears in child history', async t => {
  const { ctx, child, item, redemption, headers, refund } = await fixture(t);
  const service = ctx.app.services.redemptionsService, rewards = ctx.app.services.rewardsService;
  const approved = service.resolveRedemption(redemption.id, 'approved');
  service.updateItem(item.id, { cost: 99 }); service.deleteItem(item.id);
  assert.equal(rewards.getAvailablePoints(child.id), 60);
  assert.equal((await refund('活动取消', { headers })).statusCode, 403);
  for (const reason of ['', '   ', '字'.repeat(201), 1]) assert.equal((await refund(reason)).statusCode, 400);
  const [a, b] = await Promise.all([refund(), refund()]);
  assert.equal(a.statusCode, 200, a.body); assert.equal(b.statusCode, 200, b.body);
  assert.equal(a.json().status, 'refunded'); assert.equal(a.json().cost, 40);
  assert.equal(a.json().resolved_at, approved.resolved_at); assert.ok(a.json().refunded_at);
  assert.equal(a.json().refund_reason, '活动取消'); assert.deepEqual(a.json(), b.json());
  assert.deepEqual([rewards.getTotalPoints(child.id), rewards.getAvailablePoints(child.id)], [100, 100]);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM point_logs WHERE child_id = ?').get(child.id).n, 1);
  assert.equal((await refund('另一设备不同原因')).statusCode, 409);
  for (const action of ['approve', 'reject', 'cancel']) assert.equal((await ctx.app.inject({ method: 'POST', url: `/api/redemptions/${redemption.id}/${action}` })).statusCode, 409);
  const history = await ctx.rawInject({ method: 'GET', url: `/api/children/${child.id}/redemptions?status=refunded`, headers });
  assert.equal(history.statusCode, 200); assert.equal(history.json()[0].refund_reason, '活动取消');
  assert.equal(history.json()[0].cost, 40);
});
test('refund rejects unapproved records, cross-child access and stale restore generation', async t => {
  const { ctx, child, redemption, refund } = await fixture(t);
  assert.equal((await refund()).statusCode, 409);
  ctx.app.services.redemptionsService.resolveRedemption(redemption.id, 'approved');
  const other = ctx.app.services.childrenService.createChild({ name: '其他孩子' });
  const headers = { authorization: `Bearer ${ctx.app.jwt.sign({ role: 'child', child_id: other.id, epoch: ctx.app.sessionEpoch() })}` };
  assert.equal((await refund('越权', { headers })).statusCode, 403);
  const stale = await refund('旧窗口', { headers: { 'x-taskie-data-generation': 'old-data' } });
  assert.equal(stale.statusCode, 409); assert.equal(stale.json().code, 'DATA_RESTORED');
  assert.equal(ctx.app.services.rewardsService.getAvailablePoints(child.id), 60);
  assert.equal(ctx.app.services.redemptionsService.getRedemption(redemption.id).status, 'approved');
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/api/redemptions/missing/refund', payload: { reason: '不存在' } })).statusCode, 404);
});
test('v32 backups upgrade; current refunds and creation receipts restore; incomplete v33 backups are refused', async t => {
  const { ctx, child, redemption, refund } = await fixture(t);
  ctx.app.services.redemptionsService.resolveRedemption(redemption.id, 'approved');
  const archive = async () => fs.readFileSync(ctx.app.backupService.getPath((await ctx.app.backupService.create()).name));
  const old = await archive();
  const rewrite = (buffer, mutate) => {
    const data = JSON.parse(gunzipSync(buffer));
    const db = new Database(Buffer.from(data.database, 'base64')); mutate(db);
    data.database = db.serialize().toString('base64'); db.close(); return gzipSync(JSON.stringify(data));
  };
  const legacy = rewrite(old, db => { db.exec('ALTER TABLE reward_redemptions DROP COLUMN refund_reason; ALTER TABLE reward_redemptions DROP COLUMN refunded_at; DROP TABLE form_submission_receipts'); db.pragma('user_version = 32'); });
  await ctx.app.backupService.restore(legacy);
  assert.equal(ctx.db.pragma('user_version', { simple: true }), SCHEMA_VERSION);
  assert.equal(ctx.app.services.redemptionsService.getRedemption(redemption.id).refund_reason, null);
  await refund();
  const body = { subject: '数学', title: '草稿创建', request_id: 'restored_form_receipt' };
  const created = await ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/adhoc-tasks`, payload: body });
  assert.equal(created.statusCode, 201, created.body);
  const current = await archive();
  ctx.db.prepare('DELETE FROM form_submission_receipts').run();
  ctx.db.prepare("UPDATE reward_redemptions SET status = 'approved', refunded_at = NULL, refund_reason = NULL").run();
  await ctx.app.backupService.restore(current);
  assert.equal(ctx.app.services.rewardsService.getAvailablePoints(child.id), 100);
  assert.equal(ctx.app.services.redemptionsService.getRedemption(redemption.id).refund_reason, '活动取消');
  const replay = await ctx.app.inject({ method: 'POST', url: `/api/children/${child.id}/adhoc-tasks`, payload: body });
  assert.equal(replay.statusCode, 201); assert.equal(replay.json().id, created.json().id);
  for (const sql of ['ALTER TABLE reward_redemptions DROP COLUMN refund_reason', 'ALTER TABLE reward_redemptions DROP COLUMN refunded_at', 'DROP TABLE form_submission_receipts', 'ALTER TABLE form_submission_receipts DROP COLUMN fingerprint']) {
    await assert.rejects(() => ctx.app.backupService.restore(rewrite(current, db => db.exec(sql))), /备份缺少兑换撤销记录或表单提交凭据/);
    assert.equal(ctx.app.services.rewardsService.getAvailablePoints(child.id), 100);
  }
});
for (const kind of ['adhoc', 'homework', 'mistake']) test(`${kind}: uncertain creation retries the original receipt and never recreates a deleted record`, async t => {
  const { ctx, child, headers } = await fixture(t);
  const url = kind === 'adhoc' ? `/api/children/${child.id}/adhoc-tasks` : kind === 'homework' ? `/api/children/${child.id}/homework` : '/api/mistakes';
  const body = { subject: '数学', request_id: `draft_receipt_${kind}`, ...(kind === 'adhoc' ? { title: '同一任务' } : kind === 'homework' ? { content: '同一作业', due_date: shiftDate(getTodayDate(), 1), create_task: true } : { child_id: child.id, description: '同一错题' }) };
  const post = payload => ctx.app.inject({ method: 'POST', url, payload });
  const a = await post(body), b = await post(body);
  assert.equal(a.statusCode, 201, a.body); assert.equal(b.statusCode, 201, b.body); assert.equal(a.json().id, b.json().id);
  const changed = await post({ ...body, [kind === 'adhoc' ? 'title' : kind === 'homework' ? 'content' : 'description']: '改变了内容' });
  assert.equal(changed.statusCode, 409); assert.equal(changed.json().code, 'FORM_SUBMISSION_CONFLICT');
  if (kind !== 'adhoc') assert.equal((await ctx.rawInject({ method: 'POST', url, payload: body, headers })).statusCode, 409);
  const path = kind === 'adhoc' ? `/api/adhoc-tasks/${a.json().id}` : kind === 'homework' ? `/api/homework/${a.json().id}` : `/api/mistakes/${a.json().id}`;
  assert.equal((await ctx.app.inject({ method: 'DELETE', url: path })).statusCode, 200);
  const replay = await post(body);
  assert.equal(replay.statusCode, 409); assert.equal(replay.json().code, 'FORM_SUBMISSION_GONE');
});
test('homework draft versions reject concurrent content changes without modifying the newer record', async t => {
  const { ctx, child } = await fixture(t);
  const record = ctx.app.services.homeworkService.create(child.id, { subject: '数学', content: '初始内容', due_date: getTodayDate() }, 'parent');
  const update = content => ctx.app.inject({ method: 'PUT', url: `/api/homework/${record.id}`, payload: { content, expected_version: record.edit_version } });
  assert.equal((await update('其他设备新内容')).statusCode, 200);
  const stale = await update('恢复的旧草稿'); assert.equal(stale.statusCode, 409); assert.equal(stale.json().code, 'EDIT_CONFLICT');
  assert.equal(ctx.app.services.homeworkService.get(record.id).content, '其他设备新内容');
});
test('photo submission retries keep one image and clean duplicate or changed uploads', async t => {
  const { ctx, child } = await fixture(t);
  const boundary = '----taskie-photo-retry';
  const body = image => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="child_id"\r\n\r\n${child.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="subject"\r\n\r\n数学\r\n--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n照片重试\r\n--${boundary}\r\nContent-Disposition: form-data; name="request_id"\r\n\r\nphoto_retry_receipt\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\nContent-Type: image/png\r\n`),
    Buffer.from('\r\n'), Buffer.from(image), Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  const post = image => ctx.app.inject({ method:'POST', url:'/api/mistakes', headers:{'content-type':`multipart/form-data; boundary=${boundary}`}, payload:body(image) });
  const first = await post('test-image-bytes'), replay = await post('test-image-bytes');
  assert.equal(first.statusCode,201,first.body);assert.equal(replay.statusCode,201,replay.body);assert.equal(first.json().id,replay.json().id);
  assert.equal(fs.readdirSync(ctx.tempUploadDir).length,1);
  assert.equal((await post('different-image-bytes')).statusCode,409);
  // Error responses may be observable before the route's async finally finishes unlinking.
  for (let i = 0; i < 100 && fs.readdirSync(ctx.tempUploadDir).length > 1; i++) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.deepEqual(fs.readdirSync(ctx.tempUploadDir), [first.json().photo_path.split('/').pop()]);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM mistake_records WHERE child_id = ?').get(child.id).n,1);
});
