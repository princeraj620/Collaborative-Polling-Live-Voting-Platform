// API client, session, region preference and the request log behind the
// "Under the hood" panel.
const TOKEN_KEY = 'pollpulse.token';
const USER_KEY = 'pollpulse.user';
const REGION_KEY = 'pollpulse.region';

export const REGIONS = [
  { id: 'mumbai', label: 'Mumbai', color: '#f472b6' },
  { id: 'frankfurt', label: 'Frankfurt', color: '#22d3ee' },
  { id: 'virginia', label: 'Virginia', color: '#a3e635' },
];
export const regionColor = (id) => REGIONS.find((r) => r.id === id)?.color || '#8b5cf6';
export const regionLabel = (id) => REGIONS.find((r) => r.id === id)?.label || id;

function safeGet(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* in-memory only */
  }
}

let token = safeGet(TOKEN_KEY);
export function getSession() {
  const raw = safeGet(USER_KEY);
  return token && raw ? { token, user: JSON.parse(raw) } : null;
}
export function setSession(session) {
  token = session?.token ?? null;
  safeSet(TOKEN_KEY, token);
  safeSet(USER_KEY, session ? JSON.stringify(session.user) : null);
  window.dispatchEvent(new Event('pollpulse:session'));
}
export const getRegion = () => safeGet(REGION_KEY) || 'mumbai';
export function setRegion(region) {
  safeSet(REGION_KEY, region);
  window.dispatchEvent(new Event('pollpulse:region'));
}

// ---- request log ----------------------------------------------------------
const requestLog = [];
const listeners = new Set();
const pollStats = { total: 0, hits: 0 };
function notify() {
  listeners.forEach((fn) => fn([...requestLog], { ...pollStats }));
}
export function subscribeToRequests(fn) {
  listeners.add(fn);
  fn([...requestLog], { ...pollStats });
  return () => listeners.delete(fn);
}
export function logEvent(entry) {
  requestLog.unshift({ id: crypto.randomUUID(), ...entry });
  requestLog.length = Math.min(requestLog.length, 14);
  notify();
}

export class ApiError extends Error {
  constructor(status, body, headers) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
    this.retryAfter = Number(headers?.get('retry-after') || 0);
  }
}

export async function request(path, { method = 'GET', body, quiet = false } = {}) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    logEvent({ method, path, status: 'ERR', ms: Math.round(performance.now() - started) });
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'Network error. Check your connection.' } });
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (quiet && res.ok) {
    pollStats.total += 1;
    if (res.headers.get('x-cache') === 'HIT') pollStats.hits += 1;
    notify();
  } else {
    logEvent({
      method,
      path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, (m) => m.slice(0, 8) + '…'),
      status: res.status,
      servedBy: res.headers.get('x-served-by'),
      region: res.headers.get('x-region'),
      readFrom: res.headers.get('x-read-from') || res.headers.get('x-read-preference'),
      cache: res.headers.get('x-cache'),
      ms: Math.round(performance.now() - started),
    });
  }
  if (res.status === 401 && token) setSession(null);
  if (!res.ok) throw new ApiError(res.status, data, res.headers);
  return { data, headers: res.headers };
}

const get = (p, o) => request(p, o).then((r) => r.data);

export const api = {
  login: (email, name) => get('/auth/login', { method: 'POST', body: { email, name } }),
  polls: (sort, q) => request(`/polls?sort=${sort}&q=${encodeURIComponent(q || '')}`),
  poll: (id) => get(`/polls/${id}`),
  mine: (ryw) => request(`/polls/mine${ryw ? '' : '?ryw=off'}`),
  create: (body) => get('/polls', { method: 'POST', body }),
  vote: (pollId, optionId, region) => get(`/polls/${pollId}/votes`, { method: 'POST', body: { optionId, region } }),
  myVote: (pollId, consistency) => get(`/polls/${pollId}/my-vote?consistency=${consistency}`),
  results: (pollId) => get(`/polls/${pollId}/results`, { quiet: true }),
  ops: () => get('/ops/overview', { quiet: true }),
  health: () => get('/health', { quiet: true }),
};

// Send the user to the sign-in page, then back here afterwards.
export function goLogin() {
  const current = window.location.hash.replace(/^#/, '') || '/';
  window.location.hash = `/login?next=${encodeURIComponent(current)}`;
}

export const fmt = (n) => (n ?? 0).toLocaleString('en-IN');

export function timeLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'closing…';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m left`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

export const shortDate = (iso) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
