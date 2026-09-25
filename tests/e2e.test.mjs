// End-to-end tests against a running stack (default http://localhost:8080).
// Run:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, uniqueEmail, vote, results, waitForTotal, sleep, POLLS } from '../scripts/lib/client.mjs';

const newPoll = (token, extra = {}) =>
  api('/polls', {
    method: 'POST',
    token,
    body: { question: `E2E test poll ${Date.now()}`, options: ['Red', 'Green', 'Blue'], durationMinutes: 60, ...extra },
  });

test('health: Postgres primary + replica, MongoDB and Redis are up', async () => {
  const res = await api('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.postgres, true);
  assert.equal(res.body.replica, true);
  assert.equal(res.body.mongo, true);
  assert.equal(res.body.redis, true);
});

test('load balancer spreads requests over the three regional API servers', async () => {
  const regions = new Set();
  for (let i = 0; i < 15; i++) regions.add((await api('/health')).body.region);
  assert.ok(regions.size >= 2, `saw regions: ${[...regions].join(', ')}`);
});

test('feeds and search are served from the read replica', async () => {
  const feed = await api('/polls?sort=new');
  assert.equal(feed.status, 200);
  assert.ok(feed.body.polls.length > 0);
  assert.ok(['replica', 'cache'].includes(feed.body.readFrom), `readFrom=${feed.body.readFrom}`);

  const search = await api(`/polls?q=${encodeURIComponent('night trains')}&page=${1 + Math.floor(Math.random() * 3)}`);
  assert.equal(search.status, 200);
  assert.ok(search.body.polls.length > 0, 'full-text search should find seeded polls');
  assert.ok(search.body.polls.every((p) => /night|train/i.test(p.question)));
});

test('a vote is counted once; resending it is safe; changing it is refused', async () => {
  const token = await login(uniqueEmail('voter'));
  const { body: created } = await newPoll(token);
  const pollId = created.poll.id;

  const first = await vote(token, pollId, 2, 'frankfurt');
  assert.equal(first.status, 201);
  assert.equal(first.body.status, 'COUNTED');

  const retry = await vote(token, pollId, 2);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'ALREADY_COUNTED');

  const change = await vote(token, pollId, 1);
  assert.equal(change.status, 409);
  assert.equal(change.body.error.code, 'ALREADY_VOTED');

  const r = await waitForTotal(pollId, 1);
  assert.equal(r.total, 1);
  assert.equal(r.options.find((o) => o.optionId === 2).count, 1);
  assert.equal(r.byRegion.frankfurt, 1);
});

test('20 parallel copies of the same vote are counted exactly once', async () => {
  const owner = await login(uniqueEmail('owner'));
  const { body: created } = await newPoll(owner);
  const token = await login(uniqueEmail('spammer'));
  // Different requests, same user, same instant, spread over all API servers.
  const responses = await Promise.all(Array.from({ length: 20 }, () => vote(token, created.poll.id, 3)));
  const statuses = responses.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 1, `statuses: ${statuses}`);
  assert.ok(statuses.every((s) => [201, 200, 429].includes(s)), `statuses: ${statuses}`);
  await sleep(1200);
  assert.equal((await results(created.poll.id)).total, 1);
});

test('many different voters are all counted (sharded counters add up)', async () => {
  const owner = await login(uniqueEmail('owner'));
  const { body: created } = await newPoll(owner);
  const voters = await Promise.all(Array.from({ length: 30 }, (_, i) => login(uniqueEmail(`v${i}`))));
  const regions = ['mumbai', 'frankfurt', 'virginia'];
  const res = await Promise.all(voters.map((t, i) => vote(t, created.poll.id, 1 + (i % 3), regions[i % 3])));
  assert.ok(res.every((r) => r.status === 201));
  const r = await waitForTotal(created.poll.id, 30);
  assert.equal(r.total, 30);
  assert.deepEqual(r.options.map((o) => o.count), [10, 10, 10]);
  assert.deepEqual([r.byRegion.mumbai, r.byRegion.frankfurt, r.byRegion.virginia], [10, 10, 10]);
});

