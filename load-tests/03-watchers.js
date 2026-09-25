// ---------------------------------------------------------------------------
// Load test 3: watchers (read-heavy traffic)
//
// While a vote is running, far more people WATCH than vote. This test sends a
// constant RATE of read requests:
//   70% live results of the hot poll   (sharded counters, cached 1 s)
//   20% trending feed                   (PostgreSQL replica, cached 5 s)
//   10% full-text search                (PostgreSQL replica, GIN index)
// and reports how much the caches absorb.
//
//   RATE      requests per second   (default 500)
//   DURATION  seconds               (default 30)
//
//   docker compose --profile loadtest run --rm k6 run /scripts/03-watchers.js
// ---------------------------------------------------------------------------
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL, HOT_POLL } from './lib.js';

const RATE = Number(__ENV.RATE || 500);
const DURATION = Number(__ENV.DURATION || 30);
const WORDS = ['python', 'coffee', 'night trains', 'chess', 'remote work', 'solar panels', 'podcasts', 'cricket', 'yoga', 'camping'];

const cacheHit = new Rate('cache_hit');

export const options = {
  scenarios: {
    watchers: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: `${DURATION}s`,
      preAllocatedVUs: Math.max(50, RATE / 4),
      maxVUs: RATE * 2,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:GET results}': ['p(95)<200'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const r = Math.random();
  let res;
  if (r < 0.7) {
    res = http.get(`${BASE_URL}/api/polls/${HOT_POLL}/results`, { tags: { name: 'GET results' } });
  } else if (r < 0.9) {
    res = http.get(`${BASE_URL}/api/polls?sort=trending`, { tags: { name: 'GET feed' } });
  } else {
    const q = WORDS[Math.floor(Math.random() * WORDS.length)];
    res = http.get(`${BASE_URL}/api/polls?q=${encodeURIComponent(q)}`, { tags: { name: 'GET search' } });
  }
  check(res, { 'status 200': (x) => x.status === 200 });
  cacheHit.add(res.headers['X-Cache'] === 'HIT');
}
