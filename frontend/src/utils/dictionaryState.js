export function dictionaryLookupNotice(result, match) {
  if (result?.available === false) return { code: 'DICTIONARY_UNCONFIGURED', message: '未配置或未发现本地离线词典，可手动填写释义。' };
  if (result?.index_ready === false) return { code: 'DICTIONARY_NOT_READY', message: '词典索引尚未就绪，可稍后重试或手动填写释义。' };
  if (!match) return { code: 'DICTIONARY_NOT_FOUND', message: '词典中未找到该词条，可手动填写释义。' };
  if (!match.audio?.length) return { code: 'DICTIONARY_NO_AUDIO', message: '已找到词典释义，暂无可用发音。' };
  return null;
}

export function dictionaryErrorMessage(error) {
  if (typeof error === 'string') return error;
  return error?.message || '词典查询失败，请稍后重试。';
}

export function isDictionaryAbort(error) {
  return error?.code === 'ERR_CANCELED' || ['AbortError', 'CanceledError'].includes(error?.name);
}
