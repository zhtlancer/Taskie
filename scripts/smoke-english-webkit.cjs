// Reuse every English acceptance assertion; never silently fall back to Chromium.
process.env.TASKIE_BROWSER = 'webkit';
require('./smoke-english-wordbook.cjs');
