import { useEffect, useState } from 'react';
import { subscribeToRequests } from '../api.js';

export default function SystemPanel() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]);
  const [polls, setPolls] = useState({ total: 0, hits: 0 });
  useEffect(() => subscribeToRequests((l, s) => { setLog(l); setPolls(s); }), []);
  const instances = [...new Set(log.map((l) => l.servedBy).filter(Boolean))];

  return (
    <div className={`system-panel ${open ? 'open' : ''}`}>
      <button className="system-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="dot" aria-hidden="true" />
        Under the hood
        {instances.length > 0 && <span className="muted small"> · {instances.length} API server{instances.length > 1 ? 's' : ''} seen</span>}
        <span className="chev" aria-hidden="true">{open ? '▾' : '▴'}</span>
      </button>
      {open && (
        <div className="system-body">
          {polls.total > 0 && (
            <p className="poll-stats">Background requests: <strong>{polls.total}</strong>, <strong>{Math.round((polls.hits / polls.total) * 100)}%</strong> from Redis cache</p>
          )}
          {log.length === 0 ? (
            <p className="muted small">Click around. Requests will show up here.</p>
          ) : (
            <table>
              <thead><tr><th>Request</th><th>Status</th><th>Server</th><th>Region</th><th>Read from</th><th>Cache</th><th>ms</th></tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="mono">{l.method} {l.path}</td>
                    <td><span className={`status-code s${String(l.status)[0]}`}>{l.status}</span></td>
                    <td className="mono">{l.servedBy || '–'}</td>
                    <td className="mono">{l.region || '–'}</td>
                    <td className="mono">{l.readFrom || '–'}</td>
                    <td>{l.cache ? <span className={`cache ${l.cache.toLowerCase()}`}>{l.cache}</span> : '–'}</td>
                    <td className="mono">{l.ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">Server = X-Served-By · Region = the server's simulated region · Read from = PostgreSQL primary / replica, or the MongoDB read preference.</p>
        </div>
      )}
    </div>
  );
}
