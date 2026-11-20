// Shared setup for the local browser smoke scripts. Playwright comes from PLAYWRIGHT_MODULE_PATH (an
// absolute path to an installation outside the project) or the project; the browser from CHROMIUM_PATH,
// else a system Chromium/Chrome, else Playwright's own; the app listens on SMOKE_PORT, else a free port.
// English acceptance scripts use launchBrowser to select TASKIE_BROWSER=chromium|webkit (or BROWSER=chromium|webkit).
const fs = require('node:fs');
const { browserEngine } = require('./browser-engine.cjs');

const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const SYSTEM_BROWSERS = ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];

function launchOptions() {
  const executablePath = process.env.CHROMIUM_PATH || SYSTEM_BROWSERS.find(file => fs.existsSync(file));
  return { headless: true, args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) };
}

const smokePort = () => Number(process.env.SMOKE_PORT) || 0;

async function launchBrowser() {
  const name = browserEngine();
  console.log(`BROWSER ${name}`);
  return name === 'webkit' ? webkit.launch({ headless: true }) : chromium.launch(launchOptions());
}

module.exports = { chromium, launchOptions, smokePort, browserEngine, launchBrowser };
