// NAS-style data directory checks against a real container and a bind-mounted host directory (not
// tmpfs). Build the image first (default tag taskie:reliability; TASKIE_TEST_IMAGE for another):
//   docker build -t taskie:reliability . && node scripts/smoke-docker-data.cjs
// Covers: an existing directory owned by another user is taken over for PUID; records and photos
// survive replacing the container; a read-only or unwritable directory stops the start with a clear
// message; and a data directory already upgraded by a newer version is refused (a safe rollback).
// A failing step prints the command, its exit code and output, and `docker logs` of every container
// it started; on GitHub Actions the cause is also an annotation, readable without the job log.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const image = process.env.TASKIE_TEST_IMAGE || 'taskie:reliability';
const prefix = `taskie-data-check-${process.pid}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-nas-'));
const spare = fs.mkdtempSync(path.join(os.tmpdir(), 'taskie-nas-spare-'));
const started = [];
let lastCommand = null;

const describe = result => [
  `$ docker ${result.args.join(' ')}`,
  `exit code: ${result.status === null ? `none (${result.error?.code || result.signal || 'timeout'})` : result.status}`,
  `stdout:\n${(result.stdout || '').trimEnd() || '(empty)'}`,
  `stderr:\n${(result.stderr || '').trimEnd() || '(empty)'}`,
].join('\n');
const run = (args, options = {}) => {
  const result = { args, ...spawnSync('docker', args, { encoding: 'utf8', ...options }) };
  lastCommand = result;
  return result;
};
const docker = args => {
  const result = run(args);
  if (result.status !== 0) throw new Error(`docker command failed\n${describe(result)}`);
  return result.stdout.trim();
};
const pass = message => console.log(`PASS ${message}`);

// Database reads and writes go straight through better-sqlite3 so the app's startup logging
// ([SQLite] ...) never mixes into the value; the value is the last line after the marker.
const MARK = 'TASKIE_RESULT ';
function inApp(name, script) {
  const output = docker(['exec', '-u', '1000:1000', '-w', '/app/backend', name, 'node', '-e',
    `Promise.resolve((async () => { ${script} })()).then(value => console.log(${JSON.stringify(MARK)} + JSON.stringify(value ?? null)))`]);
  const line = output.split('\n').reverse().find(l => l.startsWith(MARK));
  if (!line) throw new Error(`no result marker in the output of docker exec ${name}\n${describe(lastCommand)}`);
  return JSON.parse(line.slice(MARK.length));
}
const sql = (name, statement, { write = false, method = write ? 'run' : 'get' } = {}) => inApp(name, `
  const db = new (require('better-sqlite3'))(process.env.DATABASE_PATH${write ? '' : ', { readonly: true }'});
  try { return db.prepare(${JSON.stringify(statement)}).${method}(); } finally { db.close(); }`);

async function start(name, args = []) {
  docker(['run', '-d', '--name', name, '-v', `${dir}:/app/data`, '-e', 'PUID=1000', '-e', 'PGID=1000', '-p', '127.0.0.1::3000', ...args, image]);
  started.push(name);
  const base = `http://${docker(['port', name, '3000/tcp']).split('\n')[0]}`;
  for (let i = 0; i < 300; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`container ${name} did not become healthy within 30 s at ${base}`);
}
// A container expected to refuse to start: its exit code and everything it printed.
// A timeout (status null) means it started after all.
let refusals = 0;
function refuse(args) {
  const name = `${prefix}-refuse-${++refusals}`;
  const result = run(['run', '--rm', '--name', name, ...args, image], { timeout: 120000 });
  const logs = result.status === null ? run(['logs', name]) : null;
  run(['rm', '-f', name]);
  lastCommand = result;
  const detail = `${describe(result)}${logs ? `\ndocker logs ${name} (still running at the timeout):\n${logs.stdout}${logs.stderr}` : ''}`;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, detail };
}
const refused = (result, pattern) => {
  assert.ok(result.status !== 0 && result.status !== null, `expected the container to refuse to start\n${result.detail}`);
  assert.match(result.output, pattern, `expected the refusal to explain why\n${result.detail}`);
};

