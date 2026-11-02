#!/usr/bin/env node
// tatemae — command line for pairs. Scaffold: `init` mints a pair, `tag` computes the reasoning-note tag.
// Networked commands (file, take, board) are separate bounties and land as cli/commands/*.js.
//   tatemae init               mint a pair into $TATEMAE_HOME/keys.json (default ~/.tatemae); print the pairs/<handle>.json record
//   tatemae tag <nonce> <sha>  first line of a PR reasoning note: HMAC-SHA256(nonce, head_sha)
//   tatemae file <finding.json> sign the finding with this pair's key and submit it as finding_filed
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHmac, createHash, generateKeyPairSync, createPrivateKey, createSign, randomBytes } from 'node:crypto';
// no dependencies: a scaffold that must run in a clean clone

export const HOME = process.env.TATEMAE_HOME ?? join(homedir(), '.tatemae');
export const KEYS = join(HOME, 'keys.json');
export const INGEST = process.env.TATEMAE_INGEST ?? 'https://nnnlitdzggyyboyqismx.supabase.co/functions/v1/ingest';

// ---- minimal JOSE, dependency-free: ES256 compact JWS, canonical JSON, base64url
const b64u = (b) => Buffer.from(b).toString('base64url');
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
export const canonical = (o) => JSON.stringify(sortKeys(o));
export const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
export function signJws({ privateJwk, header, claims }) {
  const h = b64u(JSON.stringify({ alg: 'ES256', ...header })), p = b64u(JSON.stringify(claims));
  const sig = createSign('SHA256').update(`${h}.${p}`).sign({ key: createPrivateKey({ key: privateJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(sig)}`;
}
export async function post(body) {
  const r = await fetch(INGEST, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `${r.status}`); return j;
}

export const commands = {
  async init() {
    if (existsSync(KEYS)) { console.error(`a pair already exists at ${KEYS}; remove it to mint another`); return 1; }
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicJwk = publicKey.export({ format: 'jwk' }), privateJwk = privateKey.export({ format: 'jwk' });
    const pairId = thumbprint(publicJwk);
    mkdirSync(dirname(KEYS), { recursive: true });
    writeFileSync(KEYS, JSON.stringify({ pair_id: pairId, publicJwk, privateJwk }, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ human_handle: '<your handle>', agent_label: '<your agent>', pair_id: pairId, identities: {}, pubkey_jwk: publicJwk }, null, 2));
    console.error(`\nkeys written to ${KEYS} (keep the private half off every repository)\ncommit the record above as pairs/<handle>.json in a repo on the network and push; CI registers it.`);
    return 0;
  },
  async file(path) {
    if (!path) { console.error('usage: tatemae file <finding.json>'); return 2; }
    const k = loadKeys(); const f = JSON.parse(readFileSync(path, 'utf8')); delete f.contribution_token;
    const now = Math.floor(Date.now() / 1000);
    f.contribution_token = signJws({ privateJwk: k.privateJwk, header: { typ: 'buildup-contribution+jwt' },
      claims: { kind: 'finding', mandate: 'cli', payload_sha256: sha256hex(canonical(f)), sub: k.pair_id, iat: now, jti: randomBytes(12).toString('hex') } });
    const r = await post({ type: 'finding_filed', finding: f });
    console.log(JSON.stringify(r)); return 0;
  },
  tag(nonce, sha) {
    if (!nonce || !sha) { console.error('usage: tatemae tag <nonce> <head_sha>'); return 2; }
    console.log(createHmac('sha256', nonce).update(sha).digest('hex')); return 0;
  },
};

// RFC 7638 thumbprint of an EC public JWK: sha256 of {"crv","kty","x","y"} in that order, no whitespace, base64url.
export const thumbprint = (jwk) => createHash('sha256').update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })).digest('base64url');

export function loadKeys() {
  if (!existsSync(KEYS)) { console.error(`no pair yet: run \`tatemae init\` (looked in ${KEYS})`); process.exit(2); }
  return JSON.parse(readFileSync(KEYS, 'utf8'));
}

const USAGE = 'usage: tatemae <init | tag <nonce> <head_sha> | file <finding.json>>';
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!commands[cmd]) { console.error(USAGE); process.exit(2); }
  process.exit(await commands[cmd](...args) ?? 0);
}
