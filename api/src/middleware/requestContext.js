const { randomUUID } = require('crypto');
const config = require('../config');
const log = require('../lib/logger');

// Attaches a request id (propagated from Nginx if present), tags every
// response with the instance that served it, and logs one line per request.
function requestContext(req, res, next) {
  const started = process.hrtime.bigint();
  req.id = req.get('x-request-id') || randomUUID();
  res.set('X-Request-Id', req.id);
  res.set('X-Served-By', config.instanceId);

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (req.path === '/api/health') return;
    log.info('request', {
      reqId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(ms * 10) / 10,
      user: req.user?.id,
    });
  });
  next();
}

module.exports = requestContext;
