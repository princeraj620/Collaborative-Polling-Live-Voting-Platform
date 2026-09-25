const config = require('../../config');
const mongo = require('../../db/mongo');
const log = require('../../lib/logger');
const { redis, keys } = require('../../redis');
const { cached } = require('../../lib/cache');
const polls = require('../polls/service');

function shape(poll, counts, byRegion, extra) {
  const total = counts.reduce((s, c) => s + c, 0);
  return {
    pollId: poll.id,
    status: poll.status,
    closesAt: poll.closesAt,
    total,
    options: poll.options.map((o, i) => ({
      optionId: o.id,
      label: o.label,
      count: counts[i],
      pct: total ? Math.round((counts[i] / total) * 1000) / 10 : 0,
    })),
    byRegion,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

// Live results = sum of the sharded counters. The query goes to every shard
// (pollId isn't the shard key), so it's cached for ~1 s: no matter how many
// people are watching, each API server runs it at most once per second.
//
// readPreference primaryPreferred: normally read the primaries, but if a
// shard has no primary (failover, network partition) read a secondary
// instead. Live results favour Availability over Consistency (AP).
async function sumCounters(pollId) {
  return mongo
    .tallies()
    .aggregate(
      [
        { $match: { pollId } },
        { $group: { _id: { optionId: '$optionId', region: '$region' }, count: { $sum: '$count' } } },
      ],
      { readPreference: 'primaryPreferred', maxTimeMS: 3000 },
    )
    .toArray();
}

const lastGoodKey = (pollId) => `results:last:${pollId}`;

async function getResults(pollId) {
  const { poll } = await polls.getPoll(pollId);

  // Closed polls: exact results from the full recount, stored in Postgres.
  if (poll.status === 'CLOSED' && poll.finalResults) {
    const f = poll.finalResults;
    const counts = poll.options.map((o) => f.options.find((x) => x.optionId === o.id)?.count ?? 0);
    return {
      value: shape(poll, counts, f.byRegion || {}, {
        final: true, liveTotal: f.liveTotal ?? null, drift: f.drift ?? 0, countedAt: poll.closedAt,
      }),
      hit: false,
    };
  }

  try {
    return await cached(keys.results(pollId), config.cache.resultsTtlMs, async () => {
      const rows = await sumCounters(pollId);
      const counts = poll.options.map((o) => rows.filter((r) => r._id.optionId === o.id).reduce((s, r) => s + r.count, 0));
      const byRegion = Object.fromEntries(config.regions.map((r) => [r, 0]));
      for (const r of rows) byRegion[r._id.region] = (byRegion[r._id.region] || 0) + r.count;
      const value = shape(poll, counts, byRegion, { final: false, stale: false });
      redis.set(lastGoodKey(pollId), JSON.stringify(value), 'EX', 3600).catch(() => {});
      return value;
    });
  } catch (err) {
    // The vote store can't answer at all. Rather than an error, show the last
    // results we had, clearly marked as stale (AP: available, maybe old).
    const last = await redis.get(lastGoodKey(pollId)).catch(() => null);
    if (!last) throw err;
    log.warn('serving stale results', { pollId, err: err.message });
    return { value: { ...JSON.parse(last), stale: true }, hit: false };
  }
}

// ---------------------------------------------------------------------------
// Live results stream (Server-Sent Events)
//
// Each browser keeps ONE open HTTP connection. Per API server there is ONE
// timer per poll, no matter how many viewers: every second it loads the
// (cached) results once and fans the same message out to every connection.
// ---------------------------------------------------------------------------
class ResultsHub {
  constructor() {
    this.channels = new Map(); // pollId -> { clients: Set<res>, timer, last }
  }

  subscribe(pollId, res) {
    let ch = this.channels.get(pollId);
    if (!ch) {
      ch = { clients: new Set(), timer: null, last: null };
      this.channels.set(pollId, ch);
      ch.timer = setInterval(() => this.tick(pollId), config.liveResultsIntervalMs);
    }
    ch.clients.add(res);
    if (ch.last) res.write(ch.last);
    else this.tick(pollId);
    return () => this.unsubscribe(pollId, res);
  }

  unsubscribe(pollId, res) {
    const ch = this.channels.get(pollId);
    if (!ch) return;
    ch.clients.delete(res);
    if (ch.clients.size === 0) {
      clearInterval(ch.timer);
      this.channels.delete(pollId);
    }
  }

  async tick(pollId) {
    const ch = this.channels.get(pollId);
    if (!ch || ch.busy) return;
    ch.busy = true;
    try {
      const { value } = await getResults(pollId);
      ch.last = `event: results\ndata: ${JSON.stringify({ ...value, servedBy: config.instanceId, viewersHere: ch.clients.size })}\n\n`;
    } catch (err) {
      ch.last = `event: error-status\ndata: ${JSON.stringify({ message: 'Live results briefly unavailable' })}\n\n`;
      log.warn('live results failed', { pollId, err: err.message });
    } finally {
      ch.busy = false;
    }
    for (const res of ch.clients) res.write(ch.last);
  }

  stats() {
    let viewers = 0;
    for (const ch of this.channels.values()) viewers += ch.clients.size;
    return { channels: this.channels.size, viewers };
  }
}

const hub = new ResultsHub();

module.exports = { getResults, hub };
