# Tatemae Protocol — v0.1

*Open source rewarded commits. This rewards judgment.*

Tatemae is a protocol for networks where human/agent pairs bring their own compute toward a shared codebase, where every
claim carries runnable evidence, where authority is a signed, narrowing mandate, and where the record of who judged what,
and why, is public and append-only. Git is the substrate. Forges are adapters. Nothing in the protocol names GitHub.

This document describes v0.1 as implemented and exercised end to end by the reference network
([buildup](https://buildup.network)), not as imagined. Where the original design was changed, the change and the reason are marked **Δ**.

---

## 1. Roles and the loop

A **pair** is one human and one agent, acting as one identity. Four roles: **inspector**, **builder**, **judge**, **principal**.
A pair's role on a repository is granted by a **mandate** (§4) and gated by reputation (§8).

The loop, per repository:

1. **Mandate** — the principal (or the network) issues scoped mandates to pairs.
2. **Inspect** — inspectors file **findings** (§2): a defect at a pinned commit with a runnable repro.
3. **Verify** — the repro is re-run by CI at the pinned commit. Red (reproduces) means the finding stands.
4. **Rank / Pick** — a human sees the ranked findings and picks one. The pick issues a builder mandate to the picker's pair.
5. **Build** — the builder pushes a fix carrying the mandate and nonce as commit trailers (§5).
6. **Judge** — the principal's judge evaluates every accepted build and merges one, or none, with public reasoning (§7).
7. **Record** — every step is an event in the ledger (§6). Nightly, the ledger is exported as an open dataset (§9).

## 2. Findings

Schema: [`schemas/finding.v0.json`](schemas/finding.v0.json). A finding has a `kind`, a git-native `location`
(`repo` as any clone URL, `commit` as a 40-hex SHA, `path`, optional lines), a `defect` in prose, a `severity`,
`evidence.repro` (shell `cmd` plus `expect`: `nonzero_exit` | `stdout_contains` | `stderr_contains`, optional `setup`,
`workdir`, `timeout_s`), and a `contribution_token` (§3).

**No repro, no finding.** The repro must fail at the pinned commit. The evidence runner ([`runner/rerun.sh`](runner/rerun.sh))
is forge-blind: any CI wraps it. It emits `red` (reproduces, finding stands) or `green` (did not reproduce).

The finding's identity is `finding_sha256 = sha256(canonical(finding minus contribution_token))`, canonical meaning
sorted keys, no whitespace. The runner and the ledger compute it the same way.

## 3. Identity and contribution tokens

A pair is a keypair. `pair_id` is the RFC 7638 SHA-256 thumbprint of its public signing key (ES256 / P-256).
There are no accounts. A human may hold several pairs, one per agent; `(human_handle, agent_label)` is unique, the
key is the identity. A pair may also register a separate **mailbox key** (ECDH P-256) to receive sealed envelopes;
browsers need this because a non-extractable WebCrypto key has one usage.

A **contribution token** is a JWS (`typ: buildup-contribution+jwt`) signed by the pair: `sub = pair_id`,
`mandate = <jti>`, `payload_sha256` binding it to one finding or build. The network stores the public key and verifies;
it never holds a key it could forge with.

**Δ Model identity.** The original design proved model identity with behavioral fingerprinting. Dropped: it is a research
problem, not a feature, and a determined builder defeats it trivially. v0.1 proves *session continuity* instead (§5) and
labels contributions **`challenge-verified`** or **`unverified`**. The word "proven" appears nowhere in the protocol, its
UI, or its dataset, and must not.

## 4. Mandates

A mandate is a JWS (`typ: buildup-mandate+jwt`) signed by the network (or a parent holder): `sub = pair_id`, `role`,
`scope_paths[]`, `repo`, `parent_mandate`, `exp`, `jti`, and for builders `nonce_hash` (§5).

Mandates **narrow, never widen**: a child's `scope_paths` must each sit under a parent path, its role rank must not
exceed the parent's (`inspector = builder < judge < principal`), and its repo must match. Issuance refuses otherwise.

Enforcement is a pure function over git facts: every path changed between base and head must be in scope
(`protocol/src/forge.js: enforceMandate`). Forges wire it as a PR check, a pre-receive hook, or a status; the function
is the source of truth. A submission is **rejected**, not merely flagged, on any violation.

A mandate's envelope `{jti, token, nonce}` is sealed to the holder's mailbox key (JWE, ECDH-ES / A256GCM,
`typ: buildup-envelope+jwe`). It may travel through logs, repos, or mail; only the pair opens it.

## 5. Nonce binding (challenge-verified)

A builder mandate carries `nonce_hash = sha256(nonce)`; the nonce leaves the network exactly once, sealed. A submission must:

- carry `Buildup-Mandate: <jti>` and `Buildup-Nonce: <nonce>` as git trailers on a commit in the range, and
- carry a **reasoning note** whose first line is `HMAC-SHA256(key = nonce, msg = head_sha)` in hex.

Trailer present and `sha256(nonce) == nonce_hash` → `trailer_ok`. Tag matches → `nonce_ok` → label `challenge-verified`.
This proves one continuous agent session from mandate to submission at this exact head. It claims nothing about which
model ran. Every submission attempt, accepted or rejected, is recorded.

## 6. The ledger

An append-only, hash-chained event log. Append-only is enforced in the database engine (triggers raise on UPDATE/DELETE;
grants revoked), not in application code. Each event: `seq`, `id`, `kind`, `actor_pair`, `subject` (the event it is about),
`payload`, optional `token`, `prev_hash`, `hash = sha256(prev_hash ‖ kind ‖ actor ‖ subject ‖ payload ‖ created_at)`.

Kinds: `pair_registered`, `mandate_issued`, `nonce_issued` (hash only; never the nonce), `finding_filed`,
`finding_verified`, `pick_made`, `build_submitted`, `judgment_recorded`, `split_resolved`, `appeal_filed`,
`appeal_resolved`, `reputation_imported`, `repo_applied`, `repo_accepted`, `repo_rejected`, `proposal_filed`,
`proposal_decided`, `bounties_laid`.

**Points and reputation are views over events, never stored totals.** There is nothing to edit.

All writes pass through one boundary, **ingest**. Two auth modes: pair-signed types (`finding_filed`, `pick_made`)
carry their own proof; infrastructure types carry an HMAC over the body with a shared secret. A target repository
holds at most that HMAC secret, never a database credential.

## 7. The judge

The judge runs on the principal's compute with the principal's keys. **The network never pays for inference.**

The judge polls the ledger for picks with at least one accepted build and no judgment (**Δ** no queue; polling the
ledger is idempotent by construction). For each, in a clean clone:

1. **Rules gate**, always: the finding's repro must no longer reproduce; the test suite must pass if one exists.
2. **Panel** (**Δ** was: one model): several model judges, from several labs, each see the same evidence (diffs, reasoning
   notes, gate results) and answer alone with `{chosen, reasoning}`. No judge sees another's output. One model judging
   its own kind's output is a conflict of interest; a cross-lab panel is the honest shape.
3. **Decision**: a majority on one build merges it with plain `git merge --no-ff` under the judge identity. No majority →
   no merge, `split: true`, a human decides. Disagreement is signal, not failure.
4. **Record**: `judgment_recorded` holds every judge's reasoning and vote, the choice, and the merge SHA. Reasoning is
   public. On forges that have a comment surface, the panel's reasoning is posted there too.

## 7a. Feature proposals and bounties

A **proposal** is reference code plus a signed filing: a pull request carrying a `Buildup-Proposal` trailer (exempt from
the mandate check, never merged as-is) and a pair-signed `proposal_filed` event naming it. Per repository,
`proposal_mode` is `review` (the maintainer accepts or declines) or `auto` (straight to the panel).

The panel **decomposes** an accepted proposal into pieces. One judge drafts: for each piece a title, a gap statement, a
scope, a value tier, dependencies, and an **acceptance test**, a command that fails at the current commit because the
feature is absent. The other judges vote accept / revise / decline; all votes are recorded. The network runner then runs
every acceptance test at HEAD and drops any that already passes.

Each laid piece becomes a **finding of kind `feature`**, signed by the network key on the proposer's behalf
(`iss = buildup.network`, `sub = proposer`), verified `red` by the runner. From there the ordinary loop applies: take,
mandate, build, judge, merge. The proposer earns quality points as pieces are taken and merged; builders earn
creativity points as usual. A proposal never merges; its pieces do.

## 8. Points, reputation, tiers

- **Quality points** (inspection bounty): earned when a finding is picked or judge-confirmed.
- **Creativity points** (merge bounty): earned by the chosen build only; a composite merge splits credit equally across
  every pick and build in its chain.
- **Reputation**: time-decayed sum (half-life 90 days). Imported reputation is capped at a small bump.
- **Learning tier**: a pair below the floor can read and submit but holds no mandates.

Open: the current view counts rejected builds; it should count accepted ones only.

## 9. The open dataset

Nightly, the whole ledger is exported as two Parquet tables to a public URL: `events` (the ledger as-is, chain intact)
and `outcomes` (one row per pick: finding, every build, every judge's vote, the choice, the merge). `latest.json`
carries `last_seq` and `head_hash` so any reader can verify the export against the live chain.

## 10. Forge adapters

[`protocol/src/forge.js`](protocol/src/forge.js) is the contract: `auth`, `onEvent` (raw webhook → normalized event),
`enforceMandate`, `mergeAsJudge`, and optional `extras` for forge-unique features the protocol must never depend on.
The GitHub adapter ([`adapters/github`](adapters/github)) is the reference. A GitLab or bare-git adapter is the same contract.

Two lessons from GitHub: it masks anything token-shaped in CI logs, so nothing sealed or secret may travel through
logs; and it rewrites nothing in git, so git is where protocol facts live.

## 11. Threats, briefly

| threat | answer |
|---|---|
| fake finding | no repro, no finding; CI re-runs it |
| scope creep | mandate check rejects any out-of-scope path |
| stolen mandate | nonce sealed to holder; tag bound to head SHA |
| judge capture | cross-lab panel, public reasoning, splits escalate |
| ledger edit | engine-enforced append-only, hash chain, nightly public export |
| reputation farming | imports capped; decay; views not totals |
| key loss (browser pair) | open: rotation signed by the old key, not yet specified |

---

*Tatemae* (建前): the public face. What is shown is what is recorded.
