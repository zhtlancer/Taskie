const fs = require('fs');
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

const authRoutes = require('./routes/auth.routes');
const childrenRoutes = require('./routes/children.routes');
const templatesRoutes = require('./routes/templates.routes');
const dailyTasksRoutes = require('./routes/daily-tasks.routes');
const rewardsRoutes = require('./routes/rewards.routes');
const statsRoutes = require('./routes/stats.routes');
const mistakesRoutes = require('./routes/mistakes.routes');
const charactersRoutes = require('./routes/characters.routes');

function buildApp(opts = {}) {
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
  const db = opts.db || getDb(opts.dbPath);

  // Services
  const authService = new AuthService(db);
  const childrenService = new ChildrenService(db);
  const rewardsService = new RewardsService(db);
  const tasksService = new TasksService(db, rewardsService);
  const mistakesService = new MistakesService(db, uploadDirectory);
  const statsService = new StatsService(db);
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

  // JWT
  fastify.register(fastifyJwt, {
    secret: opts.jwtSecret || config.jwtSecret
  });

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
