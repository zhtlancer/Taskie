import { computed, ref } from 'vue';

export const THEME_KEY = 'taskie_theme';
export const THEMES = ['system', 'light', 'dark'];
export function resolveTheme(preference, systemDark) {
  return preference === 'dark' || (preference !== 'light' && systemDark) ? 'dark' : 'light';
}
const readPreference = () => {
  try { const value = localStorage.getItem(THEME_KEY); return THEMES.includes(value) ? value : 'system'; }
  catch { return 'system'; }
};
const preference = ref(readPreference());
const media = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)') : null;
const systemDark = ref(Boolean(media?.matches));
export const isDark = computed(() => resolveTheme(preference.value, systemDark.value) === 'dark');
function applyTheme() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark.value);
  document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = preference.value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDark.value ? '#0b1120' : '#6C63FF');
}
export function setTheme(value) {
  if (!THEMES.includes(value)) return;
  preference.value = value;
  try { localStorage.setItem(THEME_KEY, value); } catch { /* The current page still follows the choice. */ }
  applyTheme();
}
let initialized = false;
export function initTheme() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  applyTheme();
  const changed = event => { systemDark.value = event.matches; applyTheme(); };
  if (media?.addEventListener) media.addEventListener('change', changed);
  else media?.addListener?.(changed);
  window.addEventListener('storage', event => {
    if (event.key === THEME_KEY || event.key === null) { preference.value = readPreference(); applyTheme(); }
  });
}
export const useTheme = () => ({ preference: computed(() => preference.value), isDark, setTheme });
