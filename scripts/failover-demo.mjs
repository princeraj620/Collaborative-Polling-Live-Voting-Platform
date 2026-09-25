#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Failover demo (needs the Docker cluster).
//
// Voters keep voting (about 10 votes per second). After 5 seconds we STOP
// the primary of shard-a (a1, Mumbai). The other members hold an election
// and a new primary takes over. Then we start a1 again.
//
// Watch:
//   * votes that land on shard-a are refused (503) for a few seconds while
//     there is no primary; votes on shard-b keep working the whole time
//   * refused votes are simply retried at the end: retrying is safe
//   * every vote the API said was "counted" is really in the database:
//     acknowledged votes lost = 0
//
//   npm run demo:failover
//   (tip: start the stack with --env-file .env.loadtest so the 400 demo
//    logins are not slowed down by the per-IP login limit)
// ---------------------------------------------------------------------------
import { api, login, uniqueEmail, vote, sleep, step, c } from './lib/client.mjs';
import { requireDocker, compose, mongosh, shardPrimary, REGION_OF } from './lib/docker.mjs';

requireDocker();

const VOTERS = Number(process.env.VOTERS || 400);
const RATE = Number(process.env.RATE || 10); // votes per second
const DURATION_S = Math.ceil(VOTERS / RATE);
const STOP_AT_S = 5;
const START_AT_S = 22;

console.log(c.bold('\nFailover demo'));

step(1, `Create a poll and sign in ${VOTERS} voters`);
const owner = await login(uniqueEmail('failover-owner'));
const { body } = await api('/polls', {
  method: 'POST',
  token: owner,
  body: { question: `Failover demo ${new Date().toLocaleTimeString()}`, options: ['Stay up', 'Go down'], durationMinutes: 30 },
});
const pollId = body.poll.id;
const tokens = [];
for (let i = 0; i < VOTERS; i += 25) {
  tokens.push(...(await Promise.all(Array.from({ length: Math.min(25, VOTERS - i) }, (_, j) => login(uniqueEmail(`fv${i + j}`))))));
  process.stdout.write('.');
}
console.log(` ${tokens.length} ready`);
console.log(`   shard-a primary: ${shardPrimary('shard-a')} · shard-b primary: ${shardPrimary('shard-b')}`);

step(2, `Voting at ~${RATE}/s for ${DURATION_S}s. At t=${STOP_AT_S}s a1 is stopped, at t=${START_AT_S}s it comes back`);
const perSecond = [];
const outcomes = new Array(VOTERS);
const started = Date.now();
let stopped = false;
let restarted = false;
let newPrimaryAt = null;

const inflight = [];
for (let i = 0; i < VOTERS; i++) {
  const due = started + (i * 1000) / RATE;
  await sleep(Math.max(0, due - Date.now()));
  const sec = Math.floor((Date.now() - started) / 1000);

  if (!stopped && sec >= STOP_AT_S) {
    stopped = true;
    compose(['stop', '-t', '0', 'a1'], { quiet: true });
    console.log(c.red(`   t=${sec}s  ■ stopped a1 (shard-a primary, Mumbai)`));
  }
  if (stopped && !newPrimaryAt && sec % 2 === 0) {
    const p = mongosh('a2', 'rs.status().members.find(m => m.stateStr === "PRIMARY")?.name || ""', { allowFail: true });
    if (p && !p.startsWith('a1')) {
      newPrimaryAt = sec;
      console.log(c.green(`   t=${sec}s  ★ new shard-a primary elected: ${p.split(':')[0]} (${REGION_OF[p.split(':')[0]]})`));
    }
  }
  if (!restarted && sec >= START_AT_S) {
    restarted = true;
    compose(['start', 'a1'], { quiet: true });
    console.log(c.cyan(`   t=${sec}s  ▶ started a1 again (it rejoins as a secondary and catches up)`));
  }

  const idx = i;
  inflight.push(
    vote(tokens[idx], pollId, 1 + (idx % 2)).then((r) => {
      outcomes[idx] = r.status === 201 || r.status === 200 ? 'ok' : `${r.status} ${r.body?.error?.code || ''}`.trim();
      const s = Math.floor((Date.now() - started) / 1000);
      perSecond[s] ||= { ok: 0, refused: 0 };
      perSecond[s][outcomes[idx] === 'ok' ? 'ok' : 'refused'] += 1;
    }),
  );
}
await Promise.all(inflight);

console.log('\n   second  counted  refused');
perSecond.forEach((s, i) => {
  if (!s) return;
  const bar = c.green('█'.repeat(s.ok)) + c.red('█'.repeat(s.refused));
  console.log(`   ${String(i).padStart(5)}s  ${String(s.ok).padStart(6)}  ${String(s.refused).padStart(7)}  ${bar}`);
});

const refused = outcomes.map((o, i) => [o, i]).filter(([o]) => o !== 'ok');
const errorKinds = refused.reduce((m, [o]) => ((m[o] = (m[o] || 0) + 1), m), {});
console.log(`\n   counted: ${outcomes.filter((o) => o === 'ok').length}   refused: ${refused.length}  ${JSON.stringify(errorKinds)}`);

step(3, 'Retry every refused vote (safe: a vote that did get stored comes back as ALREADY_COUNTED)');
await sleep(3000);
let retriedOk = 0;
for (const [, i] of refused) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await vote(tokens[i], pollId, 1 + (i % 2));
    if (r.status === 201 || r.status === 200) {
      retriedOk += 1;
      outcomes[i] = 'ok';
      break;
    }
    await sleep(1000);
  }
}
console.log(`   ${retriedOk} of ${refused.length} refused votes succeeded on retry`);

step(4, 'Check the database: is every acknowledged vote really there?');
const inDb = Number(mongosh('mongos', `db.getSiblingDB('pollpulse').votes.countDocuments({ pollId: '${pollId}' }, { readConcern: { level: 'majority' } })`));
const acknowledged = outcomes.filter((o) => o === 'ok').length;
console.log(`   acknowledged by the API: ${acknowledged}   stored in MongoDB: ${inDb}`);
const lost = Math.max(0, acknowledged - inDb);
console.log(`   ${lost === 0 ? c.green('acknowledged votes lost: 0 ✓') : c.red(`acknowledged votes lost: ${lost}`)}`);
console.log(`   shard-a primary now: ${shardPrimary('shard-a')} (a1 has priority 2, so it takes over again once caught up)\n`);
