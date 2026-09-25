// Helpers for demo scripts that run commands inside the Docker containers
// (mongosh on a Mongo node, psql on Postgres, stop/start/pause, ...).
import { spawnSync } from 'node:child_process';

function run(cmd, args, { quiet = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: args.length === 0 });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${r.stderr || r.stdout}`);
  }
  if (!quiet && r.stdout.trim()) process.stdout.write(r.stdout);
  return r.stdout;
}

// Shell string (used for pipes/redirects, e.g. psql < file).
export const sh = (cmd, opts) => run(cmd, [], opts);

// docker compose <args...>, passed as an array: no quoting problems.
export const compose = (args, opts) => run('docker', ['compose', ...args], opts);

// Runs JavaScript with mongosh inside a Mongo container and returns stdout.
export function mongosh(service, js, opts = {}) {
  return compose(['exec', '-T', service, 'mongosh', '--quiet', '--eval', js], { quiet: true, ...opts }).trim();
}

export function requireDocker() {
  const r = spawnSync('docker', ['compose', 'ps', '--services', '--status', 'running'], { encoding: 'utf8' });
  const running = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  for (const svc of ['mongos', 'a1', 'a2', 'a3', 'b1', 'b2', 'b3']) {
    if (!running.includes(svc)) {
      console.error(`This demo needs the full Docker cluster (service "${svc}" is not running).`);
      console.error('Start it with:  docker compose up -d   (run this from the project folder)');
      process.exit(1);
    }
  }
}

// Which member of a shard's replica set is PRIMARY right now.
export function shardPrimary(shard) {
  const members = shard === 'shard-a' ? ['a1', 'a2', 'a3'] : ['b1', 'b2', 'b3'];
  for (const m of members) {
    const out = mongosh(m, 'db.hello().isWritablePrimary', { allowFail: true });
    if (out === 'true') return m;
  }
  return null;
}

export const REGION_OF = { a1: 'Mumbai', a2: 'Frankfurt', a3: 'Virginia', b1: 'Mumbai', b2: 'Frankfurt', b3: 'Virginia' };
