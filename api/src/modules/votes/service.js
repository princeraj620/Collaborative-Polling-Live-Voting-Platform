const {
  MongoServerError, MongoWriteConcernError, MongoServerSelectionError, MongoNetworkError, MongoNetworkTimeoutError, BSON,
} = require('mongodb');
const config = require('../../config');
const mongo = require('../../db/mongo');
const log = require('../../lib/logger');
const { redis, keys } = require('../../redis');
const { AppError, badRequest, conflict } = require('../../lib/errors');
const validate = require('../../lib/validate');
const polls = require('../polls/service');

const DUPLICATE_KEY = 11000;
// Server errors that mean "this shard has no usable primary right now"
// (election in progress, primary stepped down, node shutting down).
const NO_PRIMARY_CODES = new Set([91, 133, 189, 262, 10107, 11600, 11602, 13435, 13436]);
const MAX_TIME_EXPIRED = 50;
const causalKey = (userId) => `causal:${userId}`;

const voteId = (pollId, userId) => `${pollId}:${userId}`;

function isOpen(poll) {
  return poll.status === 'OPEN' && new Date(poll.closesAt) > new Date();
}

// ---------------------------------------------------------------------------
// Cast a vote
//
// 1. The vote's _id is "<pollId>:<userId>" and _id is the (hashed) shard key.
//    MongoDB enforces _id uniqueness across the whole cluster, so a second
//    vote by the same user is rejected with E11000. One vote per person, and
//    retries are harmless, with no locks and no extra "has voted?" lookup.
// 2. Written with w: "majority": 2 of the 3 regions must have it before we
//    say "counted". If a majority can't be reached we refuse (CP for votes).
// 3. Then a random counter document is incremented (sharded counter) for
//    the live results. That step is w: 1 and best-effort; the exact count is
//    recomputed from the votes themselves when the poll closes.
// ---------------------------------------------------------------------------
async function castVote(user, pollId, body) {
  const { poll } = await polls.getPoll(pollId, user.id);
  if (!isOpen(poll)) throw conflict('POLL_CLOSED', 'This poll is closed');

  const optionId = Number(body?.optionId);
  if (!poll.options.some((o) => o.id === optionId)) throw badRequest('optionId is not an option of this poll');
  const region = validate.region(body?.region, config.regions) || config.region;

  const vote = {
    _id: voteId(pollId, user.id),
    pollId,
    userId: user.id,
    optionId,
    region,
    createdAt: new Date(),
    via: config.instanceId,
  };

  // A causally consistent session: afterwards we remember the cluster time of
  // this write, so a later "causal" read can wait for any copy to catch up
  // to it (read-your-own-vote even from a secondary).
  const session = mongo.client.startSession({ causalConsistency: true });
  try {
    await mongo.votes().insertOne(vote, {
      session,
      writeConcern: mongo.voteWriteConcern(),
      // Upper bound for the whole operation, including waiting for a
      // majority or for a new primary to be elected.
      timeoutMS: config.mongo.voteTimeoutMs,
    });
    await rememberCausalTime(user.id, session);
  } catch (err) {
    if (err.code === DUPLICATE_KEY) return alreadyVoted(pollId, user.id, optionId);
    throw translateMongoError(err);
  } finally {
    await session.endSession().catch(() => {});
  }

  await Promise.all([incrementTally(pollId, optionId, region), recordStats(pollId, region)]);
  return { status: 'COUNTED', vote: publicVote(vote), writeConcern: config.mongo.voteWriteConcern };
}

async function alreadyVoted(pollId, userId, optionId) {
  const existing = await mongo.votes().findOne({ _id: voteId(pollId, userId) });
  if (existing && existing.optionId === optionId) {
    // Same vote sent again (double click, network retry): harmless.
    return { status: 'ALREADY_COUNTED', vote: publicVote(existing) };
  }
  throw conflict('ALREADY_VOTED', 'You have already voted in this poll. Votes are final.', {
    optionId: existing?.optionId,
  });
}

async function rememberCausalTime(userId, session) {
  if (!session.operationTime) return; // not reported by every server
  try {
    const value = BSON.EJSON.stringify({ operationTime: session.operationTime, clusterTime: session.clusterTime });
    await redis.set(causalKey(userId), value, 'EX', 600);
  } catch {
    /* best effort */
  }
}

