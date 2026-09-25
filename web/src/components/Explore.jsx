import { useEffect, useState } from 'react';
import { api, fmt, timeLeft, shortDate } from '../api.js';
import { useLiveResults } from '../useLiveResults.js';

const TABS = [
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'Newest' },
  { id: 'closed', label: 'Closed' },
];

function LiveHero({ poll }) {
  const { results } = useLiveResults(poll.id);
  const top = results ? [...results.options].sort((a, b) => b.count - a.count) : [];
  return (
    <a href={`#/polls/${poll.id}`} className="live-hero">
      <div className="live-hero-copy">
        <span className="live-pill"><span className="dot" /> Live now</span>
        <h2>{poll.question}</h2>
        <p className="muted">
          <strong className="big-num">{fmt(results?.total ?? poll.voteCount)}</strong> {(results?.total ?? poll.voteCount) === 1 ? 'vote' : 'votes'} · {timeLeft(poll.closesAt)} · results pushed every second
        </p>
        <span className="primary fake-btn">Vote now →</span>
      </div>
      <div className="live-hero-bars">
        {top.map((o, i) => (
          <div key={o.optionId} className="mini-bar">
            <div className="mini-bar-top">
              <span>{o.label}</span>
              <strong>{o.pct}%</strong>
            </div>
            <div className="bar"><span className={`c${i}`} style={{ width: `${Math.max(o.pct, 1)}%` }} /></div>
          </div>
        ))}
        {!results && <p className="muted">Connecting to live results…</p>}
      </div>
    </a>
  );
}

function PollCard({ poll }) {
  const open = poll.status === 'OPEN';
  return (
    <a href={`#/polls/${poll.id}`} className="poll-card">
      <div className="poll-card-top">
        <span className={`chip cat-${poll.category}`}>{poll.category}</span>
        {open ? <span className="status live"><span className="dot" /> {timeLeft(poll.closesAt)}</span> : <span className="status">Closed</span>}
      </div>
      <h3>{poll.question}</h3>
      <div className="poll-card-meta muted small">
        <span><strong>{fmt(poll.voteCount)}</strong> {poll.voteCount === 1 ? 'vote' : 'votes'}</span>
        <span>{shortDate(poll.createdAt)}</span>
      </div>
    </a>
  );
}

export default function Explore() {
  const [tab, setTab] = useState('trending');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [hot, setHot] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api.polls('trending', '').then(({ data: d }) => setHot(d.polls[0] || null), () => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api.polls(tab, debounced).then(
      ({ data: d, headers }) => {
        if (cancelled) return;
        setData(d);
        setMeta({ readFrom: headers.get('x-read-from'), cache: headers.get('x-cache'), ms: d.queryMs });
      },
      (e) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [tab, debounced]);

  return (
    <section>
      {hot && <LiveHero poll={hot} />}

      <div className="explore-bar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id && !debounced}
              className={tab === t.id && !debounced ? 'tab active' : 'tab'}
              onClick={() => { setTab(t.id); setQ(''); }}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search 200,000+ polls: try “python”, “night trains”, “chess”" aria-label="Search polls" />
        </div>
      </div>

      {meta && (
        <p className="query-meta muted small">
          {debounced ? <>Full-text search for “{debounced}” · </> : null}
          {meta.cache === 'HIT'
            ? <>served from the <strong>Redis cache</strong></>
            : <>read from the PostgreSQL <strong>{meta.readFrom}</strong> · query took <strong>{meta.ms} ms</strong></>}
        </p>
      )}

      {error && <div className="notice error">{error}</div>}
      {!data ? (
        <div className="grid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="poll-card skeleton" />)}</div>
      ) : data.polls.length === 0 ? (
        <div className="card empty-state"><p>No polls found.</p></div>
      ) : (
        <div className="grid">{data.polls.map((p) => <PollCard key={p.id} poll={p} />)}</div>
      )}
    </section>
  );
}
