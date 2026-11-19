export const MAX_ENGLISH_WORD_LENGTH = 80;
export const MAX_ENGLISH_META_LENGTH = 60;

export const ENGLISH_CATEGORIES = [
  { key: 'recognize', label: '会认读', icon: '👀', chip: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
  { key: 'write', label: '会默写', icon: '✍️', chip: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  { key: 'error_prone', label: '易错词', icon: '⚠️', chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' }
];

const VALID_WORD_RE = /^[A-Za-z0-9\s'.\-/]+$/;

export const englishCategoryInfo = key => ENGLISH_CATEGORIES.find(c => c.key === key);

export function normalizeWordDisplay(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u2018\u2019\u02BC\uFF07\u2032]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function identityKey(raw) {
  return normalizeWordDisplay(raw);
}

export function canonicalKey(raw) {
  return normalizeWordDisplay(raw).toLowerCase();
}

export function isValidEnglishWord(raw) {
  const clean = normalizeWordDisplay(raw);
  return Boolean(clean && clean.length <= MAX_ENGLISH_WORD_LENGTH && /[A-Za-z]/.test(clean) && VALID_WORD_RE.test(clean));
}

export function compareSpellingAnswer(typed, expected) {
  const normalizedTyped = normalizeWordDisplay(typed);
  const normalizedExpected = normalizeWordDisplay(expected);
  return {
    is_correct: Boolean(normalizedExpected) && normalizedTyped.toLowerCase() === normalizedExpected.toLowerCase(),
    exact_case: Boolean(normalizedExpected) && normalizedTyped === normalizedExpected,
    normalized_typed: normalizedTyped,
    normalized_expected: normalizedExpected
  };
}

export function toggleEnglishCategory(current = [], key, role) {
  if (current.includes(key)) {
    if (role !== 'parent') return { categories: current, blocked: true };
    return { categories: current.filter(item => item !== key), blocked: false };
  }
  return { categories: ENGLISH_CATEGORIES.map(c => c.key).filter(k => k === key || current.includes(k)), blocked: false };
}

export function hasEnglishDefinition(entry) {
  if (!entry) return false;
  return Boolean((entry.definition_zh && entry.definition_zh.trim()) || (entry.definition_en && entry.definition_en.trim()));
}
