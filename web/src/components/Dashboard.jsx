import { useEffect, useRef, useState } from 'react';
import { api, fmt, REGIONS, regionColor, regionLabel } from '../api.js';
import LineChart from './LineChart.jsx';

const INSTANCE_TIMEOUT_MS = 8000;

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <strong className={tone || ''}>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}

function ClusterCard({ cluster }) {
  if (!cluster) {
    // Running against a single MongoDB-compatible server (no shards to show).
    return (
      <div className="card cluster">
        <h2>MongoDB cluster</h2>
        <p className="muted small">Live shard and replica status appears here when you run the full sharded cluster with Docker Compose.</p>
        <div className="cluster-grid ghosted">
          {['shard-a', 'shard-b'].map((s) => (
            <div key={s} className="shard">
              <strong className="mono">{s}</strong>
              <div className="members">
                {REGIONS.map((r, i) => (
                  <span key={r.id} className={`member ${i === 0 ? 'primary' : ''}`} style={{ '--rc': r.color }}>
                    <b>{r.label}</b>{i === 0 ? 'PRIMARY' : 'SECONDARY'}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="card cluster">
      <h2>MongoDB cluster</h2>
      <p className="muted small">Each shard is a replica set with one member per region. PRIMARY takes the writes.</p>
      <div className="cluster-grid">
        {cluster.map((s) => (
          <div key={s.name} className={`shard ${s.ok ? '' : 'down'}`}>
            <strong className="mono">{s.name}</strong>
            {!s.ok && <span className="bad small">unreachable: {s.error}</span>}
            <div className="members">
              {s.members.map((m) => (
                <span key={m.host} className={`member ${m.state === 'PRIMARY' ? 'primary' : ''} ${m.healthy ? '' : 'dead'}`} style={{ '--rc': regionColor(m.region) }} title={m.host}>
                  <b>{regionLabel(m.region)}</b>
                  {m.healthy ? m.state : 'DOWN'}
                  {m.healthy && m.state === 'SECONDARY' && m.lagSec !== null ? <i>{m.lagSec}s behind</i> : null}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShardCard({ shards }) {
  const known = (shards || []).filter((s) => s.count !== null);
  const total = known.reduce((a, s) => a + s.count, 0) || 1;
  const single = !shards?.length || shards.every((s) => s.shard === 'single node');
  return (
    <div className="card">
      <h2>Votes per shard</h2>
      <p className="muted small">Hashed <code>_id</code> shard key: even the hottest poll spreads across shards.</p>
      {single ? (
        <p className="muted small shard-note">Running on a single node. With the Docker cluster you'll see an even split here (about 50% / 50%).</p>
      ) : (
        <div className="shard-bars">
          {known.map((s, i) => (
            <div key={s.shard}>
              <div className="mini-bar-top"><span className="mono">{s.shard}</span><strong>{fmt(s.count)} · {Math.round((s.count / total) * 100)}%</strong></div>
              <div className="bar"><span className={`c${i}`} style={{ width: `${(s.count / total) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplicationCard({ rep }) {
  if (!rep?.enabled) return <div className="card"><h2>PostgreSQL replication</h2><p className="muted small">No replica configured.</p></div>;
  return (
    <div className="card replication">
      <h2>PostgreSQL replication</h2>
      <p className="muted small">Polls and search are read from the replica. It copies the primary continuously.</p>
      <div className="rep-flow">
        <span className="rep-node">Primary<br /><em>writes</em></span>
        <span className="rep-arrow"><i style={{ animationDuration: rep.lagMs > 500 ? '1.6s' : '0.8s' }} />WAL stream</span>
        <span className={`rep-node ${rep.healthy ? '' : 'dead'}`}>Replica<br /><em>{rep.healthy ? 'reads' : 'down'}</em></span>
      </div>
      <div className="rep-stats small">
        <span>Lag <strong className={rep.lagMs > 1000 ? 'warn' : 'good'}>{fmt(rep.lagMs)} ms</strong></span>
        <span>Pending <strong>{fmt(rep.pendingBytes)} B</strong></span>
        <span>Apply delay <strong>{rep.applyDelay}</strong></span>
        <span>Streaming <strong>{rep.streamingReplicas}</strong></span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [ops, setOps] = useState(null);
  const [error, setError] = useState('');
  const [instances, setInstances] = useState({});
  const [lagHistory, setLagHistory] = useState([]);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    const tick = async () => {
      try {
        const o = await api.ops();
        if (stopped.current) return;
        setOps(o);
        setError('');
        setLagHistory((h) => [...h.slice(-59), o.replication?.lagMs ?? 0]);
      } catch (e) {
        if (!stopped.current) setError(e.message);
      }
      const probes = await Promise.all([0, 1, 2].map(async () => {
        const t = performance.now();
        try {
          const h = await api.health();
          return { ...h, ms: Math.round(performance.now() - t) };
        } catch {
          return null;
        }
      }));
      if (stopped.current) return;
      setInstances((prev) => {
        const out = { ...prev };
        for (const p of probes.filter(Boolean)) {
          const cur = out[p.instance] || { hits: 0 };
          out[p.instance] = { ...cur, ...p, hits: cur.hits + 1, lastSeen: Date.now() };
        }
        return out;
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      stopped.current = true;
      clearInterval(id);
    };
  }, []);

  const v = ops?.votes;
  const names = Object.keys(instances).sort();
  const totalHits = names.reduce((s, n) => s + instances[n].hits, 0) || 1;
  const hot = ops?.hotPoll;

  return (
    <section className="dashboard">
      <div className="section-head dash-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Live dashboard</h1>
          <p className="muted">Votes, shards, replicas and servers, updated every second. Run a load test and watch it move.</p>
        </div>
        <span className="live-pill"><span className="dot" /> Live</span>
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="kpis">
        <Kpi label="Votes per second" value={fmt(v?.current)} sub={`peak ${fmt(v?.peak)} in the last minute`} tone="good" />
        <Kpi label="Votes counted" value={fmt(v?.total)} sub="accepted with w: majority" />
        <Kpi label="Replica lag" value={`${fmt(ops?.replication?.lagMs)} ms`} sub={`includes ${ops?.replication?.applyDelay || '–'} demo delay`} tone={ops?.replication?.lagMs > 1000 ? 'warn' : ''} />
        <Kpi label="Live viewers here" value={fmt(ops?.liveViewersHere?.viewers)} sub={`streams on ${ops?.servedBy || '–'}`} />
      </div>

      <div className="dash-grid">
        <div className="card">
          <h2>Votes per second</h2>
          <p className="muted small">By region, last 60 seconds</p>
          {v && (
            <LineChart
              maxPoints={60}
              series={[
                { name: 'All regions', color: '#8b5cf6', points: v.perSecond },
                ...REGIONS.map((r) => ({ name: r.label, color: r.color, points: v.perRegion?.[r.id] || [] })),
              ]}
            />
          )}
        </div>
        <div className="card">
          <h2>Hottest poll right now</h2>
          <p className="muted small">{hot?.question || '–'}</p>
          {hot && (
            <div className="shard-bars">
              {hot.options.map((o, i) => (
                <div key={o.optionId}>
                  <div className="mini-bar-top"><span>{o.label}</span><strong>{fmt(o.count)} · {o.pct}%</strong></div>
                  <div className="bar"><span className={`c${i}`} style={{ width: `${Math.max(o.pct, 0.5)}%` }} /></div>
                </div>
              ))}
              <p className="muted small">{fmt(hot.total)} {hot.total === 1 ? 'vote' : 'votes'} · from sharded counters, cached 1 s</p>
            </div>
          )}
        </div>
      </div>

      <div className="dash-grid">
        <ClusterCard cluster={ops?.cluster} />
        <ShardCard shards={ops?.shards} />
      </div>

      <div className="dash-grid">
        <div>
          <ReplicationCard rep={ops?.replication} />
          {lagHistory.length > 1 && (
            <div className="card lag-chart">
              <h3>Replica lag (ms)</h3>
              <LineChart maxPoints={60} height={140} series={[{ name: 'Lag', color: '#22d3ee', points: lagHistory }]} />
            </div>
          )}
        </div>
        <div className="card">
          <h2>API servers</h2>
          <p className="muted small">Health checks through the load balancer. Each server plays one region.</p>
          <div className="instances">
            {names.length === 0 && <p className="muted">Waiting for health checks…</p>}
            {names.map((n) => {
              const inst = instances[n];
              const down = Date.now() - inst.lastSeen > INSTANCE_TIMEOUT_MS;
              const state = down ? 'down' : inst.status;
              return (
                <div key={n} className={`instance ${state}`}>
                  <div className="instance-top">
                    <span className={`status-dot ${state}`} />
                    <strong className="mono">{n}</strong>
                    <span className="region-tag" style={{ '--rc': regionColor(inst.region) }}>{regionLabel(inst.region)}</span>
                    <span className="badge">{state}</span>
                  </div>
                  <div className="share"><span style={{ width: `${Math.round((inst.hits / totalHits) * 100)}%` }} /></div>
                  <div className="instance-meta muted small">
                    <span>{Math.round((inst.hits / totalHits) * 100)}% of checks</span>
                    <span>{inst.ms} ms</span>
                    <span>PG {inst.postgres ? '✓' : '✗'} · Replica {inst.replica ? '✓' : '✗'} · Mongo {inst.mongo ? '✓' : '✗'} · Redis {inst.redis ? '✓' : '✗'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
