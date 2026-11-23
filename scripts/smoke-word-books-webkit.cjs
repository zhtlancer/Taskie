// Keep WebKit assertions identical to the individual Chromium suites.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
let failed = false;
for (const script of [
  'smoke-word-books',
  'smoke-character-import',
  'smoke-word-study-scopes',
  'smoke-word-tests',
]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, `${script}.cjs`)], {
    env: { ...process.env, TASKIE_BROWSER: 'webkit' },
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error);
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
