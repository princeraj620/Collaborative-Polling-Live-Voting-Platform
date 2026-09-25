const os = require('os');

const num = (value, fallback) => (value === undefined || value === '' ? fallback : Number(value));
const list = (value, fallback) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : fallback);

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),
  instanceId: process.env.INSTANCE_ID || os.hostname(),
  // The "region" this API server pretends to run in. Used as the default
  // region for votes and for region-aware reads (readPreference nearest).
  region: process.env.REGION || 'mumbai',
  regions: list(process.env.REGIONS, ['mumbai', 'frankfurt', 'virginia']),

  postgres: {
    primaryUrl: process.env.PG_PRIMARY_URL || 'postgres://pollpulse:pollpulse@localhost:5432/pollpulse',
    // Leave empty to send every read to the primary (no replica).
    replicaUrl: process.env.PG_REPLICA_URL || '',
    poolSize: num(process.env.PG_POOL_SIZE, 15),
    // Read-your-writes: after a user writes, route their reads to the primary
    // until the replica has caught up. Turn off to see the bug.
    readYourWrites: process.env.READ_YOUR_WRITES !== 'off',
  },

  mongo: {
    url: process.env.MONGO_URL || 'mongodb://localhost:27017',
    db: process.env.MONGO_DB || 'pollpulse',
    // Votes must be acknowledged by a majority of replica set members.
    voteWriteConcern: process.env.VOTE_WRITE_CONCERN || 'majority',
    voteWriteTimeoutMs: num(process.env.VOTE_WRITE_TIMEOUT_MS, 5000),
    // Hard limit for a whole vote write (incl. waiting for a new primary).
    voteTimeoutMs: num(process.env.VOTE_TIMEOUT_MS, 8000),
    // How long a "causal" read may wait for a lagging copy to catch up.
    causalReadMaxMs: num(process.env.CAUSAL_READ_MAX_MS, 3000),
    // Optional direct connections to each shard's replica set, used only by
    // the dashboard to show which member is primary in each region.
    //   "shard-a=mongodb://a1,a2,a3/?replicaSet=shard-a;shard-b=..."
    shardUris: process.env.MONGO_SHARD_URIS || '',
    serverSelectionTimeoutMs: num(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS, 5000),
  },

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtTtl: process.env.JWT_TTL || '12h',

  // Number of counter documents per (poll, option, region).
  counterShards: num(process.env.COUNTER_SHARDS, 16),

  cache: {
    resultsTtlMs: num(process.env.CACHE_RESULTS_TTL_MS, 1000),
    pollTtlSec: num(process.env.CACHE_POLL_TTL_SEC, 30),
    feedTtlSec: num(process.env.CACHE_FEED_TTL_SEC, 5),
  },

  liveResultsIntervalMs: num(process.env.LIVE_RESULTS_INTERVAL_MS, 1000),

  rateLimit: {
    failMode: process.env.RATE_LIMIT_FAIL_MODE || 'open',
    votes: { capacity: num(process.env.RL_VOTES_CAPACITY, 5), refillPerSec: num(process.env.RL_VOTES_REFILL, 1) },
    createPoll: { capacity: num(process.env.RL_CREATE_CAPACITY, 5), refillPerSec: num(process.env.RL_CREATE_REFILL, 0.1) },
    login: { capacity: num(process.env.RL_LOGIN_CAPACITY, 20), refillPerSec: num(process.env.RL_LOGIN_REFILL, 2) },
  },

  worker: {
    closeIntervalMs: num(process.env.CLOSE_INTERVAL_MS, 5000),
    syncCountsIntervalMs: num(process.env.SYNC_COUNTS_INTERVAL_MS, 5000),
  },
};

module.exports = config;
