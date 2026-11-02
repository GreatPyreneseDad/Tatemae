// GitHub adapter. Thin: GitHub is one place git lives. Extras are where GitHub-only value goes.
import { enforceMandate, normalizeRepoUrl } from '@tatemae/protocol/forge';

export const name = 'github';

/** auth: v0 uses whatever token the caller holds (App installation token later). */
export async function auth(repo, { token } = {}) {
  const u = new URL(normalizeRepoUrl(repo.url));
  return { cloneUrl: u.href, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

/** Translate GitHub webhook deliveries. Returns a PushEvent for `push`, null for anything we ignore. */
export function onEvent(raw, headers = {}) {
  const ev = headers['x-github-event'];
  if (ev === 'push' && raw?.repository?.clone_url) {
    const changed = new Set();
    for (const c of raw.commits ?? []) for (const k of ['added', 'modified', 'removed']) for (const p of c[k] ?? []) changed.add(p);
    return {
      kind: 'push',
      repo: { url: raw.repository.clone_url, defaultBranch: raw.repository.default_branch },
      ref: raw.ref, before: raw.before, after: raw.after,
      changedPaths: [...changed],
      commits: (raw.commits ?? []).map(c => ({ sha: c.id, message: c.message })),
      pusherIdentity: raw.sender?.login ? `github:${raw.sender.login}` : undefined,
    };
  }
  return null;   // workflow_run etc.: the Actions shim reports evidence directly to ingest, so nothing to do here.
}

export { enforceMandate };

/** mergeAsJudge: plain git. The caller supplies a checkout; we never use the PR merge API for the merge itself. */
export async function mergeAsJudge(repo, commit, target, { git }) {
  await git(['fetch', 'origin', target, commit]);
  await git(['checkout', '-q', `origin/${target}`]);
  await git(['merge', '--no-ff', '-q', '-m', `judge: merge ${commit.slice(0, 7)} into ${target}`, commit]);
  const sha = (await git(['rev-parse', 'HEAD'])).trim();
  await git(['push', 'origin', `HEAD:${target}`]);
  return { sha };
}

/** GitHub-only niceties. Optional. Protocol never depends on these. */
export const extras = {
  // POST a Check Run on the finding's commit so GitHub users see red/green where they already look.
  async checkRun({ api, owner, repo, sha, result, run_url, findingPath }) {
    return api(`POST /repos/${owner}/${repo}/check-runs`, {
      name: `buildup: ${findingPath}`, head_sha: sha, status: 'completed',
      conclusion: result === 'red' ? 'neutral' : 'failure',
      output: { title: result === 'red' ? 'finding stands' : 'finding did not reproduce', summary: run_url },
    });
  },
  // Judge's reasoning as a PR comment, if the build came via a PR.
  async judgeComment({ api, owner, repo, prNumber, reasoning }) {
    return api(`POST /repos/${owner}/${repo}/issues/${prNumber}/comments`, { body: `**judge**\n\n${reasoning}` });
  },
};
