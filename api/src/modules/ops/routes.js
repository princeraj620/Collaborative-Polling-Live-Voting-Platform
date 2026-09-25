const express = require('express');
const config = require('../../config');
const pg = require('../../db/pg');
const mongo = require('../../db/mongo');
const { redis, keys } = require('../../redis');
const { cached } = require('../../lib/cache');
const results = require('../results/service');
const polls = require('../polls/service');

const router = express.Router();
const WINDOW_SEC = 60;

async function votesSeries() {
  const now = Math.floor(Date.now() / 1000) - 1; // last complete second
  const secs = Array.from({ length: WINDOW_SEC }, (_, i) => now - WINDOW_SEC + 1 + i);
  const regionKeys = config.regions.flatMap((r) => secs.map((s) => keys.votesByRegionSec(r, s)));
  const [totals, byRegion, allTime] = await Promise.all([
    redis.mget(secs.map((s) => keys.votesPerSec(s))),
    redis.mget(regionKeys),
    redis.get(keys.votesTotal()),
  ]);
  const series = totals.map((v) => Number(v) || 0);
  const regionSeries = Object.fromEntries(
    config.regions.map((r, ri) => [r, byRegion.slice(ri * WINDOW_SEC, (ri + 1) * WINDOW_SEC).map((v) => Number(v) || 0)]),
  );
  const last5 = series.slice(-5);
  return {
    perSecond: series,
    perRegion: regionSeries,
    current: Math.round(last5.reduce((a, b) => a + b, 0) / last5.length),
    peak: Math.max(0, ...series),
    total: Number(allTime) || 0,
  };
}

// Everything the ops dashboard shows, cached for 1 s.
router.get('/ops/overview', async (_req, res) => {
  const { value } = await cached('cache:ops:overview', 1000, async () => {
    const [votes, replication, cluster, shards, trending] = await Promise.all([
      votesSeries().catch(() => null),
      pg.replicationStatus(),
      cached('cache:ops:cluster', 3000, () => mongo.clusterStatus()).then((r) => r.value),
      cached('cache:ops:shards', 5000, () => mongo.shardDistribution('votes')).then((r) => r.value),
      polls.listPolls({ sort: 'trending' }).catch(() => ({ polls: [] })),
    ]);
    const hot = trending.polls[0]
      ? await results.getResults(trending.polls[0].id).then((r) => r.value).catch(() => null)
      : null;
    return {
      generatedAt: new Date().toISOString(),
      votes,
      replication,
      cluster,
      shards,
      hotPoll: hot && { question: trending.polls[0].question, ...hot },
      trending: trending.polls.slice(0, 5).map((p) => ({ id: p.id, question: p.question, voteCount: p.voteCount })),
    };
  });
  res.json({ ...value, servedBy: config.instanceId, region: config.region, liveViewersHere: results.hub.stats() });
});

module.exports = router;
