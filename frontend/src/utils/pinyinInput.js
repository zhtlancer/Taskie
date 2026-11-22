import { convert } from 'pinyin-pro';
// An immediate display hint only; the server validates syllables, tones and Hanzi count.
export function displayPinyin(raw) {
  return convert(String(raw || '').normalize('NFC').trim().toLowerCase().replaceAll('v', 'ü').replace(/\s+/g, ' ').replace(/([a-zü]+)[05](?=\s|$)/g, '$1'), { format: 'numToSymbol' });
}
