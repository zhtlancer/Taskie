import bundledData from '../assets/hanziData/index.js';
import { pinyin } from 'pinyin-pro';
import cnchar from 'cnchar';
import cncharRadical from 'cnchar-radical';
import { playStarAdded, speakWord } from './sound.js';

// Initialize cnchar-radical plugin
try {
  cnchar.use(cncharRadical);
} catch (e) {
  console.warn('[Hanzi] cnchar plugin error', e);
}

// In-memory cache for character stroke data
const charDataCache = new Map();

for (const [char, data] of Object.entries(bundledData)) charDataCache.set(char, data);

/**
 * Get pinyin for a Chinese character or word; words are read as a whole so that
 * polyphonic characters get the reading the word uses (银行 → yín háng).
 * @param {string} char
 * @returns {string} e.g. "xué"
 */
export function getCharPinyin(char) {
  if (!char) return '';
  const clean = char.trim();
  if (!clean) return '';
  try {
    return pinyin(clean, { toneType: 'symbol' }) || '';
  } catch (e) {
    return '';
  }
}

/**
 * Get radical and structure information
 * @param {string} char
 * @returns {{ radical: string, radicalCount: number, struct: string }}
 */
export function getCharRadical(char) {
  if (!char) return { radical: '—', radicalCount: 0, struct: '独体结构' };
  const clean = char.trim()[0];
  if (!clean) return { radical: '—', radicalCount: 0, struct: '独体结构' };
  try {
    const radResult = cnchar.radical(clean);
    if (radResult && radResult[0]) {
      return {
        radical: radResult[0].radical || '—',
        radicalCount: radResult[0].radicalCount || 0,
        struct: radResult[0].struct || '独体结构'
      };
    }
  } catch (e) {
    console.warn('[Hanzi] Radical lookup error for', clean, e);
  }
  return { radical: '—', radicalCount: 0, struct: '独体结构' };
}

/**
 * Get total stroke count
 * @param {string} char
 * @returns {number}
 */
export function getCharStrokes(char) {
  if (!char) return 0;
  const clean = char.trim()[0];
  if (!clean) return 0;
  try {
    const s = cnchar.stroke(clean);
    if (typeof s === 'number' && s > 0) return s;
    if (Array.isArray(s) && typeof s[0] === 'number') return s[0];
  } catch (e) {}
  // Fallback: check cached character data
  if (charDataCache.has(clean)) {
    return charDataCache.get(clean).strokes?.length || 0;
  }
  return 0;
}

/**
 * Character data loader for HanziWriter
 * Supports local bundle, in-memory cache, and CDN fallback
 * @param {string} char
 * @param {Function} onComplete
 * @param {Function} onError
 */
export async function charDataLoader(char, onComplete, onError) {
  if (!char) {
    if (onError) onError(new Error('Empty character'));
    return;
  }
  const clean = char.trim()[0];
  if (charDataCache.has(clean)) {
    if (onComplete) onComplete(charDataCache.get(clean));
    return;
  }

  // Stroke data ships with the app (/hanzi-data, see scripts/copy-hanzi-data.mjs); the CDN is
  // only a fallback, e.g. for the Vite dev server.
  let lastError;
  for (const base of ['/hanzi-data', 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1']) {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(clean)}.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      charDataCache.set(clean, data);
      if (onComplete) onComplete(data);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.error(`[HanziWriter] Failed to load character data for ${clean}`, lastError);
  if (onError) onError(lastError);
}

/**
 * Speak Chinese word using Web Speech API
 * @param {string} text
 */
export function speakHanzi(text) {
  speakWord(text);
}

/**
 * Play star sound when character added to character book
 */
export function playAddCharacterSound() {
  playStarAdded();
}

export default {
  getCharPinyin,
  getCharRadical,
  getCharStrokes,
  charDataLoader,
  speakHanzi,
  playAddCharacterSound
};
