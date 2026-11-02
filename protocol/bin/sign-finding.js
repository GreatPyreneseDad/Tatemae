#!/usr/bin/env node
// usage: node bin/sign-finding.js <finding.json> <keys.json|-> [mandateId]   (run from packages/protocol)
// keys.json: {publicJwk, privateJwk}; "-" generates a throwaway pair and prints its public JWK.
// pairId is always the public key's thumbprint.
import { readFileSync, writeFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js'; import addFormats from 'ajv-formats';
import * as P from '../src/index.js';
const [file, keysArg, mandateId = 'mandate-demo'] = process.argv.slice(2);
const schema = JSON.parse(readFileSync(new URL('../../../spec/schemas/finding.v0.json', import.meta.url)));
const finding = JSON.parse(readFileSync(file));
const keys = keysArg === '-' ? await P.newPairKeys() : JSON.parse(readFileSync(keysArg));
const pairId = await P.pairIdOf(keys.publicJwk);
const { contribution_token: _, ...body } = finding;
finding.contribution_token = await P.signContribution({ privateJwk: keys.privateJwk, pairId, mandateId, kind: 'finding', payload: body });
const ajv = addFormats(new Ajv({ strict: false })); 
if (!ajv.validate(schema, finding)) { console.error(ajv.errors); process.exit(1); }
await P.verifyContribution({ token: finding.contribution_token, publicJwk: keys.publicJwk, payload: body });
writeFileSync(file, JSON.stringify(finding, null, 2) + '\n');
console.log('signed + schema-valid + verified:', file);
if (keysArg === '-') console.log('public JWK:', JSON.stringify(keys.publicJwk));
