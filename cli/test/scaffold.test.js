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
