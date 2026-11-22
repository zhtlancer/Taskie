export const SOURCE_TYPES = [
  { value: '', label: '未指定' }, { value: 'textbook', label: '教材' },
  { value: 'material', label: '资料' }, { value: 'custom', label: '自主整理' }
];
export const formatBookDefaultName = (source, unit) => Array.from([source?.trim(), unit?.trim()].filter(Boolean).join(' · ')).slice(0, 80).join('');
export function groupWordBooks(books) {
  const groups = new Map();
  for (const book of books) {
    const key = book.source || '';
    if (!groups.has(key)) groups.set(key, { source: key, label: key || '未填写来源', books: [] });
    groups.get(key).books.push(book);
  }
  return [...groups.values()];
}
export function filterBookEntries(entries, scope) {
  if (!scope || scope === 'all') return entries;
  const selected = entries.filter(entry => scope === 'unassigned' ? !entry.books?.length : entry.books?.some(book => book.id === scope));
  return scope === 'unassigned' ? selected : selected.sort((a, b) => (a.books.find(book => book.id === scope).item_position ?? 0)
    - (b.books.find(book => book.id === scope).item_position ?? 0) || a.id.localeCompare(b.id));
}
export const bookEntry = (entry, scope) => {
  const book = entry.books?.find(item => item.id === scope);
  return book?.pinyin_override ? { ...entry, pinyin: book.pinyin_override } : entry;
};
