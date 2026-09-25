// Cache-aside helper (same ideas as Project 1):
//   * TTL in milliseconds, so live results can be cached for ~1 second
//   * single-flight: concurrent misses on one server share one DB query
//   * graceful degradation: if Redis is down, load straight from the source
const { redis } = require('../redis');
const log = require('./logger');

const inflight = new Map();

async function cached(key, ttlMs, loader) {
  if (ttlMs <= 0) return { value: await loader(), hit: false };
  try {
    const hit = await redis.get(key);
    if (hit) return { value: JSON.parse(hit), hit: true };
  } catch (err) {
    log.warn('cache read failed, using source', { key, err: err.message });
  }
  if (inflight.has(key)) return { value: await inflight.get(key), hit: false };

  const promise = (async () => {
    const value = await loader();
    if (value !== null && value !== undefined) {
      redis.set(key, JSON.stringify(value), 'PX', ttlMs).catch(() => {});
    }
    return value;
  })();
  inflight.set(key, promise);
  try {
    return { value: await promise, hit: false };
  } finally {
    inflight.delete(key);
  }
}

async function invalidate(...cacheKeys) {
  try {
    if (cacheKeys.length) await redis.del(...cacheKeys);
  } catch {
    /* stale for at most one TTL */
  }
}

module.exports = { cached, invalidate };
