// Runs through mongos (see init-cluster.sh). Safe to run more than once.

function step(name, fn) {
  try {
    fn();
    print(`[init-sharding] ok: ${name}`);
  } catch (e) {
    // "already exists / already sharded" style errors are fine on re-runs.
    print(`[init-sharding] skip: ${name} (${e.codeName || e.message})`);
  }
}

const existing = db.adminCommand({ listShards: 1 }).shards.map((s) => s._id);
if (!existing.includes('shard-a')) step('add shard-a', () => sh.addShard('shard-a/a1:27017,a2:27017,a3:27017'));
if (!existing.includes('shard-b')) step('add shard-b', () => sh.addShard('shard-b/b1:27017,b2:27017,b3:27017'));

step('enable sharding on pollpulse', () => sh.enableSharding('pollpulse'));

const pp = db.getSiblingDB('pollpulse');

// ---------------------------------------------------------------------------
// votes: one document per (poll, user).  _id = "<pollId>:<userId>"
//
// Shard key = HASHED _id:
//   * even spread: even a single viral poll's votes land on every shard
//   * one vote per user per poll for free: _id is the shard key, so MongoDB
//     guarantees it is unique across the whole cluster (duplicate -> E11000)
// Trade-off: "all votes for poll X" must ask every shard (scatter-gather).
// Only the worker does that, once, when a poll closes.
// ---------------------------------------------------------------------------
step('shard votes on { _id: "hashed" }', () => sh.shardCollection('pollpulse.votes', { _id: 'hashed' }));
step('index votes { pollId, optionId }', () => pp.votes.createIndex({ pollId: 1, optionId: 1 }));

// ---------------------------------------------------------------------------
// tallies: sharded counters. Each (poll, option, region) has N counter
// documents; every vote increments a random one. Spreads the write load
// instead of hammering one "count" field.
// ---------------------------------------------------------------------------
step('shard tallies on { _id: "hashed" }', () => sh.shardCollection('pollpulse.tallies', { _id: 'hashed' }));
step('index tallies { pollId }', () => pp.tallies.createIndex({ pollId: 1 }));

// ---------------------------------------------------------------------------
// Two DEMO collections for the shard-key lesson (scripts/shard-key-demo.mjs).
// Same data, different shard keys:
//   demo_hashed   { _id: "hashed" } -> documents spread over both shards
//   demo_by_poll  { pollId: 1 }     -> every vote for one poll has the same
//                                      key, so they all sit in ONE chunk on
//                                      ONE shard (a "hot shard")
// ---------------------------------------------------------------------------
step('shard demo_hashed on { _id: "hashed" }', () => sh.shardCollection('pollpulse.demo_hashed', { _id: 'hashed' }));
step('shard demo_by_poll on { pollId: 1 }', () => sh.shardCollection('pollpulse.demo_by_poll', { pollId: 1 }));

print('[init-sharding] done');
sh.status();
