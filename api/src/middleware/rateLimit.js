const config = require('../config');
const { redis, keys } = require('../redis');
const { AppError } = require('../lib/errors');
const log = require('../lib/logger');

// Application-level rate limiting (token bucket in Redis).
// Nginx already limits per IP at the edge; this layer limits per USER on the
// expensive endpoints, which matters because many users can share one IP
// (college Wi-Fi, office NAT) and one user can rotate IPs.
//
//   name     - bucket family, e.g. "holds"
//   limits   - { capacity, refillPerSec }
//   keyFn    - how to identify the caller (user id, IP, ...)
function rateLimit(name, limits, keyFn = (req) => req.user?.id || req.ip) {
  return async (req, res, next) => {
    const id = keyFn(req);
    try {
      const [allowed, remaining, retryMs] = await redis.tokenBucket(
        keys.rateLimit(name, id),
        limits.capacity,
        limits.refillPerSec,
        1,
      );
      res.set('X-RateLimit-Limit', String(limits.capacity));
      res.set('X-RateLimit-Remaining', String(remaining));
      if (allowed === 1) return next();

      const retryAfterSec = Math.max(1, Math.ceil(retryMs / 1000));
      res.set('Retry-After', String(retryAfterSec));
      return next(
        new AppError(429, 'RATE_LIMITED', 'Too many requests, slow down', { retryAfterSec }),
      );
    } catch (err) {
      log.warn('rate limiter unavailable', { name, failMode: config.rateLimit.failMode, err: err.message });
      if (config.rateLimit.failMode === 'closed') {
        return next(new AppError(503, 'RATE_LIMITER_UNAVAILABLE', 'Please retry shortly'));
      }
      return next(); // fail open
    }
  };
}

module.exports = rateLimit;