let step = 'setup';
async function main() {
  // An install whose files were created by someone else (here the CI user, not uid 1000). The
  // directory stays readable to this script after it is handed over.
  step = 'an existing directory is taken over for PUID:PGID';
  fs.chmodSync(dir, 0o755);
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.writeFileSync(path.join(dir, 'uploads', 'old.jpg'), 'old photo');
  await start(`${prefix}-a`);
  assert.equal(docker(['exec', `${prefix}-a`, 'stat', '-c', '%u', '/proc/1']), '1000', 'the app runs as PUID');
  assert.equal(docker(['exec', `${prefix}-a`, 'stat', '-c', '%u:%g', '/app/data/uploads/old.jpg']), '1000:1000', 'existing files are handed to PUID:PGID');
  pass('an existing bind-mounted data directory is taken over for PUID:PGID and the app runs unprivileged');

  step = 'records and photos survive replacing the container';
  const inserted = sql(`${prefix}-a`, "INSERT INTO children (id, name, avatar_emoji, created_at) VALUES ('nas-drill', '持久化检查', '🐱', datetime('now'))", { write: true });
  assert.equal(inserted.changes, 1, 'the drill record is written');
  inApp(`${prefix}-a`, `require('node:fs').writeFileSync('/app/data/uploads/kept.jpg', 'kept photo');`);
  docker(['rm', '-f', `${prefix}-a`]);
  await start(`${prefix}-b`);
  assert.deepEqual(sql(`${prefix}-b`, "SELECT name FROM children WHERE id = 'nas-drill'"), { name: '持久化检查' });
  assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'kept.jpg'), 'utf8'), 'kept photo');
  assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'old.jpg'), 'utf8'), 'old photo');
  pass('records and photos survive replacing the container');

  step = 'a read-only or unwritable data directory stops the start';
  refused(refuse(['-v', `${dir}:/app/data:ro`]), /数据目录 \/app\/data 不可写/);
  // compose `user:` with a directory that user cannot write (the spare directory belongs to the CI user).
  fs.chmodSync(spare, 0o755);
  refused(refuse(['--user', '4242:4242', '-v', `${spare}:/app/data`]), /不可写（运行用户 uid 4242）/);
  pass('a read-only or unwritable data directory stops the start with a clear message');

  // As if a newer image had upgraded this directory before rolling back to this one.
  step = 'a database upgraded by a newer version is refused';
  inApp(`${prefix}-b`, `const db = new (require('better-sqlite3'))(process.env.DATABASE_PATH); db.pragma('user_version = 9999'); db.close();`);
  docker(['rm', '-f', `${prefix}-b`]);
  refused(refuse(['-v', `${dir}:/app/data`, '-e', 'PUID=1000', '-e', 'PGID=1000']), /数据库版本 v9999 高于当前程序支持/);
  pass('a data directory upgraded by a newer version is refused instead of being misread after a rollback');
}

function report(error) {
  const sections = [`FAIL ${step}`, error.stack || String(error)];
  if (lastCommand && !String(error.message).includes(`$ docker ${lastCommand.args.join(' ')}`)) sections.push(`last command:\n${describe(lastCommand)}`);
  for (const name of started) {
    const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
    if (logs.status === 0) sections.push(`docker logs ${name}:\n${`${logs.stdout}${logs.stderr}`.trimEnd() || '(empty)'}`);
  }
  const text = sections.join('\n\n');
  console.error(text);
  // Annotations are listed by the public check-runs API, unlike the job log.
  if (process.env.GITHUB_ACTIONS) {
    const escape = s => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    console.log(`::error title=${escape(`docker-data: ${step}`).replace(/[:,]/g, ' ')}::${escape(text.slice(0, 30000))}`);
  }
}

main().catch(error => { report(error); process.exitCode = 1; }).finally(() => {
  for (const name of started) run(['rm', '-f', name]);
  // The container handed the directories to uid 1000, and /tmp is sticky, so this user could not
  // remove them: hand everything back to this user from inside a container, then remove it here.
  const owner = `${process.getuid()}:${process.getgid()}`;
  for (const target of [dir, spare]) {
    const back = run(['run', '--rm', '--user', '0:0', '--entrypoint', 'chown', '-v', `${target}:/d`, image, '-R', owner, '/d']);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      console.error(`cleanup: could not remove ${target}: ${error.message}\n${describe(back)}`);
      process.exitCode = 1;
    }
  }
});
