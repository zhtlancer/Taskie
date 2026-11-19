// Optional offline preparation: build only disposable dictionary indexes, never open the business DB.
const config = require('./config');
const { DictionaryService } = require('./services/dictionary');

async function main() {
  const service = new DictionaryService({ dictDir: config.dictDir, cacheDir: config.dictCacheDir });
  try {
    console.log('正在构建离线词典索引，首次运行可能需要数十秒…');
    const result = await service.rebuildIndex();
    if (!result.built) throw new Error(result.reason || '未配置可用的离线词典');
    console.log(JSON.stringify(result, null, 2));
  } finally { await service.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
