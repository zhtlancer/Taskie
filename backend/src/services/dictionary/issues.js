// Public diagnostics must not expose dictionary/cache paths from native errors.
function dictionaryFailure(error) {
  const code = error?.code || '';
  const message = error?.message || '';
  if (code === 'DICTIONARY_ENTRY_INVALID') return { status: 503, code, message: '部分词条的词典数据无法读取，可手动填写释义。' };
  if (/Unsupported ZIP compression method/.test(message)) return { status: 503, code: 'DICTIONARY_UNSUPPORTED', message: '词典资源的压缩格式暂不支持，可手动填写释义。' };
  if (code === 'DICTIONARY_INVALID' || ['Z_DATA_ERROR', 'Z_BUF_ERROR', 'ERR_BUFFER_OUT_OF_BOUNDS', 'SQLITE_CORRUPT', 'SQLITE_NOTADB'].includes(code)
    || /Invalid BGL file header|Unexpected EOF reading ZIP|ZIP End-of-Central-Directory not found|Invalid ZIP(?:64 EOCD| local header) signature/.test(message)) {
    return { status: 503, code: 'DICTIONARY_INVALID', message: '词典或资源包损坏，暂时无法读取，请检查词典文件后重试。' };
  }
  if (code === 'ENOENT') return { status: 503, code: 'DICTIONARY_MISSING', message: '词典文件暂不可用，请检查词典挂载后重试。' };
  if (['EACCES', 'EPERM'].includes(code)) return { status: 503, code: 'DICTIONARY_UNREADABLE', message: '无法读取词典或缓存目录，请检查访问权限后重试。' };
  const status = error?.status || error?.statusCode;
  if (status >= 400 && status < 500) return { status, code: 'DICTIONARY_REQUEST_FAILED', message: message || '词典请求未能完成' };
  return { status: 503, code: 'DICTIONARY_LOOKUP_FAILED', message: '词典查询失败，请稍后重试。' };
}

function dictionaryLookupIssue(result, matched) {
  if (result?.available === false) return { code: 'DICTIONARY_UNCONFIGURED', message: '未配置或未发现本地离线词典，可手动填写释义。' };
  if (result?.index_ready === false) return { code: 'DICTIONARY_NOT_READY', message: '词典索引尚未就绪，可稍后重试或手动填写释义。' };
  if (!matched) return { code: 'DICTIONARY_NOT_FOUND', message: '词典中未找到该词条，可手动填写释义。' };
  return null;
}

module.exports = { dictionaryFailure, dictionaryLookupIssue };
