const config = require('../../config');
const pg = require('../../db/pg');
const { keys } = require('../../redis');
const { cached, invalidate } = require('../../lib/cache');
const { notFound } = require('../../lib/errors');

const POLL_COLUMNS = `
  p.id, p.question, p.description, p.category, p.status, p.visibility, p.created_at,
  p.closes_at, p.closed_at, p.vote_count, p.final_results, p.creator_id, u.name AS creator_name`;

function toPoll(row, options) {
  return {
    id: row.id,
    question: row.question,
    description: row.description,
    category: row.category,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    closesAt: row.closes_at,
    closedAt: row.closed_at,
    voteCount: row.vote_count,
    creator: row.creator_id ? { id: row.creator_id, name: row.creator_name } : null,
    options: options?.map((o) => ({ id: o.id, label: o.label })),
    finalResults: row.final_results || null,
  };
}

async function loadPoll(target, pollId) {
  const { rows } = await pg.read(
    target,
    `SELECT ${POLL_COLUMNS} FROM polls p LEFT JOIN users u ON u.id = p.creator_id WHERE p.id = $1`,
    [pollId],
  );
  if (!rows[0]) return null;
  const { rows: options } = await pg.read(target, `SELECT id, label FROM options WHERE poll_id = $1 ORDER BY id`, [pollId]);
  return toPoll(rows[0], options);
}

// One poll with its options. Cached for 30 s; invalidated when the poll
// closes. Read from the replica, but if the replica doesn't have it yet (a
// brand-new poll that hasn't been replicated), fall back to the primary.
// That fallback is a second, simpler read-your-writes technique.
async function getPoll(pollId, userId) {
  let readFrom = 'cache';
  const { value, hit } = await cached(keys.poll(pollId), config.cache.pollTtlSec * 1000, async () => {
    const target = await pg.readTarget(userId);
    let poll = await loadPoll(target, pollId);
    readFrom = target.from;
    if (!poll && target.from === 'replica') {
      poll = await loadPoll({ pool: pg.primary, from: 'primary' }, pollId);
      readFrom = 'primary (not on replica yet)';
    }
    return poll;
  });
  if (!value) throw notFound('Poll');
  return { poll: value, readFrom: hit ? 'cache' : readFrom };
}

const SORTS = {
  trending: `p.status = 'OPEN' AND p.visibility = 'public' ORDER BY p.vote_count DESC, p.created_at DESC`,
  new: `p.visibility = 'public' ORDER BY p.created_at DESC`,
  closed: `p.status = 'CLOSED' AND p.visibility = 'public' ORDER BY p.created_at DESC`,
};
const PAGE_SIZE = 20;

// Feeds and search. Always from the replica (public data, a few seconds of
// lag is fine), cached for 5 s.
async function listPolls({ sort = 'trending', q = '', page = 1 }) {
  const safeSort = SORTS[sort] ? sort : 'trending';
  const query = q.trim().slice(0, 100);
  const offset = (Math.max(1, Math.min(50, Number(page) || 1)) - 1) * PAGE_SIZE;

  const { value, hit } = await cached(keys.feed(safeSort, query, offset), config.cache.feedTtlSec * 1000, async () => {
    const target = await pg.readTarget(null);
    const started = Date.now();
    const sql = query
      ? `SELECT ${POLL_COLUMNS}, ts_rank(p.search, q) AS rank
         FROM polls p LEFT JOIN users u ON u.id = p.creator_id,
              websearch_to_tsquery('english', $1) q
         WHERE p.search @@ q AND p.visibility = 'public'
         ORDER BY rank DESC, p.created_at DESC
         LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`
      : `SELECT ${POLL_COLUMNS} FROM polls p LEFT JOIN users u ON u.id = p.creator_id
         WHERE ${SORTS[safeSort]} LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
    const { rows } = await pg.read(target, sql, query ? [query] : []);
    return {
      polls: rows.slice(0, PAGE_SIZE).map((r) => toPoll(r)),
      hasMore: rows.length > PAGE_SIZE,
      readFrom: target.from,
      queryMs: Date.now() - started,
    };
  });
  return { ...value, readFrom: hit ? 'cache' : value.readFrom, cache: hit ? 'HIT' : 'MISS' };
}

// "My polls": the read-your-writes demo lives here. With readYourWrites off,
// a poll you just created can be missing for a couple of seconds.
async function listMine(userId, { readYourWrites }) {
  const target = await pg.readTarget(userId, { readYourWrites });
  const { rows } = await pg.read(
    target,
    `SELECT ${POLL_COLUMNS} FROM polls p LEFT JOIN users u ON u.id = p.creator_id
     WHERE p.creator_id = $1 ORDER BY p.created_at DESC LIMIT 50`,
    [userId],
  );
  return { polls: rows.map((r) => toPoll(r)), readFrom: target.from, reason: target.reason };
}

async function createPoll(user, input) {
  const poll = await pg.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO polls (question, description, category, creator_id, visibility, closes_at)
       VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))
       RETURNING id`,
      [input.question, input.description, input.category, user.id, input.visibility, input.durationMinutes],
    );
    const pollId = rows[0].id;
    await tx.query(
      `INSERT INTO options (poll_id, id, label)
       SELECT $1, ord, label FROM unnest($2::text[]) WITH ORDINALITY AS t(label, ord)`,
      [pollId, input.options],
    );
    return pollId;
  });
  // Remember where the primary's log was right after this write, so this
  // user's next reads can avoid a replica that hasn't caught up yet.
  await pg.rememberWrite(user.id);
  const created = await loadPoll({ pool: pg.primary, from: 'primary' }, poll);
  return created;
}

async function invalidatePoll(pollId) {
  await invalidate(keys.poll(pollId), keys.results(pollId));
}

module.exports = { getPoll, listPolls, listMine, createPoll, invalidatePoll, toPoll };
