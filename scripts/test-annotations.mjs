// node:test reporter for CI: every failing test also becomes a GitHub error annotation with its
// file, line, assertion diff and the clock/time zone it ran under. Annotations are readable through
// the public check-runs API, so an intermittent failure can be located without the login-only logs.
// Outside GitHub Actions it prints nothing. Used next to the normal reporter, see checks.yml.
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';

const MAX_MESSAGE = 6000;
const escapeData = text => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = text => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

function context() {
  return [
    `failed at ${new Date().toISOString()} (TZ=${process.env.TZ || 'unset'}, resolved ${Intl.DateTimeFormat().resolvedOptions().timeZone}, TIME_ZONE=${process.env.TIME_ZONE || 'unset'})`,
    `node ${process.version}, ${os.availableParallelism()} CPU, load ${os.loadavg().map(n => n.toFixed(2)).join(' ')}`
  ].join('\n');
}

export default async function* githubAnnotations(source) {
  const enabled = process.env.GITHUB_ACTIONS === 'true';
  for await (const event of source) {
    if (!enabled || event.type !== 'test:fail') continue;
    const { name, file, line, details } = event.data;
    const error = details?.error;
    // A suite that fails only because a test inside it failed adds nothing to that test's annotation.
    if (error?.failureType === 'subtestsFailed') continue;
    const cause = error?.cause ?? error;
    let message = `${name}\n${inspect(cause, { depth: 4, breakLength: 100 })}\n\n${context()}`;
    if (message.length > MAX_MESSAGE) message = `${message.slice(0, MAX_MESSAGE)}\n… (truncated, see the job log)`;
    const where = file ? `file=${escapeProperty(path.relative(process.env.GITHUB_WORKSPACE || process.cwd(), file))},` : '';
    const at = line ? `line=${line},` : '';
    yield `::error ${where}${at}title=${escapeProperty(`Test failed: ${name}`.slice(0, 200))}::${escapeData(message)}\n`;
  }
}
