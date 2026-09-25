// MongoDB: the vote store. The API talks to the cluster through "mongos",
// the router, which forwards each operation to the right shard.
const { MongoClient, ReadPreference } = require('mongodb');
const config = require('../config');
const log = require('../lib/logger');

const client = new MongoClient(config.mongo.url, {
  serverSelectionTimeoutMS: config.mongo.serverSelectionTimeoutMs,
  maxPoolSize: 50,
  retryWrites: true, // safe: a retried vote hits the same _id
  appName: `pollpulse-${config.instanceId}`,
});

let connected;
function connect() {
  connected ||= client.connect().then(
    () => log.info('mongo connected', { url: config.mongo.url.replace(/\/\/.*@/, '//***@') }),
    (err) => {
      connected = null;
      throw err;
    },
  );
  return connected;
}

const db = () => client.db(config.mongo.db);
const votes = () => db().collection('votes');
const tallies = () => db().collection('tallies');

// Write concern for votes: acknowledged by a majority of the shard's replica
// set (2 of 3 regions). This is the "C" in our CP choice for votes: if a
// majority can't be reached, the vote is refused instead of risking loss.
function voteWriteConcern() {
  const w = /^\d+$/.test(config.mongo.voteWriteConcern) ? Number(config.mongo.voteWriteConcern) : config.mongo.voteWriteConcern;
  return { w, wtimeoutMS: config.mongo.voteWriteTimeoutMs };
}

// Read preferences used by the consistency demo.
//   strong   -> primary: always sees the latest acknowledged write
//   eventual -> nearest member in our region (may be a secondary that is
//               slightly behind)
//   causal   -> a causally consistent session: may read from a secondary,
//               but is guaranteed to see this client's own previous writes
function readPreferenceFor(consistency, region = config.region) {
  if (consistency === 'eventual' || consistency === 'causal') {
    // Prefer a member tagged with our region; fall back to any member.
    return new ReadPreference('nearest', [{ region }, {}]);
  }
  return ReadPreference.primary;
}

// ---------------------------------------------------------------------------
// Cluster status for the dashboard: which member of each shard is primary.
// Needs MONGO_SHARD_URIS (set in docker-compose). Without it (for example
// when running against a single MongoDB-compatible server) returns null.
// ---------------------------------------------------------------------------
const shardClients = new Map();
function parseShardUris() {
  return config.mongo.shardUris
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf('=');
      return { name: entry.slice(0, i), uri: entry.slice(i + 1) };
    });
}

async function clusterStatus() {
  const shards = parseShardUris();
  if (shards.length === 0) return null;
  return Promise.all(
    shards.map(async ({ name, uri }) => {
      try {
        if (!shardClients.has(name)) {
          shardClients.set(name, new MongoClient(uri, { serverSelectionTimeoutMS: 1500, directConnection: false }));
        }
        const c = shardClients.get(name);
        const admin = c.db('admin');
        const [status, cfg] = await Promise.all([
          admin.command({ replSetGetStatus: 1 }),
          admin.command({ replSetGetConfig: 1 }),
        ]);
        const regionByHost = Object.fromEntries(cfg.config.members.map((m) => [m.host, m.tags?.region || '?']));
        return {
          name,
          ok: true,
          members: status.members.map((m) => ({
            host: m.name,
            region: regionByHost[m.name],
            state: m.stateStr,
            healthy: m.health === 1,
            lagSec: m.optimeDate && status.members.find((x) => x.stateStr === 'PRIMARY')?.optimeDate
              ? Math.max(0, Math.round((status.members.find((x) => x.stateStr === 'PRIMARY').optimeDate - m.optimeDate) / 1000))
              : null,
          })),
        };
      } catch (err) {
        return { name, ok: false, error: err.message, members: [] };
      }
    }),
  );
}

// Votes per shard, from $collStats run through mongos (one row per shard).
async function shardDistribution(collection = 'votes') {
  try {
    const rows = await db().collection(collection).aggregate([{ $collStats: { count: {} } }]).toArray();
    return rows.map((r) => ({ shard: r.shard || 'single node', count: Number.isFinite(r.count) && r.count >= 0 ? r.count : null }));
  } catch (err) {
    return [];
  }
}

module.exports = {
  client, connect, db, votes, tallies, voteWriteConcern, readPreferenceFor, clusterStatus, shardDistribution,
};
