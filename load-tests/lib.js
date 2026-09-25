// Shared helpers for the k6 load tests.
import http from 'k6/http';
import { sleep } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
export const HOT_POLL = 'b0000000-0000-4000-8000-000000000001'; // "Who should win tonight's Talent Show final?"
export const REGIONS = ['mumbai', 'frankfurt', 'virginia'];
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const auth = (token, extra = {}) => ({ headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` }, ...extra });

// Logs in `count` new users, 100 at a time with http.batch.
export function loginMany(count, prefix) {
  const run = `${prefix}-${Date.now().toString(36)}`;
  const tokens = [];
  for (let start = 0; start < count; start += 100) {
    const reqs = [];
    for (let i = start; i < Math.min(count, start + 100); i++) {
      reqs.push(['POST', `${BASE_URL}/api/auth/login`, JSON.stringify({ email: `${run}-${i}@example.com`, name: `Voter ${i}` }), { headers: JSON_HEADERS, tags: { name: 'setup login' } }]);
    }
    for (const res of http.batch(reqs)) {
      if (res.status !== 200) {
        throw new Error(`login failed (${res.status}). Start the stack with: docker compose --env-file .env.loadtest up -d`);
      }
      tokens.push(res.json('token'));
    }
  }
  return tokens;
}

export function createPoll(token, question, options = ['A', 'B', 'C', 'D']) {
  const res = http.post(`${BASE_URL}/api/polls`, JSON.stringify({ question, options, durationMinutes: 120 }), auth(token, { tags: { name: 'setup create poll' } }));
  if (res.status !== 201) throw new Error(`could not create poll: ${res.status} ${res.body}`);
  return res.json('poll.id');
}

export function waitForTotal(pollId, expected, maxSeconds = 15) {
  let total = -1;
  for (let i = 0; i < maxSeconds * 2; i++) {
    total = http.get(`${BASE_URL}/api/polls/${pollId}/results`, { tags: { name: 'teardown results' } }).json('total');
    if (total >= expected) break;
    sleep(0.5);
  }
  return total;
}
