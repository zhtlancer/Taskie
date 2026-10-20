// Check tracked repository content; local plans and ignored runtime files are outside this check.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const runtime = files.filter(name => /(^|\/)(?:\.agents|\.multica|\.codex)\//.test(name));
const instructions = fs.readFileSync('AGENTS.md', 'utf8');
if (runtime.length || /BEGIN MULTICA-RUNTIME|mention:\/\/(?:agent|member|project)\//.test(instructions)) {
  console.error('Repository content check failed: remove platform runtime metadata from tracked files and AGENTS.md.');
  if (runtime.length) console.error(runtime.join('\n'));
  process.exitCode = 1;
} else console.log('Repository content check passed');
