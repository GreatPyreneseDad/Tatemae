#!/usr/bin/env node
// usage: node bin/open-envelope.js <keys.json> <sealed-jwe-or-file>
import { readFileSync, existsSync } from 'node:fs';
import * as P from '../src/index.js';
const [keysPath, arg] = process.argv.slice(2);
const keys = JSON.parse(readFileSync(keysPath));
const sealed = existsSync(arg) ? readFileSync(arg, 'utf8').trim() : arg;
console.log(JSON.stringify(await P.openEnvelope(keys.privateJwk, sealed), null, 2));
