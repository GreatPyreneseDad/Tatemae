// Forge adapter contract. Git is the substrate; a forge is a place git lives plus whatever extras it offers.
// The core never imports an adapter. Adapters import this and the protocol, nothing else of ours.
//
// Every adapter implements ForgeAdapter. Everything it emits is a NormalizedEvent — the only shape
// the ledger ingest accepts. Forge-specific extras (Checks API, PR comments, MR notes) live in the
// adapter's `extras` and are optional; the protocol must work with extras = {}.

/**
 * @typedef {Object} RepoRef
 * @property {string} url        clone URL, as in finding.location.repo
 * @property {string} [defaultBranch]
 */

/**
 * @typedef {Object} Mandate   verified claims from a buildup-mandate+jwt
 * @property {string} sub            holder pair id
 * @property {string} role
 * @property {string[]} scope_paths
 * @property {string|null} parent_mandate
 * @property {string} [nonce_hash]
 * @property {string} jti
 */

/**
 * @typedef {Object} PushEvent   a set of commits arriving on a ref
 * @property {RepoRef} repo
 * @property {string} ref
 * @property {string} before
 * @property {string} after
 * @property {string[]} changedPaths   union of paths touched by before..after
 * @property {{sha:string, message:string}[]} commits
 * @property {string} [pusherIdentity]  forge-side identity string, e.g. "github:login"
 */

/**
 * @typedef {Object} NormalizedEvent   what adapters POST to the ledger ingest
 * @property {'finding_verified'|'build_submitted'} type
 * @property {string} forge              'github' | 'gitlab' | 'gitea' | 'bare' | ...
 * @property {string} repo               clone URL
 * @property {string} commit
 * @property {string} [finding_sha256]   finding_verified: sha256 of canonical finding minus token
 * @property {'red'|'green'} [result]    finding_verified
 * @property {string} [run_url]          where a human can read the evidence log
 * @property {string} [commit_message]   build_submitted: for trailer parsing
 * @property {string} [reasoning_note]   build_submitted
 * @property {string} [mandate_token]    build_submitted: the builder's mandate JWT
 */

/**
 * @typedef {Object} ForgeAdapter
 * @property {string} name
 * @property {(repo: RepoRef) => Promise<{cloneUrl: string, headers?: Record<string,string>}>} auth
 *     credentials for clone/push, however the forge grants them (App token, deploy key, PAT, ssh agent).
 * @property {(raw: unknown, headers: Record<string,string>) => NormalizedEvent | PushEvent | null} onEvent
 *     translate a forge webhook payload into a normalized event, or null if it's noise.
 * @property {(push: PushEvent, mandate: Mandate) => {accept: boolean, violations: string[]}} enforceMandate
 *     pure: every changed path must be in scope. Adapters may ALSO wire this into a pre-receive hook
 *     or a status check; the pure function is the source of truth.
 * @property {(repo: RepoRef, commit: string, target: string) => Promise<{sha: string}>} mergeAsJudge
 *     merge with plain git under the judge identity. May be decorated (PR comment, Check) via extras.
 * @property {Record<string, Function>} [extras]  forge-unique features; never required by the protocol.
 */

import { pathInScope } from './index.js';

/** Default, forge-blind mandate check. Adapters reuse this. */
export function enforceMandate(push, mandate) {
  const violations = push.changedPaths.filter(p => !pathInScope(p, mandate.scope_paths));
  return { accept: violations.length === 0, violations };
}

/** Normalize `git@host:owner/repo.git` to `ssh://git@host/owner/repo.git`; leave URLs alone. */
export function normalizeRepoUrl(u) {
  const m = u.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
  return m ? `ssh://${m[1]}@${m[2]}/${m[3]}` : u;
}

/** Two clone URLs name the same repo if host+path match after normalization, ignoring .git and scheme. */
export function sameRepo(a, b) {
  const k = (u) => { const x = new URL(normalizeRepoUrl(u)); return (x.host + x.pathname).replace(/\.git$/, '').replace(/\/$/, '').toLowerCase(); };
  return k(a) === k(b);
}
