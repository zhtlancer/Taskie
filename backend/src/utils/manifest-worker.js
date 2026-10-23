const { parentPort, workerData } = require('node:worker_threads');
const { readManifest } = require('./backup-manifest');
try { parentPort.postMessage({ result: readManifest(workerData.file, workerData.maxSize) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }
