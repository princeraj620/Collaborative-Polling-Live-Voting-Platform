// ---------------------------------------------------------------------------
// Load test 1: vote storm
//
// A TV show says "vote now". New votes arrive at a steady RATE per second,
// every vote from a different user, all for ONE poll, from all three regions.
// This is the write hot spot the whole design is built for: sharded votes,
// sharded counters, w: majority.
//
// At the end we check that the live results count every accepted vote.
//
//   RATE      votes per second      (default 200)
//   DURATION  seconds               (default 30)
//
//   docker compose --profile loadtest run --rm k6 run /scripts/01-vote-storm.js
// ---------------------------------------------------------------------------
import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Counter } from 'k6/metrics';
import { BASE_URL, REGIONS, auth, loginMany, createPoll, waitForTotal } from './lib.js';

const RATE = Number(__ENV.RATE || 200);
const DURATION = Number(__ENV.DURATION || 30);
const USERS = RATE * DURATION;

const counted = new Counter('votes_counted');
const refused = new Counter('votes_refused');

export const options = {
  setupTimeout: '300s',
  scenarios: {
    vote_storm: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${DURATION}s`,
      preAllocatedVUs: Math.max(50, RATE),
      maxVUs: RATE * 4,
    },
  },
  thresholds: {
    'http_req_duration{name:POST /votes}': ['p(95)<500'],
    'http_req_failed{name:POST /votes}': ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  console.log(`Signing in ${USERS} voters...`);
  const tokens = loginMany(USERS, 'storm');
  const pollId = createPoll(tokens[0], `Vote storm load test (${new Date().toISOString().slice(11, 19)} UTC)`);
  return { tokens, pollId };
}

export default function ({ tokens, pollId }) {
  const i = exec.scenario.iterationInTest;
  if (i >= tokens.length) return;
  const res = http.post(
    `${BASE_URL}/api/polls/${pollId}/votes`,
    JSON.stringify({ optionId: 1 + (i % 4), region: REGIONS[i % 3] }),
    auth(tokens[i], { tags: { name: 'POST /votes' } }),
  );
  if (res.status === 201) counted.add(1);
  else refused.add(1);
  check(res, { 'vote counted (201)': (r) => r.status === 201 });
}

export function teardown({ pollId }) {
  // Everything accepted must show up in the live results.
  const total = waitForTotal(pollId, 1);
  console.log(`Live results total for the storm poll: ${total}`);
}
