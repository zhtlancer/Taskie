const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Hold real responses after SQLite committed, so the UI must retain the original receipt key.
function installWordBookLinkRetryChecks(app) {
  let targetId = null;
  const outcomes = [],
    attempts = [];
  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'POST' || request.url !== `/api/word-books/${targetId}/items`) return payload;
    attempts.push(request.body);
    const outcome = outcomes.shift();
    if (!outcome) return payload;
    outcome.reached();
    await outcome.gate;
    if (outcome.status !== 200) {
      reply.code(outcome.status);
      return JSON.stringify({ error: `模拟关联响应 ${outcome.status}` });
    }
    return payload;
  });
  function held(status) {
    let release, reached;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      reached = resolve;
    });
    outcomes.push({ status, gate, reached });
    return { release, ready };
  }
  async function ready(promise) {
    let timer;
    try {
      await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Link request did not reach server')), 10000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  return async function check(page, childId, api) {
    for (const obsoleteStatus of [200, 400]) {
      const book = await api('POST', '/word-books', {
        child_id: childId,
        language: 'zh',
        name: `关联重试 ${obsoleteStatus}`,
        request_id: randomUUID(),
      });
      targetId = book.id;
      attempts.length = 0;
      const heldResponses = [];
      const panel = page.getByRole('region', { name: '词本与来源', exact: true });
      const manager = page.getByRole('dialog', { name: `管理词条 · ${book.name}`, exact: true });
      const join = manager.getByRole('button', { name: '加入「长」', exact: true });
      const removeLive = async () => {
        for (const item of (await api('GET', `/word-books/${book.id}/items`)).items) {
          await api('DELETE', `/word-books/${book.id}/items/${item.id}`, { expected_version: item.version });
        }
      };
      const open = async () => {
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('taskie:word-books-changed')));
        await panel.getByLabel('按词本筛选', { exact: true }).selectOption(book.id);
        await panel.getByRole('button', { name: '管理词条', exact: true }).click();
        await join.waitFor();
      };
      const response = () =>
        page.waitForResponse(
          (r) =>
            r.request().method() === 'POST' &&
            new URL(r.url()).pathname === `/api/word-books/${book.id}/items`,
        );
      try {
        await open();
        const old = held(obsoleteStatus);
        heldResponses.push(old);
        await join.click();
        await ready(old.ready);
        await removeLive();
        await page.evaluate(() => window.dispatchEvent(new Event('taskie:data-restored')));
        await manager.waitFor({ state: 'detached' });
        await open();
        const current = held(503);
        heldResponses.push(current);
        await join.click();
        await ready(current.ready);
        let finished = response();
        old.release();
        assert.equal((await finished).status(), obsoleteStatus);
        // Consume the obsolete callback before returning the new request's uncertain response.
        await page.waitForTimeout(100);
        assert.equal(await join.isDisabled(), true, 'obsolete callback cannot unlock a new operation');
        finished = response();
        current.release();
        assert.equal((await finished).status(), 503);
        await manager.getByRole('alert').filter({ hasText: '模拟关联响应 503' }).waitFor();
        await removeLive();
        finished = response();
        await join.click();
        assert.equal(
          (await finished).status(),
          409,
          'same receipt rejects revival of the removed association',
        );
        assert.equal(attempts.length, 3);
        assert.notEqual(attempts[0].request_id, attempts[1].request_id, 'restore starts a new operation');
        assert.deepEqual(
          attempts[2],
          attempts[1],
          'stale response and HTTP 503 must preserve the current request',
        );
        assert.equal((await api('GET', `/word-books/${book.id}/items`)).total, 0);
        // A definite conflict ends that attempt; an explicit new action can add the word again.
        finished = response();
        await join.click();
        assert.equal((await finished).status(), 200);
        assert.notEqual(attempts[3].request_id, attempts[2].request_id);
        await manager.getByRole('button', { name: '移出「长」', exact: true }).waitFor();
        await manager.getByRole('button', { name: '关闭', exact: true }).click();
        await panel.getByLabel('按词本筛选', { exact: true }).selectOption('all');
        console.log(
          `PASS obsolete ${obsoleteStatus}: new receipt survives restore, late response and committed HTTP 503; retry cannot revive a removed membership`,
        );
      } finally {
        for (const held of heldResponses) held.release();
        outcomes.length = 0;
        await api('DELETE', `/word-books/${book.id}`, { expected_version: book.version });
        targetId = null;
      }
    }
  };
}
module.exports = { installWordBookLinkRetryChecks };
