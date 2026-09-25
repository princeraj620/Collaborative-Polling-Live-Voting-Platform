// ---------------------------------------------------------------------------
// Load test 2: double votes under load
//
// USERS users each send the SAME vote 5 times in parallel (like hammering the
// button or a flaky connection retrying). Every copy reaches the database
// (5 is within the per-user rate limit). Correct result: exactly USERS votes
// counted, never more.
//
//   USERS  number of users (default 300)
//
//   docker compose --profile loadtest run --rm k6 run /scripts/02-double-votes.js
// ---------------------------------------------------------------------------
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { BASE_URL, auth, loginMany, createPoll, waitForTotal } from './lib.js';

const USERS = Number(__ENV.USERS || 300);
const COPIES = 5;

const firstCounted = new Counter('counted_201');
const duplicates = new Counter('duplicates_200');
const other = new Counter('unexpected_status');
const overCount = new Counter('over_counted');

export const options = {
  setupTimeout: '300s',
  scenarios: {
    hammer: { executor: 'per-vu-iterations', vus: Math.min(USERS, 200), iterations: Math.ceil(USERS / Math.min(USERS, 200)), maxDuration: '120s' },
  },
  thresholds: {
    over_counted: ['count==0'],
    unexpected_status: ['count==0'],
    counted_201: [`count==${USERS}`],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'max'],
};

export function setup() {
  const tokens = loginMany(USERS, 'double');
  return { tokens, pollId: createPoll(tokens[0], `Double votes load test (${new Date().toISOString().slice(11, 19)} UTC)`) };
}

export default function ({ tokens, pollId }) {
  const i = exec.scenario.iterationInTest;
  if (i >= USERS) return;
  const req = ['POST', `${BASE_URL}/api/polls/${pollId}/votes`, JSON.stringify({ optionId: 1 + (i % 4) }), auth(tokens[i], { tags: { name: 'POST /votes (x5 same)' } })];
  const responses = http.batch(Array.from({ length: COPIES }, () => req));
  const created = responses.filter((r) => r.status === 201).length;
  firstCounted.add(created);
  duplicates.add(responses.filter((r) => r.status === 200).length);
  other.add(responses.filter((r) => r.status !== 201 && r.status !== 200).length);
  if (created > 1) overCount.add(created - 1);
  check(responses, { 'exactly one of the 5 copies counted': () => created === 1 });
}

export function teardown({ pollId }) {
  const total = waitForTotal(pollId, USERS);
  console.log(`Live results total: ${total} (expected exactly ${USERS})`);
  if (total !== USERS) overCount.add(Math.max(0, total - USERS));
}
