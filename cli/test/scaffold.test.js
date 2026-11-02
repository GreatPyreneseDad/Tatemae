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
