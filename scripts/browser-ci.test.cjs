const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { errorAnnotation, reportBrowserFailure } = require('./browser-diagnostics.cjs');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-ci-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runFixture(t, source, suite = 'fixture', extraEnv = {}) {
  const dir = directory(t);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: {
    'test:browser:fixture': 'node scripts/fixture.cjs', 'test:browser': 'node scripts/fixture.cjs'
  } }));
  fs.writeFileSync(path.join(dir, 'scripts/fixture.cjs'), source);
  // Run the real CLI entry point, including its startup-error path, in an isolated project.
  for (const name of ['run-browser-suite.cjs', 'browser-diagnostics.cjs']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(dir, 'scripts', name));
  }
  const fixtureEnv = typeof extraEnv === 'function' ? extraEnv(dir) : extraEnv;
  const result = spawnSync(process.execPath, [path.join(dir, 'scripts/run-browser-suite.cjs'), suite], {
    cwd: dir,
    env: { ...process.env, GITHUB_ACTIONS: 'true', BROWSER_DIAGNOSTICS_DIR: 'test-results/fixture', ...fixtureEnv },
    encoding: 'utf8', timeout: 15000
  });
  assert.ifError(result.error);
  return { dir, ...result };
}

test('browser runner streams and retains both outputs without annotating a passing suite', t => {
  const result = runFixture(t, "console.log('passed'); console.error('diagnostic');");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /passed/);
  assert.match(result.stderr, /diagnostic/);
  const log = fs.readFileSync(path.join(result.dir, 'test-results/fixture/output.log'), 'utf8');
  assert.match(log, /passed/);
  assert.match(log, /diagnostic/);
  assert.doesNotMatch(result.stdout, /::error/);
});

test('browser runner preserves a failing exit code and publishes its cause and artifacts', t => {
  const result = runFixture(t, "console.error('FAIL expected 42, got 0'); process.exitCode = 7;");
  assert.equal(result.status, 7);
  assert.match(result.stdout, /::error title=Browser suite failed%3A fixture::FAIL expected 42, got 0/);
  const files = fs.readdirSync(path.join(result.dir, 'test-results/fixture'));
  assert.ok(files.includes('output.log'));
  const report = files.find(name => name.endsWith('.txt'));
  assert.match(fs.readFileSync(path.join(result.dir, 'test-results/fixture', report), 'utf8'), /FAIL expected 42, got 0/);
});

test('browser runner refuses unknown names instead of executing input as a shell command', t => {
  const result = runFixture(t, "require('node:fs').writeFileSync('unexpected', 'ran');", 'fixture;echo injected');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Specify a browser suite name/);
  assert.equal(fs.existsSync(path.join(result.dir, 'unexpected')), false);
});

test('CLI reports a well-formed but unknown suite without running a child', t => {
  const result = runFixture(t, "throw new Error('must not run');", 'missing-suite');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error title=Browser suite could not start::/);
  assert.match(result.stderr, /Unknown or unsupported browser suite: missing-suite/);
  const files = fs.readdirSync(path.join(result.dir, 'test-results/fixture'));
  assert.ok(files.some(file => file.endsWith('.txt')));
});

test('split UTF-8 stdout and stderr remain readable in the log and failure report', t => {
  const result = runFixture(t, `
    const bytes = Buffer.from('中文断言');
    process.stdout.write(bytes.subarray(0, 1)); process.stderr.write(bytes.subarray(0, 2));
    setTimeout(() => { process.stdout.write(bytes.subarray(1)); process.stderr.write(bytes.subarray(2)); process.exitCode = 3; }, 50);
  `);
  assert.equal(result.status, 3);
  assert.match(result.stdout, /中文断言/);
  assert.match(result.stderr, /中文断言/);
  assert.doesNotMatch(result.stdout + result.stderr, /�/);
  const dir = path.join(result.dir, 'test-results/fixture');
  const report = fs.readdirSync(dir).find(file => file.endsWith('.txt'));
  assert.match(fs.readFileSync(path.join(dir, report), 'utf8'), /中文断言/);
});

test('a signal exit is a failure and its signal reaches the annotation and log', { skip: process.platform === 'win32' }, t => {
  const result = runFixture(t, "console.log('before signal'); process.kill(process.pid, 'SIGTERM');");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Terminated by SIGTERM/);
  assert.match(fs.readFileSync(path.join(result.dir, 'test-results/fixture/output.log'), 'utf8'), /terminated by SIGTERM/);
});

test('timeout stays failed even if a suite handles SIGTERM by exiting successfully', { skip: process.platform === 'win32' }, t => {
  const result = runFixture(t, `
    process.on('SIGTERM', () => { console.log('cleanup completed'); process.exit(0); });
    console.log('fixture ready'); setInterval(() => {}, 1000);
  `, 'fixture', { BROWSER_SUITE_TIMEOUT_MS: '2000' });
  assert.equal(result.status, 124);
  assert.match(result.stdout, /fixture ready/);
  assert.match(result.stdout, /cleanup completed/);
  assert.match(result.stdout, /Browser suite timed out after 2000 ms/);
});

