import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmation, confirmAction, promptAction, settleConfirmation, cancelConfirmations } from '../src/utils/confirmation.js';

test('queued confirmations keep their own answers and cancellation leaves no pending action', async () => {
  const first = confirmAction('删除第一个？');
  const second = promptAction('跳过原因', '请假');
  assert.equal(confirmation.value.message, '删除第一个？');
  settleConfirmation(true);
  assert.equal(await first, true);
  assert.equal(confirmation.value.initial, '请假');
  settleConfirmation('今天请假');
  assert.equal(await second, '今天请假');
  assert.equal(confirmation.value, null);

  const pendingDelete = confirmAction('仍要删除？');
  const pendingReason = promptAction('原因');
  cancelConfirmations();
  assert.deepEqual(await Promise.all([pendingDelete, pendingReason]), [false, null]);
  assert.equal(confirmation.value, null);
  const next = confirmAction('新页面的操作');
  settleConfirmation(null);
  assert.equal(await next, false);
});
