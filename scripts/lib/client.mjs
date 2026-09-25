// Tiny zero-dependency client shared by the demo scripts and the e2e tests.
// Requires Node 20+ (global fetch).

export const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');

export const POLLS = {
  talentShow: 'b0000000-0000-4000-8000-000000000001', // the hot poll load tests hammer
  language: 'b0000000-0000-4000-8000-000000000002',
  tabsSpaces: 'b0000000-0000-4000-8000-000000000003',
  streetFood: 'b0000000-0000-4000-8000-000000000004',
  teaCoffee: 'b0000000-0000-4000-8000-000000000007', // closes ~20 min after setup
  closed: 'b0000000-0000-4000-8000-000000000010',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, headers: res.headers, body: json };
}

// Logs in, retrying politely if the per-IP login limit kicks in.
export async function login(email, name = email.split('@')[0]) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const res = await api('/auth/login', { method: 'POST', body: { email, name } });
    if (res.status === 200) return res.body.token;
    if (res.status !== 429 && res.status !== 503) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
    await sleep(Number(res.headers.get('retry-after') || 1) * 1000 + Math.random() * 250);
  }
  throw new Error('login kept getting rate limited');
}

export const uniqueEmail = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const vote = (token, pollId, optionId, region) =>
  api(`/polls/${pollId}/votes`, { method: 'POST', token, body: { optionId, region } });

export async function results(pollId) {
  return (await api(`/polls/${pollId}/results`)).body;
}

// Waits until the live results for a poll reach `total` (they are cached ~1 s).
export async function waitForTotal(pollId, total, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await results(pollId);
    if (last.total >= total) return last;
    await sleep(300);
  }
  return last;
}

// Pretty console output
export const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};
export const step = (n, text) => console.log(`\n${c.cyan(`[${n}]`)} ${c.bold(text)}`);
