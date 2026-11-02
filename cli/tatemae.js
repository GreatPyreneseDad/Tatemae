#!/usr/bin/env node
// tatemae — command line for pairs. Scaffold: `init` mints a pair, `tag` computes the reasoning-note tag.
// Networked commands (file, take, board) are separate bounties and land as cli/commands/*.js.
//   tatemae init               mint a pair into $TATEMAE_HOME/keys.json (default ~/.tatemae); print the pairs/<handle>.json record
//   tatemae tag <nonce> <sha>  first line of a PR reasoning note: HMAC-SHA256(nonce, head_sha)
//   tatemae file <finding.json> sign the finding with this pair's key and submit it as finding_filed
//   tatemae board               list open findings and bounties (unjudged) from the picks API
//   tatemae take <finding-id>   sign a pick, receive the sealed builder mandate, print its trailers
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHmac, createHash, generateKeyPairSync, createPrivateKey, createPublicKey, createSign, randomBytes, diffieHellman, createDecipheriv } from 'node:crypto';
// no dependencies: a scaffold that must run in a clean clone

export const HOME = process.env.TATEMAE_HOME ?? join(homedir(), '.tatemae');
export const KEYS = join(HOME, 'keys.json');
export const INGEST = process.env.TATEMAE_INGEST ?? 'https://nnnlitdzggyyboyqismx.supabase.co/functions/v1/ingest';
export const BOARD = process.env.TATEMAE_BOARD ?? INGEST.replace(/\/ingest$/, '/picks') + '?json';

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
// ECDH-ES (direct key agreement) + A256GCM compact JWE decryption, RFC 7518 §4.6 Concat KDF. Enough to open an
// envelope sealed to this pair's P-256 key; nothing more.
export function openEnvelope(privateJwk, compact) {
  const [h, , iv, ct, tag] = compact.split('.'); const hdr = JSON.parse(Buffer.from(h, 'base64url'));
  if (hdr.alg !== 'ECDH-ES' || hdr.enc !== 'A256GCM') throw new Error(`unsupported envelope ${hdr.alg}/${hdr.enc}`);
  const z = diffieHellman({ privateKey: createPrivateKey({ key: privateJwk, format: 'jwk' }), publicKey: createPublicKey({ key: hdr.epk, format: 'jwk' }) });
  const len = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const apu = hdr.apu ? Buffer.from(hdr.apu, 'base64url') : Buffer.alloc(0), apv = hdr.apv ? Buffer.from(hdr.apv, 'base64url') : Buffer.alloc(0);
  const lenB = (b) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return Buffer.concat([l, b]); };
  const suppPub = Buffer.alloc(4); suppPub.writeUInt32BE(256);
  const round = Buffer.alloc(4); round.writeUInt32BE(1);
  const key = createHash('sha256').update(Buffer.concat([round, z, len('A256GCM'), lenB(apu), lenB(apv), suppPub])).digest();
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url')); d.setAAD(Buffer.from(h)); d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString());
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
  async board() {
    const r = await fetch(BOARD); if (!r.ok) throw new Error(`board: ${r.status}`); const rows = await r.json();
    const open = rows.filter(x => !x.judged);
    if (!open.length) { console.log('nothing open'); return 0; }
    for (const x of open) console.log([x.id, (x.verified ?? 'unverified').padEnd(10), x.f.kind.padEnd(11), x.f.location.path, x.bounty?.title ?? x.f.defect.slice(0, 80)].join('  '));
    return 0;
  },
  async take(id) {
    if (!id) { console.error('usage: tatemae take <finding-id>'); return 2; }
    const k = loadKeys(); const now = Math.floor(Date.now() / 1000);
    const pick_token = signJws({ privateJwk: k.privateJwk, header: { typ: 'buildup-pick+jwt' }, claims: { finding_event_id: id, sub: k.pair_id, iat: now, exp: now + 600, jti: randomBytes(8).toString('hex') } });
    const r = await post({ type: 'pick_made', pick_token });
    const env = openEnvelope(k.privateJwk, r.sealed);
    console.log(`Buildup-Mandate: ${env.jti}\nBuildup-Nonce: ${env.nonce}\n# expires ${env.expires_at}; reasoning tag: tatemae tag ${env.nonce} <head_sha>`);
    return 0;
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

const USAGE = 'usage: tatemae <init | tag <nonce> <head_sha> | file <finding.json> | board | take <finding-id>>';
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!commands[cmd]) { console.error(USAGE); process.exit(2); }
  process.exit(await commands[cmd](...args) ?? 0);
}
