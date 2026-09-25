#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Replication lag + read-your-writes demo.
//
// Writes go to the PostgreSQL PRIMARY; "My polls" is read from the REPLICA,
// which applies changes a little late (2 s on purpose in this project).
//
//  1. Read-your-writes OFF: create a poll, then read "My polls" every 250 ms.
//     The poll is missing until the replica catches up.
//  2. Read-your-writes ON: the same thing, but the API notices the replica
//     is behind for THIS user and reads from the primary instead.
//
//   npm run demo:replication
// ---------------------------------------------------------------------------
import { api, login, uniqueEmail, sleep, step, c } from './lib/client.mjs';

async function run(ryw) {
  const token = await login(uniqueEmail(ryw ? 'ryw-on' : 'ryw-off'));
  const started = Date.now();
  const { body } = await api('/polls', {
    method: 'POST',
    token,
    body: { question: `Replication demo (${ryw ? 'RYW on' : 'RYW off'}) ${Date.now()}`, options: ['A', 'B'], durationMinutes: 30 },
  });
  const pollId = body.poll.id;
  console.log(`   ${c.dim(`t=0 ms`)}      created poll on the ${c.bold('primary')}`);

  for (let i = 0; i < 20; i++) {
    const res = await api(`/polls/mine${ryw ? '' : '?ryw=off'}`, { token });
    const found = res.body.polls.some((p) => p.id === pollId);
    const t = `t=${Date.now() - started} ms`.padEnd(12);
    const where = res.body.readFrom.padEnd(8);
    console.log(`   ${c.dim(t)} read from ${c.bold(where)} → ${found ? c.green('poll visible ✓') : c.red('poll MISSING ✗')}`
      + (res.body.reason === 'read-your-writes' ? c.dim('  (replica behind, routed to primary)') : ''));
    if (found && res.body.readFrom === 'replica') return Date.now() - started;
    await sleep(250);
  }
  return null;
}

console.log(c.bold('\nReplication lag demo'));
step(1, 'Read-your-writes OFF: read "My polls" from the replica right after creating a poll');
const caughtUp = await run(false);
console.log(`   → the replica needed ~${caughtUp} ms to show the new poll. Until then, the user saw "no polls".`);

step(2, 'Read-your-writes ON: same steps');
await run(true);
console.log('   → always visible: while the replica is behind, this user\'s reads go to the primary.');
console.log('     Once the replica has caught up, reads go back to the replica.\n');