function translateMongoError(err) {
  if (err.name === 'MongoOperationTimeoutError') {
    return new AppError(503, 'VOTE_NOT_CONFIRMED',
      'Voting is taking too long (the vote store may be electing a new primary). Please retry: retrying is safe and never double-counts.');
  }
  if (err instanceof MongoWriteConcernError || err.code === 64 || err.errInfo?.wtimeout) {
    // The primary has the vote but a majority didn't confirm in time. It may
    // or may not survive a failover, so we don't claim it's counted.
    return new AppError(503, 'VOTE_NOT_CONFIRMED',
      'Your vote could not be confirmed by enough servers. Please retry: retrying is safe and never double-counts.');
  }
  if (err instanceof MongoServerSelectionError || err instanceof MongoNetworkError
      || err instanceof MongoNetworkTimeoutError || (err instanceof MongoServerError && NO_PRIMARY_CODES.has(err.code))) {
    return new AppError(503, 'VOTE_STORE_UNAVAILABLE',
      'Voting is briefly unavailable for this shard (no primary). Please retry in a few seconds.');
  }
  return err;
}

async function incrementTally(pollId, optionId, region) {
  const n = Math.floor(Math.random() * config.counterShards);
  const filter = { _id: `${pollId}:${optionId}:${region}:${n}` };
  const update = { $inc: { count: 1 }, $setOnInsert: { pollId, optionId, region } };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mongo.tallies().updateOne(filter, update, { upsert: true, writeConcern: { w: 1 } });
      return;
    } catch (err) {
      // Two first-ever upserts of the same counter can race; retry once.
      if (err.code === DUPLICATE_KEY && attempt === 0) continue;
      // Live counts may now be 1 low. The final recount at close fixes it.
      log.warn('tally increment failed', { pollId, err: err.message });
      return;
    }
  }
}

async function recordStats(pollId, region) {
  const sec = Math.floor(Date.now() / 1000);
  try {
    await redis
      .multi()
      .incr(keys.votesPerSec(sec))
      .expire(keys.votesPerSec(sec), 180)
      .incr(keys.votesByRegionSec(region, sec))
      .expire(keys.votesByRegionSec(region, sec), 180)
      .incr(keys.votesTotal())
      .sadd(keys.activePolls(), pollId)
      .exec();
  } catch {
    /* stats are best-effort */
  }
}

// ---------------------------------------------------------------------------
// Read your own vote with a chosen consistency level (consistency demo).
//   strong   -> the shard's primary
//   eventual -> the nearest copy in `region` (may be a stale secondary)
//   causal   -> the nearest copy in `region`, but with afterClusterTime = the
//               time of this user's vote: a stale copy WAITS until it has
//               caught up instead of returning old data
// ---------------------------------------------------------------------------
async function getMyVote(user, pollId, consistency = 'strong', regionOverride = null) {
  const level = ['strong', 'eventual', 'causal'].includes(consistency) ? consistency : 'strong';
  const region = validate.region(regionOverride, config.regions) || config.region;
  const readPreference = mongo.readPreferenceFor(level, region);
  const filter = { _id: voteId(pollId, user.id) };
  const started = Date.now();
  let doc;
  let causalTime = false;
  try {
    if (level === 'causal') {
      const session = mongo.client.startSession({ causalConsistency: true });
      try {
        const saved = await redis.get(causalKey(user.id)).catch(() => null);
        if (saved) {
          const { operationTime, clusterTime } = BSON.EJSON.parse(saved, { relaxed: false });
          if (clusterTime) session.advanceClusterTime(clusterTime);
          session.advanceOperationTime(operationTime);
          causalTime = true;
        }
        doc = await mongo.votes().findOne(filter, { session, readPreference, maxTimeMS: config.mongo.causalReadMaxMs });
      } finally {
        await session.endSession();
      }
    } else {
      doc = await mongo.votes().findOne(filter, { readPreference });
    }
  } catch (err) {
    if (err.code === MAX_TIME_EXPIRED) {
      return {
        vote: null, consistency: level, region, readPreference: readPreference.mode, ms: Date.now() - started,
        waitedForCatchUp: true,
        message: `The ${region} copy is behind. A causal read waits for it instead of returning stale data (gave up after ${config.mongo.causalReadMaxMs} ms).`,
      };
    }
    throw translateMongoError(err);
  }
  return {
    vote: doc ? publicVote(doc) : null,
    consistency: level,
    region,
    readPreference: readPreference.mode,
    causalTime,
    ms: Date.now() - started,
  };
}

function publicVote(v) {
  return { pollId: v.pollId, optionId: v.optionId, region: v.region, createdAt: v.createdAt };
}

module.exports = { castVote, getMyVote, translateMongoError };
