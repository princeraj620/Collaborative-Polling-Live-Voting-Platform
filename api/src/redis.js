const Redis = require('ioredis');
const config = require('./config');
const log = require('./lib/logger');

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  commandTimeout: 1000,
  enableAutoPipelining: true,
});

let lastErrorLog = 0;
redis.on('error', (err) => {
  if (Date.now() - lastErrorLog > 5000) {
    lastErrorLog = Date.now();
    log.warn('redis error', { err: err.message });
  }
});

// Token bucket rate limiter, atomic inside Redis, using Redis' own clock.
// Same algorithm as Project 1. Returns { allowed, remaining, retry-after ms }.
redis.defineCommand('tokenBucket', {
  numberOfKeys: 1,
  lua: `
    local capacity = tonumber(ARGV[1])
    local rate     = tonumber(ARGV[2])
    local cost     = tonumber(ARGV[3])
    local t        = redis.call('TIME')
    local now      = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
    local data     = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
    local tokens   = tonumber(data[1])
    local ts       = tonumber(data[2])
    if tokens == nil then tokens = capacity; ts = now end
    tokens = math.min(capacity, tokens + math.max(0, now - ts) / 1000 * rate)
    local allowed, retry_ms = 0, 0
    if tokens >= cost then tokens = tokens - cost; allowed = 1
    else retry_ms = math.ceil((cost - tokens) / rate * 1000) end
    redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
    redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)
    return { allowed, math.floor(tokens), retry_ms }
  `,
});

const keys = {
  rateLimit: (name, id) => `rl:${name}:${id}`,
  poll: (pollId) => `cache:poll:${pollId}`,
  results: (pollId) => `cache:results:${pollId}`,
  feed: (sort, q, page) => `cache:feed:${sort}:${q}:${page}`,
  // votes accepted per second (for the dashboard chart)
  votesPerSec: (epochSec) => `stats:votes:${epochSec}`,
  votesTotal: () => 'stats:votes:total',
  votesByRegionSec: (region, epochSec) => `stats:votes:${region}:${epochSec}`,
  // polls that received votes recently (worker syncs their counts)
  activePolls: () => 'polls:active',
};

module.exports = { redis, keys };
