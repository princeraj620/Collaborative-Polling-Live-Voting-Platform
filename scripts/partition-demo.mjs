#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Network partition demo: CAP in action (needs the Docker cluster).
//
// We freeze the Frankfurt and Virginia members of both shards
// (docker compose pause a2 a3 b2 b3). Mumbai is now cut off: 1 of 3 members
// is not a majority.
//
//   Votes         -> CP: refused (503). A vote that only Mumbai stored could
//                    be lost when the partition heals, so we don't accept it.
//   Live results  -> AP: still shown (read from whatever copy is reachable),
//                    they just stop moving because no new votes are accepted.
//
// Then we heal the partition and watch voting come back by itself.
//
//   npm run demo:partition
// ---------------------------------------------------------------------------
import { api, login, uniqueEmail, vote, sleep, step, c } from './lib/client.mjs';
import { requireDocker, compose } from './lib/docker.mjs';

requireDocker();
const CUT = ['a2', 'a3', 'b2', 'b3'];
const PARTITION_S = Number(process.env.PARTITION_SECONDS || 25);

console.log(c.bold('\nNetwork partition demo (CAP)'));

const owner = await login(uniqueEmail('cap-owner'));
const { body } = await api('/polls', {
  method: 'POST',
  token: owner,
  body: { question: `Partition demo ${new Date().toLocaleTimeString()}`, options: ['Consistency', 'Availability'], durationMinutes: 30 },
});
const pollId = body.poll.id;
const tokens = await Promise.all(Array.from({ length: 60 }, (_, i) => login(uniqueEmail(`cap${i}`))));
let next = 0;

async function probe(label) {
  const t0 = Date.now();
  const v = await vote(tokens[next++], pollId, 1 + (next % 2));
  const voteMs = Date.now() - t0;
  const r = await api(`/polls/${pollId}/results`);
  const voteText = v.status === 201 ? c.green('201 counted') : c.red(`${v.status} ${v.body?.error?.code || ''}`);
  const resText = r.status === 200 ? c.green(`200 total=${r.body.total}${r.body.stale ? ' (stale)' : ''}`) : c.red(`${r.status}`);
  console.log(`   ${label.padEnd(10)} vote: ${voteText.padEnd(38)} ${c.dim(`${voteMs} ms`.padEnd(8))} results: ${resText}`);
  return v.status === 201;
}

step(1, 'Healthy cluster');
for (let i = 0; i < 3; i++) await probe(`t=${i}s`);

step(2, `Partition: pause Frankfurt + Virginia (${CUT.join(', ')}) for ${PARTITION_S}s`);
compose(['pause', ...CUT], { quiet: true });
const cutAt = Date.now();
try {
  while (Date.now() - cutAt < PARTITION_S * 1000) {
    await probe(`t=${Math.round((Date.now() - cutAt) / 1000)}s`);
    await sleep(1000);
  }
} finally {
  step(3, 'Heal the partition (unpause)');
  compose(['unpause', ...CUT], { quiet: true, allowFail: true });
}

const healedAt = Date.now();
let recovered = false;
while (!recovered && Date.now() - healedAt < 60_000) {
  recovered = await probe(`+${Math.round((Date.now() - healedAt) / 1000)}s`);
  if (!recovered) await sleep(1000);
}
console.log(`\n   voting recovered ${Math.round((Date.now() - healedAt) / 1000)}s after the partition healed.`);
console.log(`
${c.bold('What this shows (CAP)')}
  During a partition you must choose for each kind of data:
  * Votes chose ${c.bold('Consistency')}: better to say "try again" than to accept a vote
    that might disappear. First they time out waiting for a majority
    (VOTE_NOT_CONFIRMED), then Mumbai steps down and they fail fast (VOTE_STORE_UNAVAILABLE).
  * Live results chose ${c.bold('Availability')}: people can still see results; they just
    may be a little behind.
`);
