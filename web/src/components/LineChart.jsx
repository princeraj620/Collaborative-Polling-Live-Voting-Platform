// Tiny dependency-free SVG line chart for the ops dashboard.
export default function LineChart({ series, height = 180, yLabel = '', maxPoints = 120 }) {
  const width = 640;
  const pad = { top: 14, right: 12, bottom: 22, left: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const all = series.flatMap((s) => s.points);
  const maxY = Math.max(10, ...all);
  // Round the axis up to a "nice" number: 1, 2, 2.5 or 5 x 10^k.
  const magnitude = 10 ** Math.floor(Math.log10(maxY));
  const niceMax = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((v) => v >= maxY);
  const x = (i) => pad.left + (i / Math.max(1, maxPoints - 1)) * innerW;
  const y = (v) => pad.top + innerH - (v / niceMax) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(niceMax * t * 10) / 10);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={series.map((s) => s.name).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {t.toLocaleString('en-IN')}
            </text>
          </g>
        ))}
        {yLabel && (
          <text x={pad.left} y={height - 4} className="tick">{yLabel}</text>
        )}
        {series.map((s) => {
          const offset = maxPoints - s.points.length;
          const d = s.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          const last = s.points[s.points.length - 1];
          return (
            <g key={s.name}>
              {s.points.length > 1 && <path d={d} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" />}
              {last !== undefined && <circle cx={x(maxPoints - 1)} cy={y(last)} r="3.5" fill={s.color} />}
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} /> {s.name}
            <strong>{(s.points[s.points.length - 1] ?? 0).toLocaleString('en-IN')}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}