test('read-your-writes: a new poll is always in "My polls" straight away', async () => {
  const token = await login(uniqueEmail('creator'));
  const { status, body } = await newPoll(token);
  assert.equal(status, 201);
  const mine = await api('/polls/mine', { token });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.polls.some((p) => p.id === body.poll.id), 'new poll must be visible to its creator');
  assert.equal(mine.body.readFrom, 'primary', 'replica is behind, so the read must go to the primary');
});

test('replication lag is real: without read-your-writes the replica misses the new poll', async () => {
  const token = await login(uniqueEmail('lag'));
  const { body } = await newPoll(token);
  const stale = await api('/polls/mine?ryw=off', { token });
  assert.equal(stale.body.readFrom, 'replica');
  assert.equal(stale.body.polls.some((p) => p.id === body.poll.id), false, 'replica should not have it yet');
  await sleep(3500); // demo apply delay is 2 s
  const later = await api('/polls/mine?ryw=off', { token });
  assert.ok(later.body.polls.some((p) => p.id === body.poll.id), 'replica should have caught up');
});

test('a brand-new poll page loads even before the replica has it', async () => {
  const token = await login(uniqueEmail('fresh'));
  const { body } = await newPoll(token);
  const page = await api(`/polls/${body.poll.id}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.poll.options.length, 3);
});

test('reading my vote back works at every consistency level', async () => {
  const token = await login(uniqueEmail('reader'));
  const { body } = await newPoll(token);
  await vote(token, body.poll.id, 1);
  for (const level of ['strong', 'causal', 'eventual']) {
    const res = await api(`/polls/${body.poll.id}/my-vote?consistency=${level}`, { token });
    assert.equal(res.status, 200);
    assert.equal(res.body.consistency, level);
    if (level !== 'eventual') assert.equal(res.body.vote?.optionId, 1, `${level} read must see the vote`);
  }
});

test('invalid votes are rejected', async () => {
  const token = await login(uniqueEmail('bad'));
  assert.equal((await vote(token, POLLS.tabsSpaces, 99)).status, 400);
  assert.equal((await vote(token, POLLS.tabsSpaces, 1, 'mars')).status, 400);
  assert.equal((await vote(token, POLLS.closed, 1)).status, 409);
  assert.equal((await api(`/polls/${POLLS.tabsSpaces}/votes`, { method: 'POST', body: { optionId: 1 } })).status, 401);
});

test('closed polls show exact final results from the recount', async () => {
  const r = await results(POLLS.closed);
  assert.equal(r.final, true);
  assert.equal(r.total, r.options.reduce((s, o) => s + o.count, 0));
});

test('invalid polls are rejected', async () => {
  const token = await login(uniqueEmail('maker'));
  assert.equal((await newPoll(token, { options: ['Only one'] })).status, 400);
  assert.equal((await newPoll(token, { options: ['Same', 'same'] })).status, 400);
  assert.equal((await newPoll(token, { question: 'Hi' })).status, 400);
});

test('per-user vote rate limit returns 429 with Retry-After', async () => {
  const token = await login(uniqueEmail('flood'));
  let limited;
  for (let i = 0; i < 12 && !limited; i++) {
    const res = await vote(token, POLLS.language, 1);
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, 'expected a 429');
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('live results stream (Server-Sent Events) pushes updates', async () => {
  const controller = new AbortController();
  const res = await fetch(`${process.env.BASE_URL || 'http://localhost:8080'}/api/polls/${POLLS.talentShow}/stream`, {
    signal: controller.signal,
  });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  let text = '';
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline && (text.match(/event: results/g) || []).length < 2) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  controller.abort();
  assert.ok((text.match(/event: results/g) || []).length >= 2, 'expected at least 2 pushed updates');
});
