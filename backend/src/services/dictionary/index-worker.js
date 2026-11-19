const { parentPort, workerData } = require('node:worker_threads');
const { buildIndex } = require('./index-builder');

try {
  parentPort.postMessage({ type: 'progress', progress: { phase: 'starting', processed: 0 } });
  const sources = buildIndex(workerData, progress => parentPort.postMessage({ type: 'progress', progress }));
  parentPort.postMessage({ type: 'complete', sources });
} catch (error) {
  parentPort.postMessage({ type: 'failed', error: { message: error.message, code: error.code } });
}
