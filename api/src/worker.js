// Background worker
//
//   1. Close due polls: when a poll's time is up, recount EVERY vote from the
//      vote store (exact), compare with the live counters, and publish the
//      final results to PostgreSQL.
//   2. Sync vote counts: copy live totals of recently active polls into
//      polls.vote_count so the "Trending" feed can sort by it.
//
// Run one worker. Both jobs are safe to run twice (SKIP LOCKED, idempotent
// updates), but proper leader election is Project 5's topic.
const config = require('./config');
const pg = require('./db/pg');
const mongo = require('./db/mongo');
const { redis, keys } = require('./redis');
const log = require('./lib/logger');
const polls = require('./modules/polls/service');

// --- 1. Close polls with an exact recount ------------------------------------
async function closeDuePolls() {
  const { rows: due } = await pg.primary.query(
    `SELECT id FROM polls WHERE status = 'OPEN' AND closes_at <= now() ORDER BY closes_at LIMIT 20`,
  );
  for (const { id } of due) await closePoll(id);
}

async function closePoll(pollId) {
  const { rows: options } = await pg.primary.query(`SELECT id, label FROM options WHERE poll_id = $1 ORDER BY id`, [pollId]);

  // Exact count straight from the votes (a scatter-gather query across all
  // shards), reading only majority-committed data from primaries.
  const exact = await mongo
    .votes()
    .aggregate(
      [{ $match: { pollId } }, { $group: { _id: { optionId: '$optionId', region: '$region' }, count: { $sum: 1 } } }],
      { readConcern: { level: 'majority' }, readPreference: 'primary' },
    )
    .toArray();

  // What the live counters said, to measure drift.
  const live = await mongo
    .tallies()
    .aggregate([{ $match: { pollId } }, { $group: { _id: null, count: { $sum: '$count' } } }])
    .toArray();

  const byRegion = {};
  for (const r of exact) byRegion[r._id.region] = (byRegion[r._id.region] || 0) + r.count;
  const final = {
    options: options.map((o) => ({
      optionId: o.id,
      label: o.label,
      count: exact.filter((r) => r._id.optionId === o.id).reduce((s, r) => s + r.count, 0),
    })),
    byRegion,
  };
  final.total = final.options.reduce((s, o) => s + o.count, 0);
  final.liveTotal = live[0]?.count ?? 0;
  final.drift = final.total - final.liveTotal;

  const { rowCount } = await pg.primary.query(
    `UPDATE polls SET status = 'CLOSED', closed_at = now(), vote_count = $2, final_results = $3
     WHERE id = $1 AND status = 'OPEN'`,
    [pollId, final.total, final],
  );
  if (rowCount) {
    await polls.invalidatePoll(pollId);
    log.info('poll closed', { pollId, total: final.total, liveTotal: final.liveTotal, drift: final.drift });
  }
}

// --- 2. Sync live totals for the Trending feed --------------------------------
async function syncVoteCounts() {
  const active = await redis.spop(keys.activePolls(), 500);
  if (!active || active.length === 0) return;
  const totals = await mongo
    .tallies()
    .aggregate([{ $match: { pollId: { $in: active } } }, { $group: { _id: '$pollId', count: { $sum: '$count' } } }])
    .toArray();
  for (const t of totals) {
    await pg.primary.query(`UPDATE polls SET vote_count = $2 WHERE id = $1 AND status = 'OPEN'`, [t._id, t.count]);
  }
}

// --- Scheduler -----------------------------------------------------------------
function every(name, intervalMs, job) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (err) {
      log.error('job failed', { job: name, err: err.message });
    } finally {
      running = false;
    }
  };
  tick();
  return setInterval(tick, intervalMs);
}

async function main() {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongo.connect();
      break;
    } catch (err) {
      log.warn('waiting for mongo', { attempt, err: err.message });
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const timers = [
    every('close-due-polls', config.worker.closeIntervalMs, closeDuePolls),
    every('sync-vote-counts', config.worker.syncCountsIntervalMs, syncVoteCounts),
  ];
  log.info('worker started');
  const shutdown = async () => {
    timers.forEach(clearInterval);
    await Promise.allSettled([pg.primary.end(), pg.replica?.end(), mongo.client.close(), redis.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
