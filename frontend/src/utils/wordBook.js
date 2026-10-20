// Character and word book (生字生词本): entries are a single character or a word of up to 8.
export const MAX_ENTRY_LENGTH = 8;

// Fixed categories in display order, matching the server. Anyone may add one; only parents remove.
export const CATEGORIES = [
  { key: 'recognize', label: '会认读', icon: '👀', chip: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
  { key: 'write', label: '会写', icon: '✍️', chip: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  { key: 'fix_strokes', label: '笔画要改正', icon: '🖍️', chip: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' },
  { key: 'error_prone', label: '易错字', icon: '⚠️', chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' }
];

export const categoryInfo = key => CATEGORIES.find(category => category.key === key);

export const entryChars = text => Array.from((text || '').trim());

export const isWord = text => entryChars(text).length > 1;

// What the lookup box accepts as an entry: the Chinese characters typed, at most 8.
export function cleanEntry(raw) {
  return Array.from(raw || '').filter(ch => /\p{Script=Han}/u.test(ch)).slice(0, MAX_ENTRY_LENGTH).join('');
}

// Toggling a category: adding is always allowed, removing only for parents.
export function toggleCategory(current, key, role) {
  if (current.includes(key)) {
    if (role !== 'parent') return { categories: current, blocked: true };
    return { categories: current.filter(item => item !== key), blocked: false };
  }
  return { categories: CATEGORIES.map(c => c.key).filter(k => k === key || current.includes(k)), blocked: false };
}
