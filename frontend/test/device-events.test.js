import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAgent, describeEvent, describeOrigin, isWarning } from '../src/utils/deviceEvents.js';

test('device history entries read as sentences with who acted and from where', () => {
  const request = { type: 'pair_requested', source: 'web', code: '384921', ip: '203.0.113.9 → 192.168.1.5',
    user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
  assert.equal(describeEvent(request), '新设备请求配对（配对码 384921）');
  assert.equal(describeOrigin(request), '来源 203.0.113.9 → 192.168.1.5 · iPhone Safari');
  assert.equal(describeOrigin({ type: 'approved', source: 'web', label: '平板', actor: '妈妈的 iPhone', ip: '1.2.3.4' }), '在「妈妈的 iPhone」上操作');
  assert.equal(describeOrigin({ type: 'approved', source: 'cli' }), '服务器命令');
  assert.equal(describeOrigin({ type: 'file_removed', source: 'file' }), '手动编辑授权文件');
  assert.equal(describeEvent({ type: 'revoked', label: '旧手机' }), '撤销了「旧手机」');
  assert.deepEqual([isWarning({ type: 'approve_failed' }), isWarning({ type: 'approved' })], [true, false]);
});

test('browsers are summarized and unknown agents shortened', () => {
  assert.equal(describeAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'), 'Android Chrome');
  assert.equal(describeAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0'), 'Windows Edge');
  assert.equal(describeAgent('curl/8.9.1'), 'curl/8.9.1');
  assert.equal(describeAgent('x'.repeat(60)), `${'x'.repeat(40)}…`);
  assert.equal(describeAgent(null), '');
});
