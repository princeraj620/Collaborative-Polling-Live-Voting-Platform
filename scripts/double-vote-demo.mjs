#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Double-vote demo: "one person, one vote" without locks.
//
//  1. One user fires 5 copies of the same vote at the same instant (all within
//     their rate-limit budget, so all 5 reach the database), spread across
//     the API servers. Exactly 1 is counted: the DATABASE de-duplicates.
//  2. They fire 45 more: now the RATE LIMITER stops them before the database.
//  3. The same user tries to change their vote: refused.
//  4. 100 different users vote at once: all 100 are counted.
//
// Why it works: the vote's _id is "<pollId>:<userId>" and _id is unique
// across the whole sharded cluster. The database itself rejects duplicates.
//
//   npm run demo:double-vote
// ---------------------------------------------------------------------------
import { api, login, uniqueEmail, vote, waitForTotal, step, c } from './lib/client.mjs';

const tally = (list) => list.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});

console.log(c.bold('\nDouble-vote demo'));

step(1, 'Create a fresh poll');
const owner = await login(uniqueEmail('owner'));
const { body } = await api('/polls', {
  method: 'POST',
  token: owner,
  body: { question: `Double-vote demo ${new Date().toLocaleTimeString()}`, options: ['Cats', 'Dogs'], durationMinutes: 30 },
});
const pollId = body.poll.id;
console.log(`   poll ${c.dim(pollId)}`);

step(2, 'One user sends the SAME vote 5 times at the same instant');
const spammer = await login(uniqueEmail('spammer'));
const burst = await Promise.all(Array.from({ length: 5 }, () => vote(spammer, pollId, 1)));
const byStatus = tally(burst);
console.log(`   ${c.green(`201 COUNTED: ${byStatus[201] || 0}`)}   200 ALREADY_COUNTED: ${byStatus[200] || 0}`);
const servers = new Set(burst.map((r) => r.headers.get('x-served-by')).filter(Boolean));
console.log(`   handled by ${servers.size} different API server(s): ${[...servers].join(', ')}`);
console.log(c.dim('   All 5 reached MongoDB. The duplicate _id was rejected by the database itself.'));

step(3, 'They keep hammering: 45 more copies');
const flood = tally(await Promise.all(Array.from({ length: 45 }, () => vote(spammer, pollId, 1))));
console.log(`   429 RATE_LIMITED: ${flood[429] || 0} of 45`);
console.log(c.dim('   The per-user token bucket stops them before they cost a database write.'));

step(4, 'The same user tries to change their vote (after the rate limit refills)');
await new Promise((r) => setTimeout(r, 2000));
const change = await vote(spammer, pollId, 2);
console.log(`   ${change.status} ${change.body.error?.code}: ${change.body.error?.message}`);

step(5, '100 different users vote at the same moment');
const tokens = [];
for (let i = 0; i < 100; i += 20) {
  tokens.push(...(await Promise.all(Array.from({ length: 20 }, (_, j) => login(uniqueEmail(`fan${i + j}`))))));
}
const regions = ['mumbai', 'frankfurt', 'virginia'];
const many = await Promise.all(tokens.map((t, i) => vote(t, pollId, 1 + (i % 2), regions[i % 3])));
console.log(`   responses: ${JSON.stringify(tally(many))}`);

step(6, 'Final live count');
const r = await waitForTotal(pollId, 101);
console.log(`   total: ${c.bold(r.total)}  (expected 101 = 1 from the spammer + 100 fans)`);
console.log(`   ${r.options.map((o) => `${o.label}: ${o.count}`).join('   ')}`);
console.log(`   by region: ${JSON.stringify(r.byRegion)}`);

const pass = (byStatus[201] || 0) === 1 && change.status === 409 && r.total === 101;
console.log(`\n${pass ? c.green('PASS') : c.red('FAIL')}: 50 copies of one vote counted once; 100 different voters counted 100 times.\n`);
process.exit(pass ? 0 : 1);
