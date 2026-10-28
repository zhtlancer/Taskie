// Run the existing npm browser command with streamed logs and a failure annotation in CI.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { reportBrowserFailure } = require('./browser-diagnostics.cjs');

async function runBrowserSuite(suite, { root = path.resolve(__dirname, '..'), env = process.env } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(suite || '')) throw new Error('Specify a browser suite name, or smoke');
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  const command = scripts[suite === 'smoke' ? 'test:browser' : `test:browser:${suite}`];
  if (!command || !/^node scripts\/[a-z0-9-]+\.cjs(?: [a-zA-Z0-9_+/-]+)*$/.test(command)) {
    throw new Error(`Unknown or unsupported browser suite: ${suite}`);
  }
  const timeoutMs = Number(env.BROWSER_SUITE_TIMEOUT_MS || 300000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    throw new Error('BROWSER_SUITE_TIMEOUT_MS must be a positive integer no greater than 2147483647');
  }
  const dir = path.resolve(root, env.BROWSER_DIAGNOSTICS_DIR || `test-results/${suite}`);
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, 'output.log');
  fs.writeFileSync(log, '');
  let tail = '';
  const record = (destination, data) => {
    destination.write(data);
    fs.appendFileSync(log, data);
    tail = (tail + data).slice(-24000);
  };
  // A process group lets timeout/cancellation stop descendants as well as the suite itself.
  // This stays attached to the runner: no unref, and close is always awaited below.
  const grouped = process.platform !== 'win32';
  const container = suite === 'smoke' ? `taskie-ui-check-${randomUUID()}` : undefined;
  const child = spawn(process.execPath, command.split(' ').slice(1), {
    cwd: root, detached: grouped,
    env: { ...env, BROWSER_DIAGNOSTICS_DIR: dir, ...(container ? { TASKIE_SMOKE_CONTAINER: container } : {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  // Decode across chunk boundaries so Chinese assertions survive split UTF-8 writes.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => record(process.stdout, data));
  child.stderr.on('data', data => record(process.stderr, data));
  let spawnError;
  child.on('error', error => { spawnError = error; });
  let stopReason, stoppedCode, forceTimer;
  function signalChild(signal) {
    if (!child.pid) return;
    try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
    catch (error) { if (error.code !== 'ESRCH') record(process.stderr, `Could not send ${signal}: ${error.message}\n`); }
  }
  function stop(reason, code) {
    if (stopReason) return;
    stopReason = reason; stoppedCode = code;
    record(process.stderr, `${reason}\n`);
    signalChild('SIGTERM');
    forceTimer = setTimeout(() => signalChild('SIGKILL'), 5000);
  }
  const onInterrupt = () => stop('Browser runner received SIGINT', 130);
  const onTerminate = () => stop('Browser runner received SIGTERM', 143);
  // An externally killed suite cannot run its own cleanup, either. Do not wait for descendants'
  // inherited pipes to close before terminating the rest of its group and cleaning its container.
  child.once('exit', (code, signal) => { if (signal) stop(`Browser suite terminated by ${signal}`, 1); });
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const timer = setTimeout(() => stop(`Browser suite timed out after ${timeoutMs} ms`, 124), timeoutMs);
  let result;
  try {
    result = await new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  } finally {
    clearTimeout(timer); clearTimeout(forceTimer);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
    // The direct child may exit while an uncooperative descendant still lives in its group.
    if (stopReason) signalChild('SIGKILL');
  }
  if (result.signal) record(process.stderr, `Browser suite terminated by ${result.signal}\n`);
  const code = stoppedCode ?? result.code ?? 1;
  if (code !== 0 && container) {
    // Signals and ordinary failures can both bypass or interrupt the suite's cleanup.
    // Retry cleanup only for this run's UUID name, retaining the original exit code.
    for (const args of [['logs', '--tail', '30', container], ['rm', '-f', container]]) {
      try { record(process.stderr, execFileSync('docker', args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })); }
      catch (error) { record(process.stderr, `Container ${args[0]}: ${error.message}\n`); }
    }
  }
  // Start at the failure instead of filling the annotation with earlier passing cases.
  const failure = tail.search(/^.*(?:\bFAIL\b|\bError:|\bAssertionError\b|\bnot ok\b)/m);
  const cause = failure >= 0 ? tail.slice(failure) : tail;
  const reason = [stopReason, result.signal && `Terminated by ${result.signal}`, spawnError?.message, cause].filter(Boolean).join('\n');
  if (code !== 0) await reportBrowserFailure(`Browser suite failed: ${suite}`, reason || `Exited with code ${code}`, undefined, {
    directory: dir, github: env.GITHUB_ACTIONS === 'true'
  });
  return code;
}

if (require.main === module) runBrowserSuite(process.argv[2]).then(code => { process.exitCode = code; })
  .catch(async error => { console.error(error); await reportBrowserFailure('Browser suite could not start', error); process.exitCode = 1; });

module.exports = { runBrowserSuite };
