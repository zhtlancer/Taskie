const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect, stripVTControlCharacters } = require('node:util');

const escapeData = value => value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = value => escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
let failureCount = 0;

function failureText(error) {
  const detail = typeof error === 'string' ? error : inspect(error, { depth: 4, breakLength: 100 });
  return stripVTControlCharacters(`${detail}\n\n${new Date().toISOString()} · node ${process.version}\nTZ=${process.env.TZ || 'unset'} TIME_ZONE=${process.env.TIME_ZONE || 'unset'} · ${os.availableParallelism()} CPU · load ${os.loadavg().join(' ')}`);
}

function errorAnnotation(name, detail) {
  const message = detail.length > 6000 ? `${detail.slice(0, 5500)}\n… truncated; see output.log\n${detail.slice(-400)}` : detail;
  return `::error title=${escapeProperty(name.slice(0, 200))}::${escapeData(message)}\n`;
}

// Call before disposing the failing context; artifacts contain only isolated test data.
async function reportBrowserFailure(name, error, contextOrBrowser, {
  directory = process.env.BROWSER_DIAGNOSTICS_DIR, github = process.env.GITHUB_ACTIONS === 'true'
} = {}) {
  const detail = failureText(error);
  if (github) process.stdout.write(errorAnnotation(name, detail));
  if (!directory) return;
  try {
    const dir = path.resolve(directory);
    fs.mkdirSync(dir, { recursive: true });
    const label = name.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 90) || 'failure';
    const prefix = path.join(dir, `${label}-${process.pid}-${++failureCount}`);
    fs.writeFileSync(`${prefix}.txt`, detail);
    const contexts = contextOrBrowser?.contexts ? contextOrBrowser.contexts() : [contextOrBrowser];
    const pages = contexts.flatMap(context => context?.pages() || []).filter(page => !page.isClosed());
    for (const [index, page] of pages.entries()) {
      try { await page.screenshot({ path: `${prefix}-${index + 1}.png`, fullPage: true, timeout: 3000 }); }
      catch (error) { fs.appendFileSync(`${prefix}.txt`, `\nScreenshot unavailable: ${error.message}`); }
    }
  } catch (error) { console.error('Could not save browser diagnostics:', error.message); }
}

module.exports = { errorAnnotation, reportBrowserFailure };
