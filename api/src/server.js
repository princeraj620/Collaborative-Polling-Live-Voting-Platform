const config = require('./config');
const createApp = require('./app');
const pg = require('./db/pg');
const mongo = require('./db/mongo');
const { redis } = require('./redis');
const log = require('./lib/logger');

async function start() {
  // Connect to the vote store before accepting traffic (retry while the
  // cluster is still starting up).
  for (let attempt = 1; ; attempt++) {
    try {
      await mongo.connect();
      break;
    } catch (err) {
      log.warn('waiting for mongo', { attempt, err: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const app = createApp();
  const server = app.listen(config.port, () => log.info('api listening', { port: config.port, region: config.region }));
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    server.close(async () => {
      await Promise.allSettled([pg.primary.end(), pg.replica?.end(), mongo.client.close(), redis.quit()]);
      process.exit(0);
    });
    // Live-result streams never end on their own; don't wait for them.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err: String(err) }));
start();
