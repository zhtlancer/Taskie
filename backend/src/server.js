const buildApp = require('./app');
const config = require('./config');
const { seedDemoData } = require('./db/seed');

const app = buildApp({
  logger: true
});

if (process.env.SEED_DEMO_DATA === 'true') {
  try {
    seedDemoData(app.db);
  } catch (err) {
    console.warn('Auto-seed demo data warning:', err.message);
  }
}

async function start() {
  try {
    const address = await app.listen({
      port: config.port,
      host: config.host
    });
    console.log(`🚀 Homework Management Backend running at: ${address}`);
    console.log(`📁 Uploads served from: ${config.uploadDir}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, closing server gracefully...`);
    try {
      await app.close();
      if (app.db) {
        app.db.close();
      }
      console.log('Server closed.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
});

start();
