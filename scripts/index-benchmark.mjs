#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Index benchmark: the same queries with and without their indexes.
//
// Runs EXPLAIN ANALYZE on the 200,000-poll table. The "without" run drops
// the indexes inside a transaction and ROLLS BACK afterwards, so nothing is
// really removed. (While it runs, writes to `polls` wait for a few seconds.)
//
//   npm run demo:indexes
//   PSQL="psql -h localhost -p 5434 -U pollpulse -d pollpulse" npm run demo:indexes
// ---------------------------------------------------------------------------
import { sh } from './lib/docker.mjs';
import { c } from './lib/client.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PSQL = process.env.PSQL || 'docker compose exec -T pg-primary psql -U pollpulse -d pollpulse';

const CASES = [
  {
    name: 'Full-text search: "night trains"',
    index: 'idx_polls_search (GIN on tsvector)',
    drop: 'idx_polls_search',
    sql: `SELECT id, question FROM polls, websearch_to_tsquery('english', 'night trains') q
          WHERE search @@ q AND visibility = 'public' ORDER BY ts_rank(search, q) DESC LIMIT 20`,
  },
  {
    name: 'Newest public polls (home feed)',
    index: 'idx_polls_new (created_at DESC, partial)',
    drop: 'idx_polls_new',
    sql: `SELECT id, question FROM polls WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 20`,
  },
  {
    name: '"My polls" for one creator',
    index: 'idx_polls_creator (creator_id, created_at DESC)',
    drop: 'idx_polls_creator',
    sql: `SELECT id, question FROM polls WHERE creator_id = 'c0000000-0000-4000-8000-000000000001'
          ORDER BY created_at DESC LIMIT 50`,
  },
  {
    name: 'Worker: open polls that should close now',
    index: 'idx_polls_due (closes_at, partial WHERE status = OPEN)',
    drop: 'idx_polls_due',
    sql: `SELECT id FROM polls WHERE status = 'OPEN' AND closes_at <= now() ORDER BY closes_at LIMIT 20`,
  },
];

const explain = (sql) => `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql.replace(/\s+/g, ' ')};`;

// Build one psql script: warm-up + measured runs WITH indexes, then the same
// WITHOUT them inside a rolled-back transaction.
const RUNS = 3;
const parts = ['\\set QUIET on', '\\pset format unaligned', '\\pset tuples_only on'];
for (const k of CASES) {
  parts.push(`SELECT 'MARK|with|${k.drop}';`);
  for (let i = 0; i <= RUNS; i++) parts.push(explain(k.sql));
}
parts.push('BEGIN;');
for (const k of CASES) parts.push(`DROP INDEX ${k.drop};`);
for (const k of CASES) {
  parts.push(`SELECT 'MARK|without|${k.drop}';`);
  for (let i = 0; i <= RUNS; i++) parts.push(explain(k.sql));
}
parts.push('ROLLBACK;');

const dir = mkdtempSync(join(tmpdir(), 'pp-idx-'));
const file = join(dir, 'bench.sql');
writeFileSync(file, parts.join('\n'));

console.log(c.bold('\nIndex benchmark on the polls table'));
console.log(c.dim('Running EXPLAIN ANALYZE with and without indexes (without = inside a rolled-back transaction)...\n'));

const out = sh(`${PSQL} -v ON_ERROR_STOP=1 < "${file}"`, { quiet: true });
const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);

// Parse: MARK lines followed by RUNS+1 JSON plans (first is a warm-up).
const results = {};
let current = null;
let buffer = '';
const flush = () => {
  if (!current || !buffer) return;
  const plan = JSON.parse(buffer)[0];
  current.plans.push(plan);
  buffer = '';
};
for (const line of lines) {
  if (line.startsWith('MARK|')) {
    flush();
    const [, mode, idx] = line.split('|');
    current = { mode, idx, plans: [] };
    results[`${mode}:${idx}`] = current;
  } else if (current) {
    buffer += line;
    try {
      JSON.parse(buffer);
      flush();
    } catch {
      /* JSON spans several lines; keep reading */
    }
  }
}
flush();

const summarize = (entry) => {
  const measured = entry.plans.slice(1);
  const times = measured.map((p) => p['Execution Time']).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const walk = (node, acc) => {
    acc.push(node['Node Type'] + (node['Index Name'] ? ` (${node['Index Name']})` : ''));
    (node.Plans || []).forEach((n) => walk(n, acc));
    return acc;
  };
  const nodes = walk(measured[0].Plan, []);
  const scan = nodes.find((n) => /Scan/.test(n)) || nodes[0];
  const buffers = measured[0].Plan['Shared Hit Blocks'] + (measured[0].Plan['Shared Read Blocks'] || 0);
  return { median, scan, buffers };
};

const rows = [];
for (const k of CASES) {
  const w = summarize(results[`with:${k.drop}`]);
  const wo = summarize(results[`without:${k.drop}`]);
  const speedup = wo.median / w.median;
  rows.push({ name: k.name, index: k.index, with: w, without: wo, speedup });
  console.log(c.bold(k.name));
  console.log(`  index:    ${k.index}`);
  console.log(`  with:     ${c.green(`${w.median.toFixed(2)} ms`.padEnd(12))} ${c.dim(w.scan)} · ${w.buffers} pages read`);
  console.log(`  without:  ${c.red(`${wo.median.toFixed(2)} ms`.padEnd(12))} ${c.dim(wo.scan)} · ${wo.buffers} pages read`);
  console.log(`  speed-up: ${c.cyan(`${speedup.toFixed(0)}x`)}\n`);
}

if (process.env.JSON_OUT) writeFileSync(process.env.JSON_OUT, JSON.stringify(rows, null, 2));
console.log(c.dim('Indexes restored (the DROPs were rolled back).'));
