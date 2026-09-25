import { useCallback, useEffect, useState } from 'react';
import { api, fmt, timeLeft } from '../api.js';

// "My polls" doubles as the read-your-writes demo.
const RYW_KEY = 'pollpulse.ryw';
const loadRyw = () => {
  try {
    return sessionStorage.getItem(RYW_KEY) !== 'off';
  } catch {
    return true;
  }
};
const saveRyw = (on) => {
  try {
    sessionStorage.setItem(RYW_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
};

export default function MyPolls() {
  // Remembered for this browser tab, so you can switch it off, create a poll
  // and come back to see the effect.
  const [ryw, setRywState] = useState(loadRyw);
  const setRyw = (on) => {
    saveRyw(on);
    setRywState(on);
  };
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loadedAt, setLoadedAt] = useState(null);

  const load = useCallback(() => {
    setData(null);
    api.mine(ryw).then(({ data: d }) => { setData(d); setLoadedAt(new Date()); }, (e) => setError(e.message));
  }, [ryw]);

  useEffect(() => { load(); }, [load]);

  const reasonText = {
    'read-your-writes': 'you wrote recently and the replica has not caught up yet, so this read went to the primary',
    default: 'the replica already has all of your changes',
    'replica-down': 'the replica is unavailable',
    'no-replica': 'no replica is configured',
  };

  return (
    <section>
      <div className="section-head">
        <h1>My polls</h1>
        <p className="muted">A live demo of <strong>replication lag</strong> and the <strong>read-your-writes</strong> fix.</p>
      </div>

      <div className={`card ryw-card ${data?.readFrom === 'primary' ? 'via-primary' : ''}`}>
        <div className="ryw-top">
          <label className="switch">
            <input type="checkbox" checked={ryw} onChange={(e) => setRyw(e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
            Read-your-writes {ryw ? 'ON' : 'OFF'}
          </label>
          <button className="ghost small" onClick={load}>Reload</button>
        </div>
        {data && (
          <p className="small">
            This list was read from the <strong className="mono">{data.readFrom}</strong>
            {data.reason && reasonText[data.reason] ? <>: {reasonText[data.reason]}.</> : '.'}
            {loadedAt && <span className="muted"> ({loadedAt.toLocaleTimeString()})</span>}
          </p>
        )}
        <p className="muted small">
          Try it: turn the switch <strong>OFF</strong>, create a poll, then come back here straight away. The poll is
          missing for ~2 seconds because the replica applies changes late. Turn it <strong>ON</strong> and it is always there.
        </p>
      </div>

      {error && <div className="notice error">{error}</div>}
      {!data ? (
        <div className="loading">Loading…</div>
      ) : data.polls.length === 0 ? (
        <div className="card empty-state">
          <p>No polls here{ryw ? '' : ' (yet?)'}.</p>
          <a className="primary" href="#/create">Create a poll</a>
        </div>
      ) : (
        <div className="mine-list">
          {data.polls.map((p) => (
            <a key={p.id} href={`#/polls/${p.id}`} className="mine-row card">
              <div>
                <strong>{p.question}</strong>
                <div className="muted small">{p.visibility} · {p.category}</div>
              </div>
              <div className="mine-right small">
                <span>{fmt(p.voteCount)} {p.voteCount === 1 ? 'vote' : 'votes'}</span>
                {p.status === 'OPEN' ? <span className="status live"><span className="dot" /> {timeLeft(p.closesAt)}</span> : <span className="status">Closed</span>}
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
