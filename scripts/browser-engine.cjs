// Resolve Playwright browser engine without colliding with OS desktop BROWSER defaults (e.g. firefox).
// Explicit TASKIE_BROWSER values must be chromium or webkit; legacy BROWSER=chromium|webkit still works.
function browserEngine(env = process.env) {
  if (env.TASKIE_BROWSER !== undefined && env.TASKIE_BROWSER !== '') {
    if (!['chromium', 'webkit'].includes(env.TASKIE_BROWSER)) {
      throw new Error(`Unsupported TASKIE_BROWSER: ${env.TASKIE_BROWSER}`);
    }
    return env.TASKIE_BROWSER;
  }
  if (env.BROWSER === 'webkit' || env.BROWSER === 'chromium') return env.BROWSER;
  return 'chromium';
}

module.exports = { browserEngine };
