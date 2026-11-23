// Exercise the system-font fallback deterministically. The font CDN is unrelated
// to word-book behavior and transient WebKit stylesheet errors must not flake CI.
async function useLocalLearningFont(context) {
  await context.route('https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@*/style.css', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: '/* Use installed Chinese system fonts. */',
    }),
  );
}
module.exports = { useLocalLearningFont };
