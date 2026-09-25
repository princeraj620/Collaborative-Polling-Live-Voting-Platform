// PostgreSQL: one pool for the PRIMARY (all writes) and one for the READ
// REPLICA (browsing and search). Also implements read-your-writes routing.
const { Pool, types } = require('pg');
const config = require('../config');
const log = require('../lib/logger');
const { redis } = require('../redis');

types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number

function makePool(url, name) {
  const pool = new Pool({
    connectionString: url,
    max: config.postgres.poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
  });
  pool.on('error', (err) => log.error('pg pool error', { pool: name, err: err.message }));
  return pool;
}

const primary = makePool(config.postgres.primaryUrl, 'primary');
const replica = config.postgres.replicaUrl ? makePool(config.postgres.replicaUrl, 'replica') : null;

// If the replica fails, stop using it for a few seconds (circuit breaker)
// and read from the primary instead.
let replicaDownUntil = 0;
function markReplicaDown(err) {
  if (Date.now() > replicaDownUntil) log.warn('replica unavailable, reading from primary', { err: err.message });
  replicaDownUntil = Date.now() + 5000;
}

async function withTransaction(fn) {
  const client = await primary.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Read-your-writes
//
// The replica applies changes a little late (replication lag). So if a user
// creates a poll and then opens "My polls" from the replica, their poll can
// be missing. Fix: remember the primary's WAL position (LSN) right after the
// user's write. When that user reads, check whether the replica has replayed
// up to that position; if not, read from the primary.
// ---------------------------------------------------------------------------
const rywKey = (userId) => `ryw:${userId}`;

async function rememberWrite(userId) {
  if (!replica || !userId) return;
  try {
    const { rows } = await primary.query('SELECT pg_current_wal_lsn()::text AS lsn');
    await redis.set(rywKey(userId), rows[0].lsn, 'EX', 60);
  } catch (err) {
    log.warn('could not record write position', { err: err.message });
  }
}

// Returns { pool, from, reason } for a read by this user.
async function readTarget(userId, { readYourWrites = config.postgres.readYourWrites } = {}) {
  if (!replica) return { pool: primary, from: 'primary', reason: 'no-replica' };
  if (Date.now() < replicaDownUntil) return { pool: primary, from: 'primary', reason: 'replica-down' };

  if (readYourWrites && userId) {
    let lsn = null;
    try {
      lsn = await redis.get(rywKey(userId));
    } catch {
      // Redis down: be safe and read from the primary.
      return { pool: primary, from: 'primary', reason: 'read-your-writes' };
    }
    if (lsn) {
      try {
        const { rows } = await replica.query('SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS caught_up', [lsn]);
        if (!rows[0].caught_up) return { pool: primary, from: 'primary', reason: 'read-your-writes' };
        redis.del(rywKey(userId)).catch(() => {});
      } catch (err) {
        markReplicaDown(err);
        return { pool: primary, from: 'primary', reason: 'replica-down' };
      }
    }
  }
  return { pool: replica, from: 'replica', reason: 'default' };
}

// Runs a read query on the chosen target, falling back to the primary if the
// replica errors.
async function read(target, text, params) {
  try {
    return await target.pool.query(text, params);
  } catch (err) {
    if (target.pool === replica) {
      markReplicaDown(err);
      target.from = 'primary';
      target.reason = 'replica-down';
      return primary.query(text, params);
    }
    throw err;
  }
}

// Replication status for the dashboard.
async function replicationStatus() {
  if (!replica) return { enabled: false };
  try {
    // Lag is measured by the PRIMARY (pg_stat_replication.replay_lag): the
    // time between a change being written on the primary and the replica
    // applying it. PostgreSQL reports NULL once the replica is fully caught
    // up and idle, which we show as 0.
    const [{ rows: r }, { rows: p }] = await Promise.all([
      replica.query(`
        SELECT pg_is_in_recovery() AS in_recovery,
               COALESCE(pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()), 0)::bigint AS pending_bytes,
               current_setting('recovery_min_apply_delay') AS apply_delay`),
      primary.query(`
        SELECT count(*)::int AS replicas,
               COALESCE(max(EXTRACT(EPOCH FROM replay_lag) * 1000), 0) AS lag_ms
        FROM pg_stat_replication WHERE state = 'streaming'`),
    ]);
    const pendingBytes = Number(r[0].pending_bytes);
    return {
      enabled: true,
      healthy: r[0].in_recovery,
      lagMs: pendingBytes === 0 ? 0 : Math.round(Number(p[0].lag_ms) || 0),
      pendingBytes,
      applyDelay: r[0].apply_delay,
      streamingReplicas: p[0].replicas,
    };
  } catch (err) {
    return { enabled: true, healthy: false, error: err.message };
  }
}

const PG = { UNIQUE_VIOLATION: '23505', CHECK_VIOLATION: '23514' };

module.exports = { primary, replica, withTransaction, rememberWrite, readTarget, read, replicationStatus, PG };