test('timeout force-stops a suite that ignores SIGTERM and retains diagnostics', { skip: process.platform === 'win32' }, t => {
  const result = runFixture(t, "process.on('SIGTERM', () => {}); console.log('fixture ready'); setInterval(() => {}, 1000);",
    'fixture', { BROWSER_SUITE_TIMEOUT_MS: '2000' });
  assert.equal(result.status, 124);
  assert.match(result.stdout, /Terminated by SIGKILL/);
  assert.match(result.stdout, /timed out after 2000 ms/);
});

test('runner cancellation is forwarded to the suite and returns a cancellation exit code', { skip: process.platform === 'win32' }, t => {
  const result = runFixture(t, "setInterval(() => {}, 1000); process.kill(process.ppid, 'SIGTERM');");
  assert.equal(result.status, 143);
  assert.match(result.stdout, /Browser runner received SIGTERM/);
});

test('timeout also kills an ignoring descendant after its parent exits', { skip: process.platform !== 'linux' }, t => {
  const result = runFixture(t, `
    const fs = require('node:fs');
    const child = require('node:child_process').spawn(process.execPath, ['-e',
      "process.title='taskie-timeout-fixture'; process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: 'ignore' });
    fs.writeFileSync('descendant.pid', String(child.pid));
    process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);
  `, 'fixture', { BROWSER_SUITE_TIMEOUT_MS: '2000' });
  const pid = Number(fs.readFileSync(path.join(result.dir, 'descendant.pid'), 'utf8'));
  const running = () => {
    try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  };
  t.after(() => {
    try { if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('taskie-timeout-fixture')) process.kill(pid, 'SIGKILL'); }
    catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error; }
  });
  assert.equal(result.status, 124);
  assert.equal(running(), false, 'a timeout must not leave the descendant running');
});

test('invalid timeout configuration fails before executing the suite', t => {
  const result = runFixture(t, "throw new Error('must not run');", 'fixture', { BROWSER_SUITE_TIMEOUT_MS: 'invalid' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /BROWSER_SUITE_TIMEOUT_MS must be/);
  assert.doesNotMatch(result.stderr, /must not run/);
});

const smokeFailures = {
  timeout: { action: 'setInterval(() => {}, 1000);', code: 124 },
  signal: { action: "process.kill(process.pid, 'SIGTERM');", code: 1 },
  exit: { action: 'process.exitCode = 7;', code: 7 }
};
for (const [failure, scenario] of Object.entries(smokeFailures)) test(`a smoke ${failure} collects logs and removes only its own UUID-named container`, { skip: process.platform === 'win32' }, t => {
  const result = runFixture(t, `console.log(process.env.TASKIE_SMOKE_CONTAINER);
    ${scenario.action}`, 'smoke', dir => {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env node
      const fs = require('node:fs');
      fs.appendFileSync(process.env.FIXTURE_DOCKER_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
      console.log(process.argv[2] === 'logs' ? 'fixture container logs' : process.argv.at(-1));
    `, { mode: 0o755 });
    return { BROWSER_SUITE_TIMEOUT_MS: '2000', PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      FIXTURE_DOCKER_CALLS: path.join(dir, 'docker-calls.jsonl') };
  });
  assert.equal(result.status, scenario.code);
  const name = result.stdout.split('\n')[0];
  assert.match(name, /^taskie-ui-check-[0-9a-f-]{36}$/);
  const calls = fs.readFileSync(path.join(result.dir, 'docker-calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls, [['logs', '--tail', '30', name], ['rm', '-f', name]]);
  assert.match(fs.readFileSync(path.join(result.dir, 'test-results/fixture/output.log'), 'utf8'), /fixture container logs/);
});

test('GitHub annotation escapes command delimiters and bounds large assertion output', () => {
  const annotation = errorAnnotation('case,with:delimiter\nnext', 'a%\r\n::warning::injected');
  assert.equal(annotation, '::error title=case%2Cwith%3Adelimiter%0Anext::a%25%0D%0A::warning::injected\n');
  assert.equal(annotation.split('\n').length, 2);
  const large = errorAnnotation('large', `original cause${'x'.repeat(10000)}runtime context`);
  assert.ok(large.length < 6100);
  assert.match(large, /::original cause/);
  assert.match(large, /runtime context\n$/);
});

test('failure diagnostics capture open pages before teardown and tolerate unavailable screenshots', async t => {
  const dir = directory(t);
  let captured = false;
  const context = { pages: () => [
    { isClosed: () => false, screenshot: async ({ path: file }) => { captured = true; fs.writeFileSync(file, 'test image'); } },
    { isClosed: () => false, screenshot: async () => { throw new Error('page became unavailable'); } },
    { isClosed: () => true, screenshot: async () => { assert.fail('closed pages must be ignored'); } }
  ] };
  await reportBrowserFailure('../failing case', new Error('expected one record, got two'), context, { directory: dir, github: false });
  assert.ok(captured);
  const files = fs.readdirSync(dir);
  assert.equal(files.filter(file => file.endsWith('.png')).length, 1);
  const report = fs.readFileSync(path.join(dir, files.find(file => file.endsWith('.txt'))), 'utf8');
  assert.match(report, /expected one record, got two/);
  assert.match(report, /Screenshot unavailable: page became unavailable/);
});
