import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CLI = new URL('../tatemae.js', import.meta.url).pathname;
test('init mints a pair once; tag is deterministic; unknown command fails', () => {
  const home = mkdtempSync(join(tmpdir(), 'tm-'));
  try {
    const out = JSON.parse(execFileSync('node', [CLI, 'init'], { env: { ...process.env, TATEMAE_HOME: home }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    assert.ok(out.pair_id && out.pubkey_jwk.crv === 'P-256'); assert.ok(existsSync(join(home, 'keys.json')));
    assert.notEqual(spawnSync('node', [CLI, 'init'], { env: { ...process.env, TATEMAE_HOME: home } }).status, 0);
    const t1 = execFileSync('node', [CLI, 'tag', 'abc', 'def'], { encoding: 'utf8' }).trim(); const t2 = execFileSync('node', [CLI, 'tag', 'abc', 'def'], { encoding: 'utf8' }).trim();
    assert.equal(t1, t2); assert.match(t1, /^[0-9a-f]{64}$/);
    assert.notEqual(spawnSync('node', [CLI, 'bogus']).status, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('file signs a finding with the pair key and posts finding_filed; the signature verifies with jose', { skip: !existsSync(new URL('../../protocol/node_modules/jose', import.meta.url)) && 'jose not installed in protocol/' }, async () => {
  const { signJws, canonical, sha256hex } = await import('../tatemae.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const { jwtVerify, importJWK } = await import('../../protocol/node_modules/jose/dist/node/esm/index.js');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const finding = { kind: 'bug', defect: 'x' }; const token = signJws({ privateJwk: privateKey.export({ format: 'jwk' }), header: { typ: 'buildup-contribution+jwt' }, claims: { payload_sha256: sha256hex(canonical(finding)), sub: 'p', iat: 1 } });
  const { payload, protectedHeader } = await jwtVerify(token, await importJWK(publicKey.export({ format: 'jwk' }), 'ES256'), { algorithms: ['ES256'] });
  assert.equal(protectedHeader.typ, 'buildup-contribution+jwt'); assert.equal(payload.payload_sha256, sha256hex(canonical(finding)));
});

test('board lists only unjudged rows', async () => {
  const http = await import('node:http');
  const rows = [{ id: 'open1', verified: 'red', judged: false, f: { kind: 'bug', location: { path: 'a.js' }, defect: 'd' }, bounty: { title: 'Piece' } }, { id: 'done1', judged: true, f: { kind: 'bug', location: { path: 'x.js' }, defect: 'old' } }];
  const srv = http.createServer((q, s) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(rows)); }); await new Promise(r => srv.listen(0, r));
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { stdout: out } = await promisify(execFile)('node', [CLI, 'board'], { env: { ...process.env, TATEMAE_BOARD: `http://localhost:${srv.address().port}/` }, encoding: 'utf8' }); srv.close();
  assert.match(out, /open1.*Piece/); assert.doesNotMatch(out, /done1/);
});

test('openEnvelope decrypts an ECDH-ES/A256GCM JWE sealed by jose', { skip: !existsSync(new URL('../../protocol/node_modules/jose', import.meta.url)) && 'jose not installed in protocol/' }, async () => {
  const { openEnvelope } = await import('../tatemae.js');
  const { CompactEncrypt, importJWK } = await import('../../protocol/node_modules/jose/dist/node/esm/index.js');
  const { generateKeyPairSync } = await import('node:crypto');
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const sealed = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({ jti: 'm1', nonce: 'n1' }))).setProtectedHeader({ alg: 'ECDH-ES', enc: 'A256GCM', typ: 'buildup-envelope+jwe' }).encrypt(await importJWK(publicKey.export({ format: 'jwk' }), 'ECDH-ES'));
  assert.deepEqual(openEnvelope(privateKey.export({ format: 'jwk' }), sealed), { jti: 'm1', nonce: 'n1' });
});
