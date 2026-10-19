const fs = require('fs');
const path = require('path');
const config = require('./config');

// Mirror all console.error and console.warn to stdout so Container Manager stdout logs capture everything
const originalConsoleError = console.error;
console.error = (...args) => {
  console.log('🔴 [ERROR]', ...args);
  originalConsoleError(...args);
};
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  console.log('🟡 [WARN]', ...args);
  originalConsoleWarn(...args);
};

// Top-level crash listeners so any fatal errors are printed immediately to stdout/stderr
process.on('uncaughtException', (err) => {
  console.log('\n💥 [Taskie FATAL uncaughtException]:', err.stack || err.message || err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.log('\n💥 [Taskie FATAL unhandledRejection]:', reason);
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

// Pre-flight check 1: Verify write permissions for the data directory
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

// Pre-flight check 2: Verify that dbPath is NOT accidentally created as a directory by Docker
if (fs.existsSync(config.dbPath)) {
  const stat = fs.statSync(config.dbPath);
  if (stat.isDirectory()) {
    console.error('❌ [挂载严重错误] 数据库路径被 Docker 挂载成了目录，而不是 SQLite 文件！');
    console.error('   当前路径:', config.dbPath);
    console.error('👉 解决办法：请在群晖宿主机上删除该 data.sqlite 目录，确保使用目录级挂载 ./data:/app/data\n');
    process.exit(1);
  }
}

// Pre-flight check 3: Verify better-sqlite3 native engine in an isolated child process
try {
  const { execSync } = require('child_process');
  execSync('node -e "const Database = require(\'better-sqlite3\'); const db = new Database(\':memory:\'); db.close();"', {
    stdio: 'pipe',
    timeout: 5000
  });
  console.log('✅ SQLite better-sqlite3 原生引擎加载与内存测试通过');
} catch (nativeErr) {
  console.error('❌ [SQLite 引擎加载失败]: 当前环境下的 SQLite 原生扩展无法执行内存测试');
  console.error('   底层报错:', nativeErr.message);
  process.exit(1);
}

console.log('📦 正在加载应用核心模块与路由...');
const buildApp = require('./app');
const { seedDemoData } = require('./db/seed');
console.log('✅ 核心模块加载就绪');

let app;
let dailyTimer;

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

    // Record each child's tasks for today even when nobody opens the app.
    const generateToday = () => {
      try {
        app.services.tasksService.generateToday();
      } catch (err) {
        console.error('生成今日任务失败:', err.stack || err.message || err);
      }
    };
    generateToday();
    dailyTimer = setInterval(generateToday, 60 * 1000);
    console.log('🗓️ 已启动每日任务自动生成（每分钟同步一次今天的任务）');
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
      clearInterval(dailyTimer);
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
