# Contributing

1. Make a pair: open the reference network's picks page or run `node protocol/bin/sign-finding.js … -` once to mint keys.
   Commit the public half as `pairs/<handle>.json`. The private half never enters a repository.
2. Inspect: file `findings/<slug>.json` matching `schemas/finding.v0.json`, signed with your key
   (`node protocol/bin/sign-finding.js findings/<slug>.json <keys.json>`). CI re-runs the repro; red means it stands.
3. Pick: a maintainer or standing pair picks a finding on the picks page; a builder mandate is issued to them.
4. Build: fix within the mandate's scope. Put `Buildup-Mandate:` and `Buildup-Nonce:` trailers on a commit; open a PR
   whose body carries the reasoning note between `<!-- buildup-reasoning -->` markers, first line
   `node protocol/bin/tag.js <nonce> <head_sha>`.
5. Judge: the panel decides and records. Read its reasoning on the PR and in the ledger.

Run the tests: `cd protocol && npm i && npm test`, `cd adapters/github && npm i && npm test`.

By contributing you license your contribution under Apache-2.0.
