// The 楷体 for characters a child is learning: loaded only where those characters are shown,
// so the rest of the app starts with system fonts.
export const LEARNING_FONT_URL = 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.1.0/style.css';

export function loadLearningFont(doc = globalThis.document) {
  if (!doc || doc.getElementById('learning-font')) return;
  const link = doc.createElement('link');
  link.id = 'learning-font';
  link.rel = 'stylesheet';
  link.href = LEARNING_FONT_URL;
  doc.head.appendChild(link);
}
