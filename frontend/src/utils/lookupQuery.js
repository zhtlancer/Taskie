import { MAX_ENTRY_LENGTH } from './wordBook.js';
import { isValidEnglishWord, normalizeWordDisplay, MAX_ENGLISH_WORD_LENGTH } from './englishWord.js';

export function lookupQuery(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { language: '', text: '', error: '请输入汉字、英文单词或短语。' };
  if (/^[\p{Script=Han}\s]+$/u.test(text)) {
    const word = text.replace(/\s/g, '');
    if (Array.from(word).length > MAX_ENTRY_LENGTH) return { language: '', text, error: `汉字或词语最多 ${MAX_ENTRY_LENGTH} 个字，请分开查询。` };
    return { language: 'zh', text: word, error: '' };
  }
  if (/\p{Script=Han}/u.test(text) && /[A-Za-z]/.test(text)) {
    return { language: '', text, error: '请分别输入汉字或英文，暂不支持中英混合查询。' };
  }
  const word = normalizeWordDisplay(text);
  if (isValidEnglishWord(word)) return { language: 'en', text: word, error: '' };
  return { language: '', text, error: `请输入汉字或有效的英文单词、短语，英文最多 ${MAX_ENGLISH_WORD_LENGTH} 个字符。` };
}
