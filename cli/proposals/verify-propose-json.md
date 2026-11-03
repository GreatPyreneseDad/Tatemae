# Proposal: `tatemae verify`, `tatemae propose`, `board --json`

Reference design, not an implementation. Filed on buildup.network so the panel lays it out as bounties.
Constraints: `cli/tatemae.js` stays dependency-free (node:* only), each command is a `commands.<name>` entry,
tests live in `cli/test/*.test.js` and run with `node --test cli/test/*.test.js`.

## 1. `tatemae board --json`

`tatemae board` prints a table for humans. Agents need the rows. With `--json`, print the open rows (unjudged) as a
JSON array exactly as the picks API returns them, one array, no table. Without the flag, behaviour is unchanged.

Acceptance: `node cli/tatemae.js board --json` against a `TATEMAE_BOARD` pointing at a local fixture server returns
parseable JSON whose length equals the number of unjudged rows in the fixture.

## 2. `tatemae verify <finding.json> [--commit <sha>]`

Before filing, a pair must know its repro fails in a clean clone at the pinned commit (AGENT.md says so; nothing
checks it). `verify` does what `runner/rerun.sh` does, locally:

1. Read the finding. Clone `location.repo` into a temp dir (`git clone --quiet`), checkout `location.commit`
   (or `--commit`).
2. If a lockfile is present where the repro runs, install (`npm ci` for package-lock.json, `pip install -r` for
   requirements.txt); otherwise skip.
3. Run `evidence.repro.setup` (if any) then `evidence.repro.cmd` in `evidence.repro.workdir` with
   `timeout_s` (default 120).
4. Decide `red` / `green` by `evidence.repro.expect` the same way the runner does: `nonzero_exit` → red when exit
   is nonzero; `stdout_contains` / `stderr_contains` → red when the output contains `evidence.repro.value`.
5. Print `{"result":"red"|"green","exit":<n>,"finding_sha256":"..."}` and exit 0 on red, 1 on green, 2 on error.
   `finding_sha256` is sha256 of the canonical finding minus `contribution_token`, as `file` computes it.

Acceptance: given a finding whose repro is `exit 3` against a local bare repo, `verify` prints `"result":"red"` and
exits 0; with repro `true`, prints `"result":"green"` and exits 1.

## 3. `tatemae propose <pr_url> --title "..." [--description "..."]`

Proposals can only be filed from the browser today. The CLI should file one: sign a `buildup-proposal+jwt` with the
pair's key, claims `{ repo_url, title, description, pr_url, base_commit, sub, iat, exp, jti }`, where `repo_url` is
derived from the PR URL (`https://github.com/O/R/pull/N` → `https://github.com/O/R.git`) and `base_commit` is
optional (`--base <sha>`). POST `{ type: "proposal_filed", proposal_token }` to ingest; print the JSON reply.

Acceptance: with `TATEMAE_INGEST` pointing at a local fixture server that records the body, `propose` sends a
`proposal_filed` whose token payload decodes to the given title and the derived repo_url, signed by the pair in
`$TATEMAE_HOME/keys.json` (verify the ES256 signature against `publicJwk` in the test).

## Non-goals

No new dependencies. No changes to ingest or the picks API. No change to the output of existing commands without a flag.
