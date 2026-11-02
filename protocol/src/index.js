// @buildup/protocol — contribution tokens, mandates, nonce binding. Plain ESM, no build step.
import { SignJWT, jwtVerify, generateKeyPair, exportJWK, importJWK, calculateJwkThumbprint, compactDecrypt } from 'jose';
import { createHash, createHmac, randomBytes } from 'node:crypto';

export const ALG = 'ES256';
export const ROLES = ['inspector', 'builder', 'judge', 'principal'];

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const canonical = (o) => JSON.stringify(sortKeys(o));
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;

// ---- keys: every pair owns its own keypair. The network only ever sees public JWKs.
// A pair's protocol id is its public key's RFC 7638 thumbprint: derivable offline, no registry round trip.
export async function newPairKeys() {
  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { publicJwk, privateJwk: await exportJWK(privateKey), pairId: await pairIdOf(publicJwk) };
}
export const pairIdOf = (publicJwk) => calculateJwkThumbprint(publicJwk, 'sha256');

// ---- contribution token: pair signs a claim about a payload (finding, build, ...)
export async function signContribution({ privateJwk, pairId, mandateId, kind, payload }) {
  const key = await importJWK(privateJwk, ALG);
  return new SignJWT({ kind, mandate: mandateId, payload_sha256: sha256(canonical(payload)) })
    .setProtectedHeader({ alg: ALG, typ: 'buildup-contribution+jwt' })
    .setSubject(pairId).setIssuedAt().setJti(randomBytes(12).toString('hex')).sign(key);
}
export async function verifyContribution({ token, publicJwk, payload }) {
  const key = await importJWK(publicJwk, ALG);
  const { payload: c, protectedHeader } = await jwtVerify(token, key, { algorithms: [ALG] });
  if (protectedHeader.typ !== 'buildup-contribution+jwt') throw new Error('wrong typ');
  if (payload !== undefined && c.payload_sha256 !== sha256(canonical(payload))) throw new Error('payload hash mismatch');
  return c;
}

// ---- mandates: signed by the issuer (network or parent holder), scope-narrowing only.
// A child mandate's paths must each sit under some parent path. Roles cannot widen.
export async function issueMandate({ issuerPrivateJwk, issuerId, holderPairId, role, scopePaths, parent, expiresIn = '7d', nonce }) {
  if (!ROLES.includes(role)) throw new Error('unknown role');
  if (parent) {
    if (!scopePaths.every(p => pathInScope(normalizeScope(p), parent.scope_paths))) throw new Error('mandate widens scope');
    if (ROLE_RANK[role] > ROLE_RANK[parent.role]) throw new Error('mandate widens role');
  }
  const key = await importJWK(issuerPrivateJwk, ALG);
  const claims = { role, scope_paths: scopePaths, parent_mandate: parent?.jti ?? null };
  if (nonce) claims.nonce_hash = sha256(nonce);      // nonce itself travels out-of-band to the agent
  return new SignJWT(claims)
    .setProtectedHeader({ alg: ALG, typ: 'buildup-mandate+jwt' })
    .setIssuer(issuerId).setSubject(holderPairId).setIssuedAt().setExpirationTime(expiresIn)
    .setJti(randomBytes(12).toString('hex')).sign(key);
}
const ROLE_RANK = { inspector: 1, builder: 1, judge: 2, principal: 3 };
export async function verifyMandate({ token, issuerPublicJwk }) {
  const key = await importJWK(issuerPublicJwk, ALG);
  const { payload, protectedHeader } = await jwtVerify(token, key, { algorithms: [ALG] });
  if (protectedHeader.typ !== 'buildup-mandate+jwt') throw new Error('wrong typ');
  return payload;
}
// Scope rule, shared by mandate issuance, enforcement, and adapters. '.', './' and '' mean the whole repository.
export const normalizeScope = (p) => { const s = String(p).replace(/^\.\/+/, '').replace(/^\/+/, ''); return s === '.' || s === '' ? '' : s; };
export const pathInScope = (path, scopePaths) => scopePaths.some(pp => {
  const s = normalizeScope(pp); if (s === '') return true;
  return path === s || path.startsWith(s.replace(/\/?$/, '/'));
});

// ---- nonce binding. Proves one continuous agent session from mandate to submission.
// Claims NOTHING about which model ran. Label: "challenge-verified". Never "proven".
export const newNonce = () => randomBytes(24).toString('base64url');
export const reasoningTag = (nonce, commitSha) => createHmac('sha256', nonce).update(commitSha).digest('hex');
export const TRAILER = 'Buildup-Nonce';
export const MANDATE_TRAILER = 'Buildup-Mandate';

// ---- a pick: the human's pair signs which finding it takes on. Short-lived; the server issues the mandate.
export async function signPick({ privateJwk, pairId, findingEventId }) {
  const key = await importJWK(privateJwk, ALG);
  return new SignJWT({ finding_event_id: findingEventId })
    .setProtectedHeader({ alg: ALG, typ: 'buildup-pick+jwt' })
    .setSubject(pairId).setIssuedAt().setExpirationTime('10m').setJti(randomBytes(8).toString('hex')).sign(key);
}

// ---- the network seals {jti, token, nonce} to the holder's key. Open it with the pair's private key.
export async function openEnvelope(privateJwk, sealed) {
  const key = await importJWK(privateJwk, 'ECDH-ES');
  const { plaintext, protectedHeader } = await compactDecrypt(sealed, key);
  if (protectedHeader.typ !== 'buildup-envelope+jwe') throw new Error('wrong typ');
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export function parseTrailer(commitMessage) {
  const m = commitMessage.match(new RegExp(`^${TRAILER}:\\s*(\\S+)\\s*$`, 'm'));
  return m ? m[1] : null;
}
// server side: it holds only nonce_hash (from the mandate). The submission carries the nonce in the
// trailer and the HMAC tag as the first line of its reasoning note.
export function verifySubmission({ mandateClaims, commitMessage, commitSha, reasoningNote }) {
  const nonce = parseTrailer(commitMessage);
  const trailer_ok = !!nonce && sha256(nonce) === mandateClaims.nonce_hash;
  const tag = (reasoningNote ?? '').split('\n')[0].trim();
  const nonce_ok = trailer_ok && tag === reasoningTag(nonce, commitSha);
  return { trailer_ok, nonce_ok, label: nonce_ok ? 'challenge-verified' : 'unverified' };
}
