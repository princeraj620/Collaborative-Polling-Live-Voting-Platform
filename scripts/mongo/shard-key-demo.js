// Runs inside mongosh (see scripts/shard-key-demo.mjs).
// Inserts the same 20,000 votes for ONE poll into two collections that differ
// only in their shard key, then shows where the data went and how queries
// are routed.

const pp = db.getSiblingDB('pollpulse');
const N = 20000;
const POLL = 'viral-poll';

function load(name) {
  const coll = pp.getCollection(name);
  coll.deleteMany({});
  for (let start = 0; start < N; start += 2000) {
    const docs = [];
    for (let i = start; i < start + 2000; i++) {
      docs.push({ _id: `${POLL}:user-${i}`, pollId: POLL, optionId: 1 + (i % 4), region: ['mumbai', 'frankfurt', 'virginia'][i % 3] });
    }
    coll.insertMany(docs, { ordered: false, writeConcern: { w: 1 } });
  }
}

function perShard(name) {
  const rows = pp.getCollection(name).aggregate([{ $collStats: { count: {} } }]).toArray();
  const out = { 'shard-a': 0, 'shard-b': 0 };
  rows.forEach((r) => { out[r.shard] = r.count; });
  return out;
}

function bar(n, total) {
  const width = 36;
  const filled = Math.round((n / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function route(name, filter) {
  const e = pp.getCollection(name).find(filter).explain();
  const p = e.queryPlanner.winningPlan;
  return { stage: p.stage, shards: (p.shards || []).map((s) => s.shardName) };
}

print('\nShard-key demo: 20,000 votes for ONE viral poll\n');

const collections = [
  { name: 'demo_hashed', key: '{ _id: "hashed" }   (what PollPulse uses)' },
  { name: 'demo_by_poll', key: '{ pollId: 1 }       (the tempting mistake)' },
];

collections.forEach((c) => {
  load(c.name);
  const counts = perShard(c.name);
  print(`${c.name}   shard key ${c.key}`);
  Object.keys(counts).forEach((s) => {
    const pct = Math.round((counts[s] / N) * 100);
    print(`   ${s}  ${bar(counts[s], N)}  ${String(counts[s]).padStart(6)}  (${pct}%)`);
  });
  print('');
});

print('How mongos routes queries');
const q = [
  ['demo_hashed', { _id: `${POLL}:user-42` }, 'one user\'s vote'],
  ['demo_hashed', { pollId: POLL }, 'all votes of the poll'],
  ['demo_by_poll', { pollId: POLL }, 'all votes of the poll'],
];
q.forEach(([name, filter, what]) => {
  const r = route(name, filter);
  const kind = r.stage === 'SINGLE_SHARD' ? 'TARGETED   ' : 'SCATTER-GATHER';
  print(`   ${name.padEnd(13)} ${what.padEnd(22)} -> ${kind} ${r.stage} on [${r.shards.join(', ')}]`);
});

print(`
What this shows
  demo_hashed:  writes spread evenly over both shards, so both share the load.
                Looking up one vote goes to ONE shard. "All votes of a poll"
                asks EVERY shard (scatter-gather), which is fine because only
                the worker does that, once, when a poll closes.
  demo_by_poll: every vote of the viral poll has the same shard key, so they
                all land in ONE chunk on ONE shard. That shard does 100% of the
                work while the other sits idle, and the chunk can never be split
                (it is a "jumbo" chunk). Adding more shards would not help.
`);

pp.demo_hashed.deleteMany({});
pp.demo_by_poll.deleteMany({});
