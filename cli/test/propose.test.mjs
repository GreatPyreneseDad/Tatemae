import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
const CLI = new URL('../tatemae.js', import.meta.url).pathname;
const run = promisify(execFile);

test('propose posts proposal_filed with a proposal token signed by the pair key', async () => {
  const home = mkdtempSync(join(tmpdir(), 'propose-'));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = publicKey.export({ format: 'jwk' });
  writeFileSync(join(home, 'keys.json'), JSON.stringify({ publicJwk, privateJwk: privateKey.export({ format: 'jwk' }) }));
  let body = null;
  const srv = http.createServer((q, s) => {
    let b = ''; q.on('data', c => { b += c; });
    q.on('end', () => { body = JSON.parse(b); s.setHeader('content-type', 'application/json'); s.end('{"ok":true}'); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const { stdout } = await run('node', [CLI, 'propose', 'https://github.com/O/R/pull/5', '--title', 'My title'], { env: { ...process.env, TATEMAE_HOME: home, TATEMAE_INGEST: `http://127.0.0.1:${srv.address().port}` }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(stdout), { ok: true });
    assert.equal(body.type, 'proposal_filed');
    const [h, p, s] = body.proposal_token.split('.');
    assert.equal(JSON.parse(Buffer.from(h, 'base64url')).typ, 'buildup-proposal+jwt');
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    assert.equal(claims.title, 'My title');
    assert.equal(claims.repo_url, 'https://github.com/O/R.git');
    assert.equal(claims.pr_url, 'https://github.com/O/R/pull/5');
    assert.ok(claims.sub);
    assert.ok(verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: publicJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  } finally { srv.close(); rmSync(home, { recursive: true, force: true }); }
});

test('propose without a PR url or a title is a usage error', () => {
  assert.equal(spawnSync('node', [CLI, 'propose']).status, 2);
  assert.equal(spawnSync('node', [CLI, 'propose', 'https://github.com/O/R/pull/5']).status, 2);
  assert.equal(spawnSync('node', [CLI, 'propose', 'https://github.com/O/R', '--title', 't']).status, 2);
});
