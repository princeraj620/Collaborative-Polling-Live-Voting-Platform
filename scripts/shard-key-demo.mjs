#!/usr/bin/env node
// Shard-key demo (needs the Docker cluster). The work happens in
// scripts/mongo/shard-key-demo.js, which runs with mongosh on the router.
//
//   npm run demo:shard-key
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requireDocker, mongosh } from './lib/docker.mjs';

requireDocker();
const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, 'mongo', 'shard-key-demo.js'), 'utf8');
console.log(mongosh('mongos', script));
