// NAS-style data directory checks against a real container and a bind-mounted host directory (not
// tmpfs). Build the image first (default tag taskie:reliability; TASKIE_TEST_IMAGE for another):
//   docker build -t taskie:reliability . && node scripts/smoke-docker-data.cjs
// Covers: an existing directory owned by another user is taken over for PUID; records and photos
// survive replacing the container; a read-only or unwritable directory stops the start with a clear
// message; and a data directory already upgraded by a newer version is refused (a safe rollback).
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
const run = (args, options = {}) => spawnSync('docker', args, { encoding: 'utf8', ...options });
const docker = args => {
  const result = run(args);
  if (result.status !== 0) throw new Error(`docker ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
};
const pass = message => console.log(`PASS ${message}`);
const inApp = (name, script) => docker(['exec', '-u', '1000:1000', '-w', '/app/backend', name, 'node', '-e', script]);

async function start(name, args = []) {
  docker(['run', '-d', '--name', name, '-v', `${dir}:/app/data`, '-e', 'PUID=1000', '-e', 'PGID=1000', '-p', '127.0.0.1::3000', ...args, image]);
  started.push(name);
  const base = `http://${docker(['port', name, '3000/tcp']).split('\n')[0]}`;
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`container ${name} did not become healthy:\n${docker(['logs', name])}`);
}
// A container expected to refuse to start: its exit code and everything it printed.
// A timeout (status null) means it started after all.
let refusals = 0;
function refuse(args) {
  const name = `${prefix}-refuse-${++refusals}`;
  const result = run(['run', '--rm', '--name', name, ...args, image], { timeout: 120000 });
  run(['rm', '-f', name]);
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

async function main() {
  // An install whose files were created by someone else (here the CI user, not uid 1000). The
  // directory stays readable to this script after it is handed over.
  fs.chmodSync(dir, 0o755);
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.writeFileSync(path.join(dir, 'uploads', 'old.jpg'), 'old photo');
  await start(`${prefix}-a`);
  assert.equal(docker(['exec', `${prefix}-a`, 'stat', '-c', '%u', '/proc/1']), '1000', 'the app runs as PUID');
  assert.equal(docker(['exec', `${prefix}-a`, 'stat', '-c', '%u:%g', '/app/data/uploads/old.jpg']), '1000:1000', 'existing files are handed to PUID:PGID');
  pass('an existing bind-mounted data directory is taken over for PUID:PGID and the app runs unprivileged');

  inApp(`${prefix}-a`, `const { getDb } = require('./src/db');
    getDb(process.env.DATABASE_PATH).prepare("INSERT INTO children (id, name, avatar_emoji, created_at) VALUES ('nas-drill', '持久化检查', '🐱', datetime('now'))").run();
    require('node:fs').writeFileSync('/app/data/uploads/kept.jpg', 'kept photo');`);
  docker(['rm', '-f', `${prefix}-a`]);
  await start(`${prefix}-b`);
  assert.equal(inApp(`${prefix}-b`, `const { getDb } = require('./src/db');
    console.log(getDb(process.env.DATABASE_PATH).prepare("SELECT name FROM children WHERE id = 'nas-drill'").get()?.name);`), '持久化检查');
  assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'kept.jpg'), 'utf8'), 'kept photo');
  assert.equal(fs.readFileSync(path.join(dir, 'uploads', 'old.jpg'), 'utf8'), 'old photo');
  pass('records and photos survive replacing the container');

  const readOnly = refuse(['-v', `${dir}:/app/data:ro`]);
  assert.ok(readOnly.status !== 0 && readOnly.status !== null, readOnly.output);
  assert.match(readOnly.output, /数据目录 \/app\/data 不可写/);
  // compose `user:` with a directory that user cannot write (the spare directory belongs to the CI user).
  fs.chmodSync(spare, 0o755);
  const otherUser = refuse(['--user', '4242:4242', '-v', `${spare}:/app/data`]);
  assert.ok(otherUser.status !== 0 && otherUser.status !== null, otherUser.output);
  assert.match(otherUser.output, /不可写（运行用户 uid 4242）/);
  pass('a read-only or unwritable data directory stops the start with a clear message');

  // As if a newer image had upgraded this directory before rolling back to this one.
  inApp(`${prefix}-b`, `new (require('better-sqlite3'))(process.env.DATABASE_PATH).pragma('user_version = 9999');`);
  docker(['rm', '-f', `${prefix}-b`]);
  const newer = refuse(['-v', `${dir}:/app/data`, '-e', 'PUID=1000', '-e', 'PGID=1000']);
  assert.ok(newer.status !== 0 && newer.status !== null, newer.output);
  assert.match(newer.output, /数据库版本 v9999 高于当前程序支持/);
  pass('a data directory upgraded by a newer version is refused instead of being misread after a rollback');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const name of started) run(['rm', '-f', name]);
  // Files now belong to uid 1000; remove them from inside a container rather than as this user.
  for (const target of [dir, spare]) {
    run(['run', '--rm', '--entrypoint', 'sh', '-v', `${target}:/d`, image, '-c', 'rm -rf /d/* /d/.[!.]*']);
    fs.rmSync(target, { recursive: true, force: true });
  }
});
