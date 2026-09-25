#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Consistency levels demo (needs the Docker cluster).
//
// We make the VIRGINIA copy of every shard fall behind on purpose
// (db.fsyncLock() on a3 and b3 stops them from applying new writes), then:
//
//   1. vote                      -> stored on Mumbai + Frankfurt (majority), not Virginia
//   2. read it back: STRONG      -> reads the primary: sees the vote
//   3. read it back: EVENTUAL    -> reads the Virginia copy: vote MISSING (stale read)
//   4. read it back: CAUSAL      -> reads the Virginia copy, but WAITS for it to catch
//                                   up to our vote instead of returning stale data
//   5. unlock Virginia           -> it catches up; every level sees the vote
//
//   npm run demo:consistency
// ---------------------------------------------------------------------------
import { api, login, uniqueEmail, vote, sleep, step, c } from './lib/client.mjs';
import { requireDocker, mongosh } from './lib/docker.mjs';

requireDocker();

const VIRGINIA = ['a3', 'b3'];
const lock = () => VIRGINIA.forEach((m) => mongosh(m, 'db.fsyncLock().ok'));
const unlock = () => VIRGINIA.forEach((m) => mongosh(m, 'while (db.currentOp().fsyncLock) db.fsyncUnlock(); 1', { allowFail: true }));

async function readBack(token, pollId, level) {
  const t = Date.now();
  const res = await api(`/polls/${pollId}/my-vote?consistency=${level}&region=virginia`, { token });
  const ms = Date.now() - t;
  const b = res.body;
  const label = level.toUpperCase().padEnd(9);
  if (res.status !== 200) return console.log(`   ${label} ${c.red(`HTTP ${res.status}`)} ${b?.error?.message || ''}`);
  if (b.vote) console.log(`   ${label} ${c.green('found your vote ✓')}  ${c.dim(`readPreference=${b.readPreference}, ${ms} ms`)}`);
  else if (b.waitedForCatchUp) console.log(`   ${label} ${c.yellow('waited…')} ${b.message}`);
  else console.log(`   ${label} ${c.red('vote MISSING ✗ (stale read)')}  ${c.dim(`readPreference=${b.readPreference}, ${ms} ms`)}`);
}

console.log(c.bold('\nConsistency levels demo'));

const token = await login(uniqueEmail('consistency'));
const { body } = await api('/polls', {
  method: 'POST',
  token,
  body: { question: `Consistency demo ${new Date().toLocaleTimeString()}`, options: ['Strong', 'Eventual', 'Causal'], durationMinutes: 30 },
});
const pollId = body.poll.id;

try {
  step(1, 'Make the Virginia copies fall behind (fsyncLock on a3 and b3)');
  lock();
  console.log('   Virginia members still answer reads, but stop applying new writes.');

  step(2, 'Vote (w: majority = Mumbai + Frankfurt is enough)');
  const v = await vote(token, pollId, 1, 'virginia');
  console.log(`   ${v.status} ${v.body.status || v.body.error?.code}`);
  await sleep(500);

  step(3, 'Read the vote back from Virginia with each consistency level');
  await readBack(token, pollId, 'strong');
  await readBack(token, pollId, 'eventual');
  await readBack(token, pollId, 'causal');
} finally {
  step(4, 'Unlock Virginia: it catches up');
  unlock();
}
await sleep(1500);
await readBack(token, pollId, 'strong');
await readBack(token, pollId, 'eventual');
await readBack(token, pollId, 'causal');

console.log(`
${c.bold('What this shows')}
  strong   = always correct, always goes to the primary (can be far away / busy)
  eventual = fastest and closest, but can return old data
  causal   = close AND never older than your own last write (it waits if needed)
`);
