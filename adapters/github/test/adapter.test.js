import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as GH from '../src/index.js';
import { sameRepo } from '@tatemae/protocol/forge';

test('push webhook normalizes and mandate check is pure', () => {
  const raw = { ref: 'refs/heads/feat', before: 'a'.repeat(40), after: 'b'.repeat(40),
    repository: { clone_url: 'https://github.com/o/r.git', default_branch: 'main' }, sender: { login: 'alice' },
    commits: [{ id: 'b'.repeat(40), message: 'x', added: ['src/pager/y.js'], modified: ['README.md'], removed: [] }] };
  const ev = GH.onEvent(raw, { 'x-github-event': 'push' });
  assert.equal(ev.kind, 'push'); assert.deepEqual(ev.changedPaths.sort(), ['README.md', 'src/pager/y.js']);
  const m = { scope_paths: ['src/pager/'] };
  assert.deepEqual(GH.enforceMandate(ev, m), { accept: false, violations: ['README.md'] });
  assert.equal(GH.onEvent({}, { 'x-github-event': 'workflow_run' }), null);
  assert.ok(sameRepo('git@github.com:o/r.git', 'https://github.com/o/r'));
});
