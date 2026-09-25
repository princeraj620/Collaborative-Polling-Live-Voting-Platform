import { useEffect, useRef, useState } from 'react';
import { api, fmt, timeLeft, shortDate, getRegion, regionColor, regionLabel, REGIONS, goLogin } from '../api.js';
import { useLiveResults } from '../useLiveResults.js';

function ResultBars({ results, myOptionId }) {
  const max = Math.max(1, ...results.options.map((o) => o.count));
  return (
    <div className="result-bars">
      {results.options.map((o, i) => {
        const leader = o.count === max && o.count > 0;
        return (
          <div key={o.optionId} className={`result-row ${myOptionId === o.optionId ? 'mine' : ''}`}>
            <div className="result-label">
              <span>{o.label}{myOptionId === o.optionId && <em className="your-pick">your vote</em>}</span>
              <span className="mono">{fmt(o.count)} · <strong>{o.pct}%</strong></span>
            </div>
            <div className="bar big"><span className={`c${i} ${leader ? 'leader' : ''}`} style={{ width: `${Math.max(o.pct, 0.5)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function RegionSplit({ byRegion }) {
  const total = Object.values(byRegion || {}).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="region-split">
      <div className="region-bar">
        {REGIONS.map((r) => (
          <span key={r.id} style={{ width: `${((byRegion?.[r.id] || 0) / total) * 100}%`, background: r.color }} title={`${r.label}: ${byRegion?.[r.id] || 0}`} />
        ))}
      </div>
      <div className="region-legend small">
        {REGIONS.map((r) => (
          <span key={r.id}><i style={{ background: r.color }} />{r.label} <strong>{fmt(byRegion?.[r.id] || 0)}</strong></span>
        ))}
      </div>
    </div>
  );
}

// Read your own vote back with different consistency levels.
function ConsistencyCheck({ pollId }) {
  const [rows, setRows] = useState({});
  const run = async (level) => {
    setRows((r) => ({ ...r, [level]: { loading: true } }));
    try {
      const res = await api.myVote(pollId, level);
      setRows((r) => ({ ...r, [level]: res }));
    } catch (e) {
      setRows((r) => ({ ...r, [level]: { error: e.message } }));
    }
  };
  const levels = [
    { id: 'strong', label: 'Strong', hint: 'Read from the shard primary. Always sees your vote.' },
    { id: 'eventual', label: 'Eventual', hint: 'Nearest copy in your region. May be a moment behind.' },
    { id: 'causal', label: 'Causal', hint: 'Nearest copy, but guaranteed to include your own writes.' },
  ];
  return (
    <div className="card consistency">
      <h3>Read my vote back</h3>
      <p className="muted small">The same question asked with three consistency levels.</p>
      {levels.map((l) => {
        const r = rows[l.id];
        return (
          <div key={l.id} className="consistency-row">
            <button className="ghost small" onClick={() => run(l.id)}>{l.label}</button>
            <div className="consistency-out small">
              {!r && <span className="muted">{l.hint}</span>}
              {r?.loading && <span className="muted">Reading…</span>}
              {r?.error && <span className="bad">{r.error}</span>}
              {r && !r.loading && !r.error && (
                r.vote
                  ? <span className="good">Found your vote · readPreference <code>{r.readPreference}</code> · {r.ms} ms</span>
                  : r.waitedForCatchUp
                    ? <span className="warn">{r.message}</span>
                    : <span className="warn">Not visible yet on this copy (stale read) · {r.ms} ms</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PollPage({ pollId, session }) {
  const [poll, setPoll] = useState(null);
  const [error, setError] = useState('');
  const [myVote, setMyVote] = useState(null);
  const [voteMsg, setVoteMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [region, setRegionState] = useState(getRegion);
  const { results, status } = useLiveResults(pollId, !!poll);
  const [pulse, setPulse] = useState(false);
  const lastTotal = useRef(null);

  useEffect(() => {
    api.poll(pollId).then((d) => setPoll(d.poll), (e) => setError(e.message));
  }, [pollId]);

  useEffect(() => {
    const on = () => setRegionState(getRegion());
    window.addEventListener('pollpulse:region', on);
    return () => window.removeEventListener('pollpulse:region', on);
  }, []);

  // Did I already vote? (strong read)
  useEffect(() => {
    if (!session || !poll) return;
    api.myVote(pollId, 'strong').then((r) => r.vote && setMyVote(r.vote), () => {});
  }, [session, poll, pollId]);

  useEffect(() => {
    if (!results) return;
    if (lastTotal.current !== null && results.total !== lastTotal.current) {
      setPulse(true);
      setTimeout(() => setPulse(false), 600);
    }
    lastTotal.current = results.total;
  }, [results]);

  const vote = async (optionId) => {
    if (!session) return goLogin();
    setBusy(optionId);
    setVoteMsg(null);
    try {
      const r = await api.vote(pollId, optionId, region);
      setMyVote(r.vote);
      setVoteMsg(r.status === 'COUNTED'
        ? { tone: 'good', text: `Vote counted. Saved on a majority of replicas (w: ${r.writeConcern}) from ${regionLabel(r.vote.region)}.` }
        : { tone: 'good', text: 'You already voted for this. Sending it again is safe: it is counted once.' });
    } catch (e) {
      if (e.code === 'ALREADY_VOTED') {
        setMyVote({ optionId: e.details?.optionId });
        setVoteMsg({ tone: 'warn', text: 'You already voted in this poll. Votes are final.' });
      } else if (e.status === 429) {
        setVoteMsg({ tone: 'warn', text: `Slow down! Try again in ${e.retryAfter || 1}s.` });
      } else {
        setVoteMsg({ tone: 'error', text: e.message });
      }
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="notice error">{error} <a href="#/">Back to polls</a></div>;
  if (!poll) return <div className="loading">Loading poll…</div>;

  const open = results ? results.status === 'OPEN' && !results.final : poll.status === 'OPEN';
  const showResults = results && (myVote || !open);

  return (
    <section className="poll-page">
      <a href="#/" className="back">← All polls</a>
      <div className="poll-layout">
        <div>
          <div className="poll-head">
            <span className={`chip cat-${poll.category}`}>{poll.category}</span>
            {open
              ? <span className="status live"><span className="dot" /> Live · {timeLeft(poll.closesAt)}</span>
              : <span className="status">Closed {poll.closedAt ? `· ${shortDate(poll.closedAt)}` : ''}</span>}
          </div>
          <h1>{poll.question}</h1>
          {poll.description && <p className="muted lede-small">{poll.description}</p>}

          <div className="card vote-card">
            {open && !myVote && (
              <>
                <p className="muted small vote-hint">Pick one. Voting from <strong style={{ color: regionColor(region) }}>{regionLabel(region)}</strong> (change it at the top).</p>
                <div className="vote-options">
                  {poll.options.map((o, i) => (
                    <button key={o.id} className={`vote-btn c${i}`} disabled={busy !== null} onClick={() => vote(o.id)}>
                      <span className="vote-letter">{String.fromCharCode(65 + i)}</span>
                      <span>{o.label}</span>
                      {busy === o.id && <span className="spinner" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              </>
            )}
            {voteMsg && <div className={`notice ${voteMsg.tone}`}>{voteMsg.text}</div>}
            {showResults && (
              <>
                <div className="results-head">
                  <h2>{results.final ? 'Final results' : 'Live results'}</h2>
                  <span className={`total ${pulse ? 'pulse' : ''}`}><strong>{fmt(results.total)}</strong> {results.total === 1 ? 'vote' : 'votes'}</span>
                </div>
                {results.stale && (
                  <div className="notice warn">
                    The vote store can't be reached right now, so these are the last known results (they may be a little old).
                    Live results stay <strong>available</strong>; new votes are paused until a majority is back.
                  </div>
                )}
                <ResultBars results={results} myOptionId={myVote?.optionId} />
                {results.final ? (
                  <p className="muted small drift-note">
                    Exact recount of every vote when the poll closed. The live counter showed {fmt(results.liveTotal)}; the
                    recount found {fmt(results.total)} ({results.drift === 0 ? 'no drift' : `drift of ${results.drift}`}).
                  </p>
                ) : (
                  <p className="muted small live-note">
                    <span className={`dot ${status}`} /> {status === 'live' ? 'Live' : status} · pushed every second from{' '}
                    <code>{results.servedBy}</code> · counted with sharded counters
                  </p>
                )}
              </>
            )}
            {open && !myVote && !showResults && <p className="muted small">Results appear after you vote.</p>}
          </div>
        </div>

        <aside className="poll-side">
          {results && (
            <div className="card">
              <h3>Votes by region</h3>
              <p className="muted small">Where the votes came from.</p>
              <RegionSplit byRegion={results.byRegion} />
            </div>
          )}
          {session && myVote && <ConsistencyCheck pollId={pollId} />}
          <div className="card how">
            <h3>What happens when you vote</h3>
            <ol className="small">
              <li>Your vote is stored as <code>{`{ _id: "poll:you" }`}</code> in MongoDB.</li>
              <li>The hashed <code>_id</code> picks the shard, so votes spread evenly.</li>
              <li>2 of 3 regions must confirm it (<code>w: majority</code>).</li>
              <li>A second vote has the same <code>_id</code> and is rejected, so each person counts once.</li>
              <li>A random counter is bumped, and results are pushed to everyone every second.</li>
            </ol>
          </div>
        </aside>
      </div>
    </section>
  );
}
