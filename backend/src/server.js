const fs = require('fs');
const path = require('path');
const config = require('./config');

// Top-level crash listeners so any fatal errors are printed immediately to stdout/stderr
process.on('uncaughtException', (err) => {
  console.error('\n💥 [Taskie FATAL uncaughtException]:', err.stack || err.message || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 [Taskie FATAL unhandledRejection]:', reason);
  process.exit(1);
});

console.log('==================================================');
console.log('🚀 Taskie (嗒嗒日常) 服务启动中...');
console.log('Node 版本:', process.version);
console.log('运行环境:', process.env.NODE_ENV || 'development');
console.log('当前工作目录:', process.cwd());
console.log('数据库路径:', config.dbPath);
console.log('上传目录:', config.uploadDir);
console.log('前端静态目录:', config.clientDistDir);
console.log('监听地址:', `${config.host}:${config.port}`);
console.log('==================================================');

// Pre-flight check: Verify write permissions for the data directory
const dbDir = path.dirname(config.dbPath);
try {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const testProbe = path.join(dbDir, `.probe-test-${Date.now()}`);
  fs.writeFileSync(testProbe, 'ok');
  fs.unlinkSync(testProbe);
  console.log('✅ 数据存储目录写权限检查通过:', dbDir);
} catch (permErr) {
  console.error('❌ [权限严重错误] 数据存储目录没有写权限:');
  console.error('   目标目录:', dbDir);
  console.error('   底层报错:', permErr.message);
  console.error('👉 解决办法：请在群晖 File Station 中右键 docker/taskie 文件夹 -> 属性 -> 权限 -> 赋予读写权限！\n');
}

console.log('📦 正在加载应用核心模块与路由...');
const buildApp = require('./app');
const { seedDemoData } = require('./db/seed');
console.log('✅ 核心模块加载就绪');

let app;

async function start() {
  try {
    console.log('🔧 正在初始化 Fastify 服务与 SQLite 数据库连接...');
    app = buildApp({
      logger: true
    });
    console.log('✅ Fastify 应用实例与数据库建立完成');

    if (process.env.SEED_DEMO_DATA === 'true') {
      try {
        console.log('🌱 检测到 SEED_DEMO_DATA=true，正在检查并导入演示数据...');
        seedDemoData(app.db);
      } catch (err) {
        console.warn('⚠️ 自动导入演示数据警告:', err.message);
      }
    }

    console.log(`🌐 正在绑定网络端口: ${config.host}:${config.port} ...`);
    const address = await app.listen({
      port: config.port,
      host: config.host
    });
    console.log(`🎉 Taskie 服务成功启动并就绪: ${address}`);
    console.log(`📁 静态资源与上传服务已挂载完成`);
  } catch (err) {
    console.error('❌ [服务启动致命异常]:', err.stack || err.message || err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n收到 ${signal} 信号，正在优雅关闭服务...`);
    try {
      if (app) {
        await app.close();
        if (app.db) {
          app.db.close();
        }
      }
      console.log('服务已安全退出。');
      process.exit(0);
    } catch (err) {
      console.error('关闭过程发生异常:', err);
      process.exit(1);
    }
  });
});

start();
