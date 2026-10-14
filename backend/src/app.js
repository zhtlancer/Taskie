const fs = require('fs');
const path = require('path');
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const fastifyJwt = require('@fastify/jwt');

const config = require('./config');
const { getDb } = require('./db');

const AuthService = require('./services/auth.service');
const ChildrenService = require('./services/children.service');
const TasksService = require('./services/tasks.service');
const RewardsService = require('./services/rewards.service');
const MistakesService = require('./services/mistakes.service');
const StatsService = require('./services/stats.service');
const CharactersService = require('./services/characters.service');
const { installAuthorization, getSetting } = require('./auth');
const BackupService = require('./services/backup.service');
const backupRoutes = require('./routes/backups.routes');

const authRoutes = require('./routes/auth.routes');
const childrenRoutes = require('./routes/children.routes');
const templatesRoutes = require('./routes/templates.routes');
const dailyTasksRoutes = require('./routes/daily-tasks.routes');
const rewardsRoutes = require('./routes/rewards.routes');
const statsRoutes = require('./routes/stats.routes');
const mistakesRoutes = require('./routes/mistakes.routes');
const charactersRoutes = require('./routes/characters.routes');

function buildApp(opts = {}) {
  console.log('  1/4 正在配置 Fastify 与上传目录...');
  const fastify = Fastify({
    logger: opts.logger !== undefined ? opts.logger : true,
    ...opts.fastifyOptions
  });

  // Ensure uploads directory exists
  const uploadDirectory = opts.uploadDir || config.uploadDir;
  if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
  }

  // Database
  console.log('  2/4 正在连接与初始化 SQLite 数据库...');
  const db = opts.db || getDb(opts.dbPath);

  // Services
  console.log('  3/4 正在实例化业务服务层 (Auth, Tasks, Rewards, Mistakes, Characters)...');
  const authService = new AuthService(db);
  const childrenService = new ChildrenService(db, uploadDirectory);
  const rewardsService = new RewardsService(db);
  const tasksService = new TasksService(db, rewardsService);
  rewardsService.tasksService = tasksService;
  const mistakesService = new MistakesService(db, uploadDirectory);
  const statsService = new StatsService(db, tasksService);
  const charactersService = new CharactersService(db);

  // Decorate fastify with services and db for easy access
  fastify.decorate('db', db);
  fastify.decorate('services', {
    authService,
    childrenService,
    tasksService,
    rewardsService,
    mistakesService,
    statsService,
    charactersService
  });

  console.log('  4/4 正在挂载路由与静态资源中间件...');

  // CORS
  fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  });

  // Multipart upload support (limits: 10MB per file)
  fastify.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024
    }
  });


  // Static file serving for uploads
  fastify.register(fastifyStatic, {
    root: uploadDirectory,
    prefix: '/uploads/'
  });

  // Static file serving for frontend production build (if dist directory exists)
  const clientDistDir = opts.clientDistDir || config.clientDistDir;
  if (clientDistDir && fs.existsSync(clientDistDir)) {
    fastify.register(fastifyStatic, {
      root: clientDistDir,
      prefix: '/',
      decorateReply: false
    });

    fastify.setNotFoundHandler((request, reply) => {
      const url = request.raw.url || '';
      if (url.startsWith('/api') || url.startsWith('/uploads')) {
        reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Route not found' });
        return;
      }
      const indexPath = path.join(clientDistDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        reply.type('text/html').send(fs.createReadStream(indexPath));
      } else {
        reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Not found' });
      }
    });
  }

  // JWT
  fastify.register(fastifyJwt, {
    secret: opts.jwtSecret || config.jwtSecret || getSetting(db, 'jwt_secret'),
    sign: { expiresIn: '12h' }
  });
  installAuthorization(fastify, db);
  const intervalHours = opts.backupIntervalHours ?? config.backupIntervalHours;
  const backupService = new BackupService(db, uploadDirectory, opts.backupDir || config.backupDir, opts.backupRetention ?? config.backupRetention);
  fastify.decorate('backupService', backupService);
  fastify.register(backupRoutes, { prefix: '/api/backups', backupService, authService, intervalHours });
  let backupTimer;
  fastify.addHook('onReady', async () => {
    if (!(intervalHours > 0)) return;
    const run = () => {
      try { backupService.create('scheduled'); }
      catch (error) { backupService.lastError = error.message; fastify.log.error(error, '自动备份失败'); }
    };
    const latest = backupService.list()[0];
    if (!latest || Date.now() - new Date(latest.created_at).getTime() >= intervalHours * 3600000) run();
    backupTimer = setInterval(run, intervalHours * 3600000);
    backupTimer.unref();
  });
  fastify.addHook('onClose', async () => clearInterval(backupTimer));

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  fastify.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Register API routes
  fastify.register(authRoutes, { prefix: '/api/auth', authService });
  fastify.register(childrenRoutes, { prefix: '/api/children', childrenService });
  fastify.register(templatesRoutes, { prefix: '/api/task-templates', tasksService });
  fastify.register(dailyTasksRoutes, { prefix: '/api/daily-tasks', tasksService });
  fastify.register(rewardsRoutes, { prefix: '/api', rewardsService });
  fastify.register(statsRoutes, { prefix: '/api', statsService });
  fastify.register(mistakesRoutes, { prefix: '/api/mistakes', mistakesService, uploadDir: uploadDirectory });
  fastify.register(charactersRoutes, { prefix: '/api/characters', charactersService });

  return fastify;
}

module.exports = buildApp;
