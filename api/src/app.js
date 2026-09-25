const express = require('express');
const config = require('./config');
const pg = require('./db/pg');
const mongo = require('./db/mongo');
const { redis } = require('./redis');
const requestContext = require('./middleware/requestContext');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(requestContext);
  app.use((_req, res, next) => {
    res.set('X-Region', config.region);
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', async (_req, res) => {
    const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))]);
    const [postgres, replica, mongoOk, redisOk] = await Promise.all([
      withTimeout(pg.primary.query('SELECT 1')).then(() => true, () => false),
      pg.replica ? withTimeout(pg.replica.query('SELECT 1')).then(() => true, () => false) : Promise.resolve(null),
      withTimeout(mongo.db().command({ ping: 1 })).then(() => true, () => false),
      withTimeout(redis.ping()).then(() => true, () => false),
    ]);
    const ok = postgres && mongoOk;
    res.status(ok ? 200 : 503).json({
      status: ok ? (redisOk && replica !== false ? 'ok' : 'degraded') : 'down',
      instance: config.instanceId,
      region: config.region,
      postgres,
      replica,
      mongo: mongoOk,
      redis: redisOk,
    });
  });

  app.use('/api', require('./modules/auth/routes'));
  app.use('/api', require('./modules/polls/routes'));
  app.use('/api', require('./modules/votes/routes'));
  app.use('/api', require('./modules/results/routes'));
  app.use('/api', require('./modules/ops/routes'));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
