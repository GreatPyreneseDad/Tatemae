#!/usr/bin/env node
// tatemae — reference CLI for pairs. PROPOSAL: reference code, not for merge as-is.
//   tatemae init                 mint a pair → ~/.tatemae/keys.json, print the pairs/<handle>.json record
//   tatemae file <finding.json>  sign and submit a finding to the network
//   tatemae take <finding-id>    pick a finding/bounty → prints Buildup-Mandate / Buildup-Nonce trailers
//   tatemae tag <nonce> <sha>    reasoning-note first line
//   tatemae board                list open findings and bounties
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os'; import { join } from 'node:path';
import * as P from '../protocol/src/index.js';
import { compactDecrypt, importJWK } from 'jose';

const INGEST = process.env.TATEMAE_INGEST ?? 'https://nnnlitdzggyyboyqismx.supabase.co/functions/v1/ingest';
const API = INGEST.replace(/ingest$/, 'picks');
const KEYS = join(process.env.TATEMAE_HOME ?? join(homedir(), '.tatemae'), 'keys.json');
const [cmd, ...args] = process.argv.slice(2);
const keys = () => { if (!existsSync(KEYS)) { console.error('no pair yet: run `tatemae init`'); process.exit(2); } return JSON.parse(readFileSync(KEYS)); };
const post = async (body) => { const r = await fetch(INGEST, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.status); return j; };

const cmds = {
  async init() {
    if (existsSync(KEYS)) { console.error(`pair exists at ${KEYS}`); process.exit(1); }
    const k = await P.newPairKeys(); mkdirSync(join(KEYS, '..'), { recursive: true }); writeFileSync(KEYS, JSON.stringify(k, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ human_handle: '<handle>', agent_label: '<agent>', pair_id: k.pairId, identities: {}, pubkey_jwk: k.publicJwk }, null, 2));
    console.error(`\nkeys: ${KEYS}\ncommit the record above as pairs/<handle>.json in a repo on the network and push.`);
  },
  async file(path) {
    const k = keys(); const f = JSON.parse(readFileSync(path)); delete f.contribution_token;
    f.contribution_token = await P.signContribution({ privateJwk: k.privateJwk, pairId: k.pairId, mandateId: 'cli', kind: 'finding', payload: f });
    const r = await post({ type: 'finding_filed', finding: f }); console.log(JSON.stringify(r));
  },
  async take(id) {
    const k = keys(); const pick_token = await P.signPick({ privateJwk: k.privateJwk, pairId: k.pairId, findingEventId: id });
    const r = await post({ type: 'pick_made', pick_token });
    const env = JSON.parse(new TextDecoder().decode((await compactDecrypt(r.sealed, await importJWK(k.privateJwk, 'ECDH-ES'))).plaintext));
    console.log(`Buildup-Mandate: ${env.jti}\nBuildup-Nonce: ${env.nonce}\n# expires ${env.expires_at}`);
  },
  tag(nonce, sha) { console.log(P.reasoningTag(nonce, sha)); },
  async board() {
    const rows = await (await fetch(API + '?json')).json();
    for (const r of rows) if (!r.judged) console.log(`${r.id}  ${r.verified ?? 'unverified'}  ${r.f.kind}  ${r.f.location.path}  ${r.bounty?.title ?? r.f.defect.slice(0, 70)}`);
  },
};
if (!cmds[cmd]) { console.error('usage: tatemae init | file <finding.json> | take <id> | tag <nonce> <sha> | board'); process.exit(2); }
await cmds[cmd](...args);
