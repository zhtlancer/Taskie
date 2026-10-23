const { performance } = require('node:perf_hooks');

const DELETE_WAIT_MS = 10_000;
const busyError = () => Object.assign(new Error('正在备份或恢复，请稍后再试；本次删除未执行'), { statusCode: 503 });

// The response may time out before the backup finishes. Keep the lock's original
// promise in the queue, but turn cancelled entries into no-ops when their turn comes.
function queuedDeletion(backupService, request, reply, operation) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + DELETE_WAIT_MS;
    let cancelled = false, started = false, timer;
    const cleanup = () => {
      clearTimeout(timer);
      reply.raw.off('close', disconnected);
      request.raw.off('aborted', disconnected);
    };
    const cancel = error => {
      if (started || cancelled) return;
      cancelled = true;
      cleanup();
      reject(error);
    };
    const disconnected = () => cancel(Object.assign(new Error('请求已断开，本次删除未执行'), { statusCode: 503 }));
    reply.raw.once('close', disconnected);
    request.raw.once('aborted', disconnected);
    timer = setTimeout(() => cancel(busyError()), DELETE_WAIT_MS);
    if (request.raw.aborted || reply.raw.destroyed) { disconnected(); return; }

    const queued = backupService.exclusive(() => {
      if (cancelled) return;
      if (request.raw.aborted || reply.raw.destroyed) { disconnected(); return; }
      // Enforce the deadline even if a busy event loop runs this promise before its timer.
      if (performance.now() >= deadline) { cancel(busyError()); return; }
      started = true;
      cleanup();
      // Deletions and their authorization checks run synchronously while holding the lock.
      return operation();
    });
    queued.then(resolve, reject);
  });
}

module.exports = { queuedDeletion, DELETE_WAIT_MS };
