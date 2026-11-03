import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CLI = new URL('../tatemae.js', import.meta.url).pathname;

function finding(repro) {
  const d = mkdtempSync(join(tmpdir(), 'verify-'));
  const work = join(d, 'work'); mkdirSync(work);
  const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'pipe' });
  git(['init', '-q'], work);
  git(['config', 'user.email', 't@t'], work); git(['config', 'user.name', 't'], work);
  writeFileSync(join(work, 'f.txt'), 'x');
  git(['add', '.'], work); git(['commit', '-q', '-m', 'init'], work);
  const commit = git(['rev-parse', 'HEAD'], work).toString().trim();
  const bare = join(d, 'bare.git');
  git(['clone', '-q', '--bare', work, bare], d);
  const file = join(d, 'finding.json');
  writeFileSync(file, JSON.stringify({ location: { repo: bare, commit }, evidence: { repro: { workdir: '.', timeout_s: 30, ...repro } } }));
  return { file, d };
}
function verify(repro) {
  const { file, d } = finding(repro);
  try { return spawnSync('node', [CLI, 'verify', file], { encoding: 'utf8' }); }
  finally { rmSync(d, { recursive: true, force: true }); }
}

test('a reproducing repro is red and exits 0, with the exit code in the JSON', () => {
  const r = verify({ cmd: 'exit 3', expect: 'nonzero_exit' });
  const j = JSON.parse(r.stdout);
  assert.equal(j.result, 'red'); assert.equal(j.exit, 3); assert.match(j.finding_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.status, 0);
});

test('a passing repro is green and exits 1', () => {
  const r = verify({ cmd: 'true', expect: 'nonzero_exit' });
  assert.equal(JSON.parse(r.stdout).result, 'green'); assert.equal(r.status, 1);
});

test('stdout_contains needs the needle; the checkout contains the pinned files', () => {
  assert.equal(JSON.parse(verify({ cmd: 'cat f.txt', expect: 'stdout_contains', needle: 'x' }).stdout).result, 'red');
  assert.equal(JSON.parse(verify({ cmd: 'cat f.txt', expect: 'stdout_contains', needle: 'nope' }).stdout).result, 'green');
});

test('missing argument is a usage error, not a verdict', () => {
  assert.equal(spawnSync('node', [CLI, 'verify']).status, 2);
});
