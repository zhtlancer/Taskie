const MAX_WORD_LENGTH = 80;
const MAX_META_LENGTH = 60;
const ENGLISH_CATEGORIES = ['recognize', 'write', 'error_prone'];
const VALID_WORD_RE = /^[A-Za-z0-9\s'.\-/]+$/;

/**
 * Normalize curly apostrophes to straight ASCII "'" and collapse repeated whitespace.
 */
function normalizeApostrophesAndSpaces(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u2018\u2019\u02BC\uFF07\u2032]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeWordDisplay(raw) {
  return normalizeApostrophesAndSpaces(raw);
}

/**
 * Case-preserving identity key for uniqueness ("May" and "may" remain distinct entries).
 */
function identityKey(raw) {
  return normalizeWordDisplay(raw);
}

/**
 * Case-insensitive canonical key for lookup matching and spelling tolerance.
 */
function canonicalKey(raw) {
  return normalizeWordDisplay(raw).toLowerCase();
}

function validateEnglishWord(raw) {
  const word = normalizeWordDisplay(raw);
  if (!word) {
    throw { status: 400, message: '请输入英文单词或短语' };
  }
  if (word.length > MAX_WORD_LENGTH) {
    throw { status: 400, message: `英文单词或短语最多 ${MAX_WORD_LENGTH} 个字符` };
  }
  if (!/[A-Za-z]/.test(word) || !VALID_WORD_RE.test(word)) {
    throw { status: 400, message: '请输入有效的英文单词或常用短语（可含空格、连字符或撇号）' };
  }
  return word;
}

function compareSpellingAnswer(typed, expected) {
  const normalizedTyped = normalizeWordDisplay(typed);
  const normalizedExpected = normalizeWordDisplay(expected);
  const exactCase = Boolean(normalizedExpected) && normalizedTyped === normalizedExpected;
  const isCorrect = Boolean(normalizedExpected) && normalizedTyped.toLowerCase() === normalizedExpected.toLowerCase();
  return {
    is_correct: isCorrect,
    exact_case: exactCase,
    normalized_typed: normalizedTyped,
    normalized_expected: normalizedExpected
  };
}

function normalizeEnglishCategories(categories) {
  if (categories === undefined || categories === null) return [];
  if (!Array.isArray(categories) || categories.some(key => !ENGLISH_CATEGORIES.includes(key))) {
    throw { status: 400, message: '分类无效' };
  }
  return ENGLISH_CATEGORIES.filter(key => categories.includes(key));
}

function normalizeOptionalText(value, maxLength = 240) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim();
  if (!clean) return null;
  return clean.slice(0, maxLength);
}

function normalizeMetaText(value) {
  return normalizeOptionalText(value, MAX_META_LENGTH);
}

module.exports = {
  MAX_WORD_LENGTH,
  MAX_META_LENGTH,
  ENGLISH_CATEGORIES,
  normalizeApostrophesAndSpaces,
  normalizeWordDisplay,
  identityKey,
  canonicalKey,
  validateEnglishWord,
  compareSpellingAnswer,
  normalizeEnglishCategories,
  normalizeOptionalText,
  normalizeMetaText
};
